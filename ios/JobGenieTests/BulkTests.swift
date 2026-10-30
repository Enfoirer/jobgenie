import XCTest
@testable import JobGenie

@MainActor
final class BulkTests: XCTestCase {
    private func model(demo: Bool = true) -> AppModel {
        let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [StubProtocol.self]
        let m = AppModel(api: APIClient(baseURL: URL(string: "https://example.test")!, vault: MemoryVault(), configuration: config))
        if demo { m.useDemo() } else { m.user = SessionUser(id: "u", name: nil, email: "u@test") }
        return m
    }
    func testArchiveRestorePreservesHistoryStatusAndReadReminder() async throws {
        let m = model(), count = m.histories["demo-1"]!.count, status = m.jobs[0].status
        try await m.saveSchedule(ScheduleDraft(kind: .appointment, time: .now.addingTimeInterval(1800)), jobID: "demo-1", entryID: "initial-demo-1")
        await m.refreshReminders(force: true)
        let reminder = try XCTUnwrap(m.reminders.first { $0.jobId == "demo-1" })
        try await m.actOnReminder(reminder, action: .read)
        let original = m.events.filter { $0.jobId == "demo-1" }.count
        let first = try await m.performBulk(ids: ["demo-1"], action: "archive")
        XCTAssertEqual(first.succeeded, 1); XCTAssertNotNil(m.jobs[0].archivedAt)
        XCTAssertFalse(m.events.contains { $0.jobId == "demo-1" }); XCTAssertFalse(m.reminders.contains { $0.jobId == "demo-1" })
        let date = m.jobs[0].archivedAt
        _ = try await m.performBulk(ids: ["demo-1"], action: "archive")
        XCTAssertEqual(m.jobs[0].archivedAt, date)
        _ = try await m.performBulk(ids: ["demo-1"], action: "restore")
        XCTAssertNil(m.jobs[0].archivedAt); XCTAssertEqual(m.jobs[0].status, status)
        XCTAssertEqual(m.histories["demo-1"]!.count, count)
        XCTAssertEqual(m.events.filter { $0.jobId == "demo-1" }.count, original)
        XCTAssertEqual(m.reminders.first { $0.id == reminder.id }?.status, .read)
    }
    func testPartialStatusResultAndRetryDoNotDuplicateHistory() async throws {
        let m = model(), count = m.histories["demo-1"]!.count
        for _ in 0..<2 {
            let result = try await m.performBulk(ids: ["demo-1", "missing"], action: "status", status: .offer)
            XCTAssertEqual(result.succeeded, 1); XCTAssertEqual(result.failed, 1)
            XCTAssertEqual(result.results.first { !$0.success }?.id, "missing")
        }
        XCTAssertEqual(m.jobs.first { $0.id == "demo-1" }?.status, .offer)
        XCTAssertEqual(m.histories["demo-1"]!.count, count + 1); XCTAssertFalse(m.bulkBusy)
    }
    func testBulkReviewLeavesUnresolvedEmailAndIgnoreDoesNotAddHistory() async throws {
        let m = model()
        m.pendingMail.append(PendingMail(id: "unresolved", company: "Unknown", position: "Engineer", eventType: "offer"))
        let result = try await m.performBulk(ids: ["demo-review", "unresolved"], action: "accept", pending: true)
        XCTAssertEqual(result.succeeded, 1); XCTAssertEqual(result.failed, 1)
        XCTAssertEqual(m.pendingMail.map(\.id), ["unresolved"])
        let count = m.histories["demo-1"]!.count
        _ = try await m.performBulk(ids: ["unresolved"], action: "ignore", pending: true)
        XCTAssertTrue(m.pendingMail.isEmpty); XCTAssertEqual(m.histories["demo-1"]!.count, count)
    }
    func testBulkLimitsAndInvalidActionsDoNotMutate() async throws {
        let m = model(), before = m.jobs
        for ids in [Set<String>(), Set((0..<51).map(String.init))] {
            do { _ = try await m.performBulk(ids: ids, action: "archive"); XCTFail() }
            catch { XCTAssertEqual(error as? APIError, .invalidInput) }
        }
        do { _ = try await m.performBulk(ids: ["demo-1"], action: "delete"); XCTFail() }
        catch { XCTAssertEqual(error as? APIError, .invalidInput) }
        XCTAssertEqual(m.jobs, before)
    }
    func testResponseValidationRejectsMissingDuplicateAndForeignRecords() throws {
        for raw in [
            #"{"total":1,"succeeded":1,"failed":0,"results":[]}"#,
            #"{"total":1,"succeeded":1,"failed":0,"results":[{"id":"other","success":true}]}"#,
            #"{"total":1,"succeeded":1,"failed":0,"results":[{"id":"a","success":true}]}"#
        ] {
            let response = try JSONDecoder.jobGenie.decode(BulkResponse.self, from: Data(raw.utf8))
            XCTAssertThrowsError(try response.validate(ids: ["a"], pending: false))
        }
        let response = BulkResponse(results: [BulkItemResult(id: "a", success: false, status: 404)])
        XCTAssertNoThrow(try response.validate(ids: ["a"], pending: false))
    }
    func testLegacyJobAndArchivedJobDecode() throws {
        let raw = #"{"_id":"a","company":"Acme","position":"Engineer","status":"applied","dateApplied":"2026-10-01T00:00:00Z"}"#
        XCTAssertNil(try JSONDecoder.jobGenie.decode(Job.self, from: Data(raw.utf8)).archivedAt)
        let archived = raw.dropLast() + #", "archivedAt":"2026-10-30T00:00:00Z"}"#
        XCTAssertNotNil(try JSONDecoder.jobGenie.decode(Job.self, from: Data(archived.utf8)).archivedAt)
    }
    func testLiveBulkContractDecodesPartialResultsAndLoadsArchivedJobs() async throws {
        let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [StubProtocol.self]
        let api = APIClient(baseURL: URL(string: "https://example.test")!, vault: MemoryVault(), configuration: config)
        StubProtocol.handler = { request in
            if request.url?.path == "/api/jobs/bulk" {
                XCTAssertEqual(request.httpMethod, "POST")
                return (200, ["Content-Type": "application/json"], Data(#"{"total":2,"succeeded":1,"failed":1,"results":[{"id":"a","success":true,"job":{"_id":"a","company":"Acme","position":"Engineer","status":"applied","dateApplied":"2026-10-01T00:00:00Z","archivedAt":"2026-10-30T00:00:00Z"}},{"id":"b","success":false,"status":404,"error":"Not found"}]}"#.utf8))
            }
            XCTAssertEqual(request.url?.path, "/api/jobs")
            XCTAssertEqual(URLComponents(url: request.url!, resolvingAgainstBaseURL: false)?.queryItems, [URLQueryItem(name: "includeArchived", value: "true")])
            return (200, ["Content-Type": "application/json"], Data(#"{"jobs":[]}"#.utf8))
        }
        let response = try await api.bulk(ids: ["a", "b"], action: "archive", status: nil, pending: false)
        XCTAssertEqual(response.succeeded, 1); XCTAssertEqual(response.failed, 1)
        XCTAssertNotNil(response.results.first?.job?.archivedAt)
        _ = try await api.allJobs()
    }
    func testUnauthorizedBulkClearsAccountData() async throws {
        let m = model(demo: false); m.jobs = DemoData.jobs
        StubProtocol.handler = { request in
            XCTAssertEqual(request.url?.path, "/api/jobs/bulk"); XCTAssertEqual(request.httpMethod, "POST")
            return (401, ["Content-Type": "application/json"], Data("{}".utf8))
        }
        do { _ = try await m.performBulk(ids: ["a"], action: "archive"); XCTFail() }
        catch { XCTAssertEqual(error as? APIError, .unauthorized) }
        XCTAssertNil(m.user); XCTAssertTrue(m.jobs.isEmpty); XCTAssertFalse(m.bulkBusy)
    }
}
