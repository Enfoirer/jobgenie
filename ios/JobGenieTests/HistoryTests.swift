import XCTest
@testable import JobGenie

final class DelayedHistoryProtocol: URLProtocol, @unchecked Sendable {
    nonisolated(unsafe) static var handler: ((URLRequest) -> (Data, TimeInterval))?
    private var delivery: DispatchWorkItem?
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        let (data, delay) = Self.handler!(request)
        let delivery = DispatchWorkItem { [self] in
            client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil,
                                                                 headerFields: ["Content-Type":"application/json"])!, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data); client?.urlProtocolDidFinishLoading(self)
        }
        self.delivery = delivery
        DispatchQueue.global().asyncAfter(deadline: .now() + delay, execute: delivery)
    }
    override func stopLoading() { delivery?.cancel() }
}

@MainActor
final class HistoryTests: XCTestCase {
    private let headers = ["Content-Type": "application/json"]
    private let jobJSON = #"{"_id":"job","company":"Acme","position":"iOS","status":"applied","dateApplied":"2026-10-18T00:00:00.000Z"}"#
    private let entryJSON = #"{"_id":"entry","status":"offer","date":"2026-10-19T00:00:00.123Z","statusApplied":false,"source":{"provider":"gmail","subject":"Original source"}}"#
    private func client() -> APIClient {
        let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [StubProtocol.self]
        return APIClient(baseURL: URL(string: "https://example.test")!, vault: MemoryVault(), configuration: config)
    }
    private func model() -> AppModel {
        let result = AppModel(api: client())
        result.user = SessionUser(id: "owner", name: nil, email: "owner@example.test")
        result.jobs = [try! JSONDecoder.jobGenie.decode(Job.self, from: Data(jobJSON.utf8))]
        return result
    }
    func testHistoryContractPreservesProvenanceAndEligibility() throws {
        let entry = try JSONDecoder.jobGenie.decode(HistoryEntry.self, from: Data(entryJSON.utf8))
        XCTAssertFalse(entry.affectsCurrentStatus)
        XCTAssertEqual(entry.source?.subject, "Original source")
        XCTAssertNil(entry.deadline)
        let legacy = try JSONDecoder.jobGenie.decode(HistoryEntry.self, from: Data(#"{"_id":"old","status":"applied","date":"2026-10-18T00:00:00Z"}"#.utf8))
        XCTAssertTrue(legacy.affectsCurrentStatus)
    }
    func testDraftOnlySendsEditableFieldsAndPreservesMilliseconds() throws {
        let entry = try JSONDecoder.jobGenie.decode(HistoryEntry.self, from: Data(entryJSON.utf8))
        var draft = HistoryDraft(entry: entry)
        draft.notes = "  Changed  "; draft.interviewStage = "stale stage"
        let object = try JSONSerialization.jsonObject(with: JSONEncoder().encode(draft.normalized)) as! [String: Any]
        XCTAssertEqual(Set(object.keys), Set(["status", "date", "notes", "interviewStage"]))
        XCTAssertEqual(object["notes"] as? String, "Changed")
        XCTAssertEqual(object["interviewStage"] as? String, "")
        XCTAssertEqual(object["date"] as? String, "2026-10-19T00:00:00.123Z")
        draft.status = .interviewing; draft.interviewStage = String(repeating: "😀", count: 101)
        XCTAssertNotNil(draft.validationMessage, "Match the server's UTF-16 length limit")
        draft.interviewStage = String(repeating: "a", count: 200); XCTAssertNil(draft.validationMessage)
        draft.notes = String(repeating: "a", count: 10001); XCTAssertNotNil(draft.validationMessage)
        draft.notes = ""; draft.date = Date(timeIntervalSince1970: -1); XCTAssertNotNil(draft.validationMessage)
    }
    func testDemoReordersHistoryAndFallsBackAfterDeletion() async throws {
        let model = AppModel(api: client()); model.useDemo()
        let id = "demo-2"
        var draft = HistoryDraft(status: .offer)
        try await model.saveHistory(draft, jobID: id)
        let offer = try XCTUnwrap(model.histories[id]?.first)
        XCTAssertEqual(model.jobs.first { $0.id == id }?.status, .offer)
        draft = HistoryDraft(entry: offer); draft.date = .now.addingTimeInterval(-10 * 86400)
        try await model.saveHistory(draft, jobID: id, entryID: offer.id)
        XCTAssertEqual(model.jobs.first { $0.id == id }?.status, .applied)
        draft.date = .now; draft.status = .rejected
        try await model.saveHistory(draft, jobID: id, entryID: offer.id)
        XCTAssertEqual(model.jobs.first { $0.id == id }?.status, .rejected)
        try await model.deleteHistory(jobID: id, entryID: offer.id)
        XCTAssertEqual(model.jobs.first { $0.id == id }?.status, .applied)
        let initial = try XCTUnwrap(model.histories[id]?.first)
        try await model.deleteHistory(jobID: id, entryID: initial.id)
        XCTAssertTrue(model.histories[id]!.isEmpty)
        XCTAssertEqual(model.jobs.first { $0.id == id }?.status, .applied)
        XCTAssertFalse(model.events.contains { $0.jobId == id })
        do { try await model.deleteHistory(jobID: "demo-1", entryID: offer.id); XCTFail() } catch { XCTAssertEqual(error as? APIError, .notFound) }
    }
    func testHistoryOnlyEditsAndDemoReset() async throws {
        let model = AppModel(api: client()); model.useDemo()
        let old = try XCTUnwrap(model.histories["demo-1"]?.first { !$0.affectsCurrentStatus })
        var draft = HistoryDraft(entry: old); draft.status = .rejected; draft.date = .now
        try await model.saveHistory(draft, jobID: "demo-1", entryID: old.id)
        XCTAssertEqual(model.jobs.first?.status, .interviewing)
        XCTAssertEqual(model.histories["demo-1"]?.first?.statusApplied, false)
        await model.signOut(); XCTAssertTrue(model.histories.isEmpty)
        model.useDemo(); XCTAssertEqual(model.histories["demo-1"]?.first { $0.id == old.id }?.status, .interviewing)
    }
    func testNativeRequestsUseCorrectMethodsAndServerStatus() async throws {
        let model = model(), job = jobJSON, entry = entryJSON
        nonisolated(unsafe) var methods: [String] = []
        StubProtocol.handler = { request in
            let path = request.url!.path
            if path == "/api/schedule" { return (200, ["Content-Type":"application/json"], Data(#"{"events":[]}"#.utf8)) }
            methods.append(request.httpMethod!)
            XCTAssertEqual(request.value(forHTTPHeaderField: "Origin"), "https://example.test")
            XCTAssertTrue(path == "/api/jobs/job/status-history" || path == "/api/jobs/job/status-history/entry")
            return (200, ["Content-Type":"application/json"], Data("{\"job\":\(job),\"statusHistory\":\(entry)}".utf8))
        }
        let draft = HistoryDraft(status: .offer)
        try await model.saveHistory(draft, jobID: "job")
        XCTAssertEqual(model.jobs.first?.status, .applied, "Use the returned job, not the edited entry's status")
        XCTAssertEqual(model.histories["job"]?.first?.source?.subject, "Original source")
        try await model.saveHistory(draft, jobID: "job", entryID: "entry")
        XCTAssertEqual(model.histories["job"]?.count, 1)
        try await model.deleteHistory(jobID: "job", entryID: "entry")
        XCTAssertEqual(methods, ["POST", "PATCH", "DELETE"])
        XCTAssertTrue(model.histories["job"]!.isEmpty)
    }
    func testFailureDoesNotOptimisticallyChangeDataAnd401ClearsHistory() async throws {
        let model = model()
        let entry = try JSONDecoder.jobGenie.decode(HistoryEntry.self, from: Data(entryJSON.utf8))
        model.histories["job"] = [entry]
        StubProtocol.handler = { _ in (503, ["Content-Type":"application/json"], Data("{}".utf8)) }
        do { try await model.deleteHistory(jobID: "job", entryID: "entry"); XCTFail() } catch { XCTAssertEqual(error as? APIError, .server) }
        XCTAssertEqual(model.histories["job"], [entry]); XCTAssertEqual(model.jobs.first?.status, .applied)
        XCTAssertTrue(model.historyMutations.isEmpty)
        StubProtocol.handler = { _ in (401, ["Content-Type":"application/json"], Data("{}".utf8)) }
        do { try await model.saveHistory(HistoryDraft(), jobID: "job"); XCTFail() } catch { XCTAssertEqual(error as? APIError, .unauthorized) }
        XCTAssertNil(model.user); XCTAssertTrue(model.histories.isEmpty); XCTAssertTrue(model.jobs.isEmpty)
    }
    func testMissingRecordRefreshAndErrorMapping() async throws {
        let model = model(), api = client()
        for (status, expected) in [(400, APIError.invalidInput), (403, .notFound), (404, .notFound), (409, .conflict)] {
            StubProtocol.handler = { _ in (status, ["Content-Type":"application/json"], Data("{}".utf8)) }
            do { try await api.deleteHistory(jobID: "job", entryID: "entry"); XCTFail() } catch { XCTAssertEqual(error as? APIError, expected) }
        }
        StubProtocol.handler = { _ in (404, ["Content-Type":"application/json"], Data("{}".utf8)) }
        do { try await model.refreshDetail(jobID: "job"); XCTFail() } catch { XCTAssertEqual(error as? APIError, .notFound) }
        XCTAssertTrue(model.jobs.isEmpty)
    }
    func testHistoryMessagesHaveEnglishTranslations() {
        for key in ["新增状态记录", "编辑状态记录", "状态发生时间", "确认删除", "仅保留历史，不影响当前状态", "请选择有效的状态发生时间。"] {
            XCTAssertNotEqual(L10n.string(key, locale: Locale(identifier: "en")), key)
        }
    }
    func testOlderListResponseCannotOverwriteConfirmedMutation() async throws {
        let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [DelayedHistoryProtocol.self]
        let model = AppModel(api: APIClient(baseURL: URL(string: "https://example.test")!, vault: MemoryVault(), configuration: config))
        model.user = SessionUser(id: "owner", name: nil, email: "owner@example.test")
        let job = jobJSON, entry = entryJSON
        let started = expectation(description: "Old list started")
        DelayedHistoryProtocol.handler = { request in
            if request.url?.path == "/api/jobs" { started.fulfill(); return (Data("{\"jobs\":[\(job)]}".utf8), 0.3) }
            if request.url?.path == "/api/schedule" { return (Data(#"{"events":[]}"#.utf8), 0) }
            let updated = job.replacingOccurrences(of: "\"status\":\"applied\"", with: "\"status\":\"offer\"")
            return (Data("{\"job\":\(updated),\"statusHistory\":\(entry)}".utf8), 0)
        }
        let load = Task { await model.refreshJobs() }
        await fulfillment(of: [started], timeout: 2)
        try await model.saveHistory(HistoryDraft(status: .offer), jobID: "job")
        await load.value
        XCTAssertEqual(model.jobs.first?.status, .offer)
        XCTAssertFalse(model.jobsLoading)
    }
    func testOutOfOrderDetailLoadsAndSessionExitDoNotRestoreOldData() async throws {
        let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [DelayedHistoryProtocol.self]
        let model = AppModel(api: APIClient(baseURL: URL(string: "https://example.test")!, vault: MemoryVault(), configuration: config))
        model.user = SessionUser(id: "owner", name: nil, email: "owner@example.test")
        let job = jobJSON, entry = entryJSON
        let started = expectation(description: "First detail started")
        nonisolated(unsafe) var loads = 0
        DelayedHistoryProtocol.handler = { request in
            if request.url?.path == "/api/jobs/job" {
                loads += 1
                if loads == 1 { started.fulfill(); return (Data("{\"job\":\(job)}".utf8), 0.3) }
                return (Data("{\"job\":\(job.replacingOccurrences(of: "Acme", with: "Updated"))}".utf8), 0)
            }
            return (Data("{\"statusHistory\":[\(entry)]}".utf8), 0)
        }
        let old = Task { try await model.refreshDetail(jobID: "job") }
        await fulfillment(of: [started], timeout: 2)
        try await model.refreshDetail(jobID: "job")
        do { try await old.value; XCTFail() } catch { XCTAssertTrue(error is CancellationError) }
        XCTAssertEqual(model.jobs.first?.company, "Updated")
        await model.signOut()
        XCTAssertTrue(model.histories.isEmpty); XCTAssertTrue(model.jobs.isEmpty)
    }
}
