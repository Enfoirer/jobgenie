import XCTest
@testable import JobGenie

@MainActor
final class ReminderTests: XCTestCase {
    private func model(delayed: Bool = false) -> AppModel {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = delayed ? [DelayedHistoryProtocol.self] : [StubProtocol.self]
        let model = AppModel(api: APIClient(baseURL: URL(string: "https://example.test")!, vault: MemoryVault(), configuration: config))
        model.user = SessionUser(id: "u", name: nil, email: "u@test")
        return model
    }
    nonisolated private static func response(status: String = "unread", revision: Int = 0) -> Data {
        Data("""
        {"settings":{"enabled":true,"leadMinutes":60},"unreadCount":\(status == "unread" ? 1 : 0),"serverTime":"2030-01-01T00:00:00Z","reminders":[{"id":"h:appointment:\(revision)","historyId":"h","jobId":"j","kind":"appointment","revision":\(revision),"company":"Acme","position":"Engineer","label":"Interview","time":"2030-01-01T00:30:00Z","dueAt":"2029-12-31T23:30:00Z","status":"\(status)","canSnooze":true}]}
        """.utf8)
    }
    func testContractAndActionWhitelist() throws {
        let result = try JSONDecoder.jobGenie.decode(RemindersResponse.self, from: Self.response())
        XCTAssertEqual(result.reminders[0].revision, 0); XCTAssertEqual(result.settings.leadMinutes, 60)
        let item = result.reminders[0]
        let body = ReminderActionBody(historyId: item.historyId, kind: item.kind, revision: item.revision, action: .snooze)
        let json = try JSONSerialization.jsonObject(with: JSONEncoder().encode(body)) as! [String: Any]
        XCTAssertEqual(Set(json.keys), ["historyId", "kind", "revision", "action"])
        XCTAssertEqual(json["action"] as? String, "snooze")
        XCTAssertFalse(ReminderSettings(leadMinutes: 16).isValid)
    }
    func testServerTimeControlsVisibilityInsteadOfDeviceCalendar() async {
        let m = model()
        StubProtocol.handler = { _ in (200, ["Content-Type":"application/json"], Self.response()) }
        await m.refreshReminders()
        XCTAssertEqual(m.reminderUnreadCount, 1)
        XCTAssertEqual(Calendar(identifier: .gregorian).component(.year, from: m.reminderNow), 2030)
        StubProtocol.handler = { _ in (200, ["Content-Type":"application/json"], Self.response().replacing("2030-01-01T00:00:00Z", with: "2030-01-01T00:30:00Z")) }
        await m.refreshReminders()
        XCTAssertTrue(m.visibleReminders.isEmpty)
    }
    func testDemoReadSettingsAndCancellationPersistWithinSession() async throws {
        let m = model(); m.useDemo(); await m.refreshReminders()
        let item = try XCTUnwrap(m.reminders.first)
        try await m.actOnReminder(item, action: .read); XCTAssertEqual(m.reminderUnreadCount, 0)
        try await m.saveReminderSettings(ReminderSettings(enabled: false)); XCTAssertTrue(m.reminders.isEmpty)
        try await m.saveReminderSettings(ReminderSettings(enabled: true, leadMinutes: 1440))
        XCTAssertEqual(m.reminders.first?.status, .read)
        try await m.actOnReminder(item, action: .cancel)
        try await m.actOnReminder(item, action: .read)
        XCTAssertEqual(m.reminders.first?.status, .cancelled)
        XCTAssertEqual(m.jobs[0].status, .interviewing)
    }
    func testDemoSnoozeIsIdempotentAndCannotUndoRead() async throws {
        let m = model(); m.useDemo(); await m.refreshReminders()
        let item = try XCTUnwrap(m.reminders.first)
        try await m.actOnReminder(item, action: .snooze)
        let wake = m.reminders.first?.snoozedUntil
        XCTAssertEqual(m.reminderUnreadCount, 0)
        try await m.actOnReminder(item, action: .snooze)
        XCTAssertEqual(m.reminders.first?.snoozedUntil, wake)
        try await m.actOnReminder(item, action: .read)
        do { try await m.actOnReminder(item, action: .snooze); XCTFail() } catch { XCTAssertEqual(error as? APIError, .conflict) }
    }
    func testRescheduleABAInvalidatesOldRevisionAndClearDeleteRemoveReminder() async throws {
        let m = model(); m.useDemo(); await m.refreshReminders()
        let old = try XCTUnwrap(m.reminders.first)
        try await m.actOnReminder(old, action: .read)
        try await m.saveSchedule(ScheduleDraft(kind: .appointment, time: old.time.addingTimeInterval(60)), jobID: old.jobId, entryID: old.historyId)
        try await m.saveSchedule(ScheduleDraft(kind: .appointment, time: old.time), jobID: old.jobId, entryID: old.historyId)
        let current = try XCTUnwrap(m.reminders.first)
        XCTAssertEqual(current.revision, old.revision + 2); XCTAssertEqual(current.status, .unread)
        do { try await m.actOnReminder(old, action: .read); XCTFail() } catch { XCTAssertEqual(error as? APIError, .conflict) }
        try await m.saveSchedule(ScheduleDraft(kind: .appointment, time: nil), jobID: old.jobId, entryID: old.historyId)
        XCTAssertTrue(m.reminders.isEmpty)
        try await m.saveSchedule(ScheduleDraft(kind: .appointment, time: old.time), jobID: old.jobId, entryID: old.historyId)
        XCTAssertNotEqual(m.reminders.first?.id, current.id)
        try await m.deleteHistory(jobID: old.jobId, entryID: old.historyId)
        XCTAssertTrue(m.reminders.isEmpty)
    }
    func testRepeatedRefreshAndEquivalentTimeDoNotDuplicateOrReopen() async throws {
        let m = model(); m.useDemo(); await m.refreshReminders()
        let item = try XCTUnwrap(m.reminders.first)
        try await m.actOnReminder(item, action: .read)
        try await m.saveSchedule(ScheduleDraft(kind: .appointment, time: item.time), jobID: item.jobId, entryID: item.historyId)
        await m.refreshReminders(); await m.refreshReminders()
        XCTAssertEqual(m.reminders.count, 1); XCTAssertEqual(m.reminders[0].id, item.id); XCTAssertEqual(m.reminders[0].status, .read)
    }
    func testFailedWriteKeepsItemAndConfirmedWriteSurvivesFailedRefresh() async throws {
        let m = model()
        var fixture = try JSONSerialization.jsonObject(with: Self.response()) as! [String: Any]
        var items = fixture["reminders"] as! [[String: Any]]
        var deadline = items[0]; deadline["id"] = "h:deadline:0"; deadline["kind"] = "deadline"
        items.append(deadline); fixture["reminders"] = items; fixture["unreadCount"] = 2
        let data = try JSONSerialization.data(withJSONObject: fixture)
        StubProtocol.handler = { _ in (200, ["Content-Type":"application/json"], data) }
        await m.refreshReminders(); let item = try XCTUnwrap(m.reminders.first)
        StubProtocol.handler = { _ in (503, ["Content-Type":"application/json"], Data("{}".utf8)) }
        do { try await m.actOnReminder(item, action: .read); XCTFail() } catch { }
        XCTAssertEqual(m.reminders.first?.id, item.id); XCTAssertFalse(m.remindersBusy)
        StubProtocol.handler = { request in
            if request.httpMethod == "PATCH" {
                XCTAssertEqual(request.url?.path, "/api/reminders")
                return (200, ["Content-Type":"application/json"], Data(#"{"success":true}"#.utf8))
            }
            return (503, ["Content-Type":"application/json"], Data("{}".utf8))
        }
        try await m.actOnReminder(item, action: .read)
        XCTAssertEqual(m.reminders.map(\.id), ["h:deadline:0"], "Keep the independent deadline when only the appointment was handled")
        XCTAssertNotNil(m.remindersError); XCTAssertNotNil(m.remindersNotice)
    }
    func testConflictReloadsCanonicalRevisionAndUnauthorizedClearsSession() async throws {
        let m = model()
        StubProtocol.handler = { _ in (200, ["Content-Type":"application/json"], Self.response()) }
        await m.refreshReminders(); let item = try XCTUnwrap(m.reminders.first)
        StubProtocol.handler = { request in
            (request.httpMethod == "PATCH" ? 409 : 200, ["Content-Type":"application/json"], Self.response(revision: 2))
        }
        do { try await m.actOnReminder(item, action: .read); XCTFail() } catch { XCTAssertEqual(error as? APIError, .conflict) }
        XCTAssertEqual(m.reminders.first?.revision, 2)
        StubProtocol.handler = { _ in (401, ["Content-Type":"application/json"], Data("{}".utf8)) }
        await m.refreshReminders()
        XCTAssertNil(m.user); XCTAssertTrue(m.reminders.isEmpty); XCTAssertNil(m.reminderSettings)
    }
    func testSettingsConfirmedResponseSurvivesFailedRefresh() async throws {
        let m = model()
        StubProtocol.handler = { request in
            if request.httpMethod == "PATCH" {
                XCTAssertEqual(request.url?.path, "/api/reminders/settings")
                return (200, ["Content-Type":"application/json"], Data(#"{"settings":{"enabled":false,"leadMinutes":30}}"#.utf8))
            }
            return (503, ["Content-Type":"application/json"], Data("{}".utf8))
        }
        try await m.saveReminderSettings(ReminderSettings(enabled: false, leadMinutes: 30))
        XCTAssertEqual(m.reminderSettings, ReminderSettings(enabled: false, leadMinutes: 30))
        XCTAssertNotNil(m.remindersNotice)
    }
    func testOlderReadCannotOverwriteNewerRefresh() async throws {
        let m = model(delayed: true)
        nonisolated(unsafe) var calls = 0
        DelayedHistoryProtocol.handler = { _ in
            calls += 1
            return (Self.response(revision: calls), calls == 1 ? 0.15 : 0)
        }
        let old = Task { await m.refreshReminders() }
        try await Task.sleep(for: .milliseconds(30)); await m.refreshReminders(force: true)
        await old.value
        XCTAssertEqual(m.reminders.first?.revision, 2)
    }
    func testLogoutDiscardsDelayedResponseBeforeAnotherAccount() async throws {
        let m = model(delayed: true)
        DelayedHistoryProtocol.handler = { _ in (Self.response(), 0.15) }
        let pending = Task { await m.refreshReminders() }
        try await Task.sleep(for: .milliseconds(20))
        await m.signOut()
        m.user = SessionUser(id: "other", name: nil, email: "other@test")
        await pending.value
        XCTAssertTrue(m.reminders.isEmpty); XCTAssertNil(m.reminderSettings); XCTAssertFalse(m.remindersLoading)
        m.useDemo(); await m.refreshReminders()
        XCTAssertEqual(m.reminders.first?.status, .unread)
    }
    func testEnglishReminderTranslations() {
        for key in ["提醒", "标为已读", "延后 10 分钟", "取消本次提醒", "提醒设置", "已取消提醒"] {
            XCTAssertNotEqual(L10n.string(key, locale: Locale(identifier: "en")), key)
        }
    }
}
private extension Data {
    func replacing(_ source: String, with target: String) -> Data { Data(String(decoding: self, as: UTF8.self).replacingOccurrences(of: source, with: target).utf8) }
}
