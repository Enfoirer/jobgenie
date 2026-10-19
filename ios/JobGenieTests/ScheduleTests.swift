import XCTest
@testable import JobGenie

@MainActor
final class ScheduleTests: XCTestCase {
    func testPartialPatchAndExplicitClearPreserveOtherFields() throws {
        let date = try XCTUnwrap(ISO8601DateFormatter().date(from: "2026-10-20T00:30:00+08:00"))
        for kind in ScheduleKind.allCases {
            let key = kind == .appointment ? "scheduledTime" : "deadline"
            let set = try JSONSerialization.jsonObject(with: JSONEncoder().encode(ScheduleDraft(kind: kind, time: date))) as! [String: Any]
            XCTAssertEqual(Set(set.keys), [key])
            XCTAssertEqual(set[key] as? String, "2026-10-19T16:30:00.000Z")
            let clear = try JSONSerialization.jsonObject(with: JSONEncoder().encode(ScheduleDraft(kind: kind, time: nil))) as! [String: Any]
            XCTAssertEqual(Set(clear.keys), [key]); XCTAssertTrue(clear[key] is NSNull)
        }
        XCTAssertFalse(ScheduleDraft(kind: .appointment, time: Date(timeIntervalSince1970: -1)).isValid)
        XCTAssertFalse(ScheduleDraft(kind: .deadline, time: Date(timeIntervalSince1970: .infinity)).isValid)
    }
    func testMissingDatesFollowInterviewAndAssessmentRules() {
        let job = DemoData.jobs[0]
        var entry = HistoryEntry(id: "h", status: .interviewing, date: .now, interviewStage: " OA ")
        var events = ScheduleEvent.project(entry, job: job)
        XCTAssertEqual(events.map(\.kind), ["deadline"]); XCTAssertNil(events[0].time)
        entry.scheduledTime = .now
        events = ScheduleEvent.project(entry, job: job)
        XCTAssertEqual(events.map(\.kind), ["appointment", "deadline"])
        entry.interviewStage = "Technical"; entry.scheduledTime = nil; entry.deadline = .now
        events = ScheduleEvent.project(entry, job: job)
        XCTAssertEqual(events.map(\.kind), ["deadline", "appointment"])
        XCTAssertEqual(events[1].historyId, entry.id)
        entry.status = .offer; entry.deadline = nil
        XCTAssertTrue(ScheduleEvent.project(entry, job: job).isEmpty)
    }
    func testDemoSetRescheduleClearAndDeleteKeepHistoryAndStatus() async throws {
        let model = AppModel(); model.useDemo()
        let entry = try XCTUnwrap(model.histories["demo-1"]?.first)
        let status = model.jobs[0].status
        let date = Date.now.addingTimeInterval(3600)
        for kind in ScheduleKind.allCases {
            try await model.saveSchedule(ScheduleDraft(kind: kind, time: date), jobID: "demo-1", entryID: entry.id)
            XCTAssertEqual(model.events.first { $0.historyId == entry.id && $0.kind == kind.rawValue }?.time, date)
            try await model.saveSchedule(ScheduleDraft(kind: kind, time: date.addingTimeInterval(-7200)), jobID: "demo-1", entryID: entry.id)
            XCTAssertEqual(model.events.first { $0.historyId == entry.id && $0.kind == kind.rawValue }?.bucket(at: date), .past)
            try await model.saveSchedule(ScheduleDraft(kind: kind, time: nil), jobID: "demo-1", entryID: entry.id)
        }
        let after = try XCTUnwrap(model.histories["demo-1"]?.first { $0.id == entry.id })
        XCTAssertEqual(after.date, entry.date); XCTAssertEqual(after.status, entry.status)
        XCTAssertEqual(model.jobs[0].status, status)
        XCTAssertNil(after.deadline); XCTAssertNil(after.scheduledTime)
        XCTAssertTrue(model.events.contains { $0.historyId == entry.id && $0.time == nil })
        do { try await model.saveSchedule(ScheduleDraft(kind: .deadline, time: date), jobID: "demo-2", entryID: entry.id); XCTFail() }
        catch { XCTAssertEqual(error as? APIError, .notFound) }
        try await model.deleteHistory(jobID: "demo-1", entryID: entry.id)
        XCTAssertFalse(model.events.contains { $0.historyId == entry.id })
    }
    func testConfirmedPatchSurvivesRefreshFailureAndHydratesUncachedJob() async throws {
        let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [StubProtocol.self]
        let api = APIClient(baseURL: URL(string: "https://example.test")!, vault: MemoryVault(), configuration: config)
        let model = AppModel(api: api); model.user = SessionUser(id: "u", name: nil, email: "u@test")
        let job = #"{"_id":"job","company":"Acme","position":"iOS","status":"offer","dateApplied":"2026-10-18T00:00:00Z"}"#
        let entry = #"{"_id":"h","status":"interviewing","date":"2026-10-18T00:00:00Z","statusApplied":false,"scheduledTime":null,"deadline":"2026-10-20T00:00:00Z"}"#
        StubProtocol.handler = { request in
            let headers = ["Content-Type":"application/json"]
            if request.url?.path == "/api/schedule" { return (503, headers, Data("{}".utf8)) }
            if request.httpMethod == "PATCH" {
                XCTAssertEqual(request.url?.path, "/api/jobs/job/status-history/h")
                return (200, headers, Data("{\"job\":\(job),\"statusHistory\":\(entry)}".utf8))
            }
            if request.url?.path.hasSuffix("status-history") == true { return (200, headers, Data("{\"statusHistory\":[\(entry)]}".utf8)) }
            return (200, headers, Data("{\"job\":\(job)}".utf8))
        }
        try await model.refreshDetail(jobID: "job")
        XCTAssertEqual(model.jobs.first?.company, "Acme")
        try await model.saveSchedule(ScheduleDraft(kind: .appointment, time: nil), jobID: "job", entryID: "h")
        XCTAssertEqual(model.jobs.first?.status, .offer)
        XCTAssertEqual(model.events.count, 2)
        XCTAssertNotNil(model.scheduleError)
        XCTAssertFalse(model.histories["job"]![0].affectsCurrentStatus)
        StubProtocol.handler = { _ in (401, ["Content-Type":"application/json"], Data("{}".utf8)) }
        do { try await model.saveSchedule(ScheduleDraft(kind: .deadline, time: nil), jobID: "job", entryID: "h"); XCTFail() }
        catch { XCTAssertEqual(error as? APIError, .unauthorized) }
        XCTAssertTrue(model.events.isEmpty); XCTAssertNil(model.user)
    }
    func testEnglishScheduleEditorTranslations() {
        for key in ["编辑面试时间", "编辑笔试截止时间", "设置时间", "清除时间", "查看申请详情"] {
            XCTAssertNotEqual(L10n.string(key, locale: Locale(identifier: "en")), key)
        }
    }
}
