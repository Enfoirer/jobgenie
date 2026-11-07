import XCTest
@testable import JobGenie

@MainActor
final class FeedbackTests: XCTestCase {
    private let suiteName = "feedback-tests-\(UUID().uuidString)"
    private var defaults: UserDefaults { UserDefaults(suiteName: suiteName)! }
    override func tearDown() async throws { defaults.removePersistentDomain(forName: suiteName); try await super.tearDown() }
    private func coordinator(delayed: Bool = false) -> FeedbackCoordinator {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = delayed ? [DelayedHistoryProtocol.self] : [StubProtocol.self]
        return FeedbackCoordinator(api: APIClient(baseURL: URL(string: "https://example.test")!, vault: MemoryVault(), configuration: configuration), defaults: defaults)
    }
    nonisolated private static func response(eligible: Bool = true, disabled: Bool = false, submitted: Bool = false, invitation: String? = nil) -> Data {
        Data("""
        {"campaign":"ios-product-v1","serverTime":"2030-01-01T00:00:00Z","submitted":\(submitted),"disabled":\(disabled),"snoozedUntil":null,"eligible":\(eligible),"response":null,"invitationId":\(invitation.map { "\"\($0)\"" } ?? "null")}
        """.utf8)
    }
    nonisolated private static func body(_ request: URLRequest) throws -> [String: Any] {
        var data = request.httpBody ?? Data()
        if let stream = request.httpBodyStream {
            stream.open(); defer { stream.close() }
            var buffer = [UInt8](repeating: 0, count: 4096)
            while stream.hasBytesAvailable { let count = stream.read(&buffer, maxLength: buffer.count); if count <= 0 { break }; data.append(contentsOf: buffer.prefix(count)) }
        }
        return try JSONSerialization.jsonObject(with: data) as! [String: Any]
    }
    func testNoDefaultStarsAndUTF16CommentValidation() {
        var draft = FeedbackDraft(); XCTAssertNil(draft.overall); XCTAssertNil(draft.recommendation); XCTAssertFalse(draft.isValid)
        draft.overall = 1; draft.recommendation = 5; XCTAssertTrue(draft.isValid)
        draft.comment = String(repeating: "🙂", count: 1000); XCTAssertTrue(draft.isValid)
        draft.comment += "a"; XCTAssertFalse(draft.isValid)
        draft.comment = "\0"; XCTAssertFalse(draft.isValid)
        draft.comment = ""; draft.overall = 0; XCTAssertFalse(draft.isValid)
    }
    func testIdleForegroundAndBlockedSurfaceBoundaries() {
        let feedback = coordinator(); feedback.start(userID: "user-a", demo: false); feedback.setForeground(true, uptime: 100)
        XCTAssertFalse(feedback.canPrompt(blocked: false, uptime: 219))
        XCTAssertTrue(feedback.canPrompt(blocked: false, uptime: 220))
        XCTAssertFalse(feedback.canPrompt(blocked: true, uptime: 220))
        feedback.interacted(uptime: 215); XCTAssertFalse(feedback.canPrompt(blocked: false, uptime: 244))
        XCTAssertTrue(feedback.canPrompt(blocked: false, uptime: 245))
        feedback.setForeground(false, uptime: 250); XCTAssertFalse(feedback.canPrompt(blocked: false, uptime: 9999))
        feedback.setForeground(true, uptime: 10000); XCTAssertFalse(feedback.canPrompt(blocked: false, uptime: 10029))
        XCTAssertTrue(feedback.canPrompt(blocked: false, uptime: 10030))
    }
    func testAccountScopedOfflineNeverSurvivesRestartAndNeverBlocksManualEntry() async {
        let feedback = coordinator(); feedback.start(userID: "user-a", demo: false)
        StubProtocol.handler = { _ in throw URLError(.notConnectedToInternet) }
        await feedback.openManual(locale: "en"); await feedback.dismiss(never: true, locale: "en")
        let reloaded = coordinator(); reloaded.start(userID: "user-a", demo: false); reloaded.setForeground(true, uptime: 1)
        XCTAssertFalse(reloaded.canPrompt(blocked: false, uptime: 999))
        await reloaded.openManual(locale: "en"); XCTAssertNotNil(reloaded.presentation)
        reloaded.start(userID: "user-b", demo: false); reloaded.setForeground(true, uptime: 1)
        XCTAssertTrue(reloaded.canPrompt(blocked: false, uptime: 999)); XCTAssertNil(reloaded.presentation)
    }
    func testLaterPersistsAndOfflinePreferenceSyncIsRetriedWithoutRatings() async {
        let feedback = coordinator(); feedback.start(userID: "user-a", demo: false)
        StubProtocol.handler = { _ in throw URLError(.notConnectedToInternet) }
        let date = Date(timeIntervalSince1970: 2_000_000_000)
        await feedback.openManual(locale: "en"); await feedback.dismiss(never: false, locale: "en", now: date)
        let reloaded = coordinator(); reloaded.start(userID: "user-a", demo: false); reloaded.setForeground(true, uptime: 1)
        XCTAssertFalse(reloaded.canPrompt(blocked: false, now: date.addingTimeInterval(14 * 86400 - 1), uptime: 999))
        XCTAssertTrue(reloaded.canPrompt(blocked: false, now: date.addingTimeInterval(14 * 86400), uptime: 999))
        var actions: [String] = []
        StubProtocol.handler = { request in
            let data = try Self.body(request)
            actions.append(data["action"] as! String); XCTAssertNil(data["overall"]); XCTAssertNil(data["comment"])
            return (200, ["Content-Type": "application/json"], Self.response(eligible: false))
        }
        await reloaded.tick(blocked: true, safe: { false }, locale: "en", now: date, uptime: 999)
        XCTAssertEqual(actions, ["later", "visit"])
    }
    func testFailedSubmissionKeepsFormOpenAndRetrySendsNoUserOrSourceOverride() async {
        let feedback = coordinator(); feedback.start(userID: "user-a", demo: false)
        StubProtocol.handler = { _ in (200, ["Content-Type": "application/json"], Self.response()) }
        await feedback.openManual(locale: "en")
        var draft = FeedbackDraft(); draft.overall = 1; draft.recommendation = 2; draft.comment = "Needs improvement."
        StubProtocol.handler = { _ in (503, ["Content-Type": "application/json"], Data("{}".utf8)) }
        await feedback.submit(draft, locale: "en"); XCTAssertNotNil(feedback.presentation); XCTAssertNotNil(feedback.error)
        StubProtocol.handler = { request in
            let data = try Self.body(request)
            XCTAssertEqual(data["overall"] as? Int, 1); XCTAssertEqual(data["recommendation"] as? Int, 2)
            XCTAssertEqual(data["comment"] as? String, "Needs improvement."); XCTAssertNil(data["userId"]); XCTAssertNil(data["source"])
            return (200, ["Content-Type": "application/json"], Self.response(eligible: false, submitted: true))
        }
        await feedback.submit(draft, locale: "en"); XCTAssertNil(feedback.presentation); XCTAssertTrue(feedback.status?.submitted == true)
    }
    func testDemoNeverMakesFeedbackNetworkCallsOrPersistsChoices() async {
        StubProtocol.handler = { _ in XCTFail("Demo must not call feedback APIs"); throw URLError(.badURL) }
        let feedback = coordinator(); feedback.start(userID: "demo", demo: true); feedback.setForeground(true, uptime: 1)
        XCTAssertFalse(feedback.canPrompt(blocked: false, uptime: 999))
        await feedback.openManual(locale: "en"); XCTAssertNotNil(feedback.presentation)
        await feedback.dismiss(never: true, locale: "en")
        XCTAssertTrue(defaults.dictionaryRepresentation().keys.filter { $0.contains("jobgenie.feedback") }.isEmpty)
    }
    func testUnauthorizedClearsPresentationAndTriggersSessionCleanup() async {
        let feedback = coordinator(); feedback.start(userID: "user-a", demo: false)
        var called = false; feedback.onUnauthorized = { called = true }
        StubProtocol.handler = { _ in (401, ["Content-Type": "application/json"], Data("{}".utf8)) }
        await feedback.openManual(locale: "en"); XCTAssertNil(feedback.presentation); XCTAssertTrue(called); XCTAssertNil(feedback.status)
    }
    func testLateAccountResponseCannotPopulateNextAccount() async {
        let feedback = coordinator(delayed: true); feedback.start(userID: "user-a", demo: false)
        let started = expectation(description: "Feedback request started")
        DelayedHistoryProtocol.handler = { _ in started.fulfill(); return (Self.response(submitted: true), 0.2) }
        let request = Task { await feedback.openManual(locale: "en") }
        await fulfillment(of: [started], timeout: 2)
        feedback.start(userID: "user-b", demo: false)
        await request.value
        XCTAssertNil(feedback.status); XCTAssertNil(feedback.presentation)
    }
    func testFeedbackEnglishAndChineseResources() {
        for key in ["评价 JobGenie", "稍后回答", "永远不再自动显示", "总体来说，你对 JobGenie 满意吗？", "你有多大可能向朋友推荐 JobGenie？"] {
            XCTAssertNotEqual(L10n.string(key, locale: Locale(identifier: "en")), key)
            XCTAssertEqual(L10n.string(key, locale: Locale(identifier: "zh-Hans")), key)
        }
    }
    func testChangedSurfaceDefersOfferAndAcknowledgesOnlyAfterPresentation() async {
        let feedback = coordinator(); feedback.start(userID: "user-a", demo: false)
        let uptime = ProcessInfo.processInfo.systemUptime
        feedback.setForeground(true, uptime: uptime - 130); feedback.interacted(uptime: uptime - 40)
        let id = UUID().uuidString
        var safe = true; var actions: [String] = []
        StubProtocol.handler = { request in
            let body = try Self.body(request); let action = body["action"] as! String; actions.append(action)
            if action == "invite" { safe = false }
            return (200, ["Content-Type": "application/json"], Self.response(invitation: action == "invite" ? id : nil))
        }
        await feedback.tick(blocked: false, safe: { safe }, locale: "en", uptime: uptime)
        XCTAssertNil(feedback.presentation); XCTAssertEqual(actions, ["visit", "invite"])
        StubProtocol.handler = { request in
            let action = try Self.body(request)["action"] as! String; actions.append(action)
            return (200, ["Content-Type": "application/json"], Self.response(invitation: action == "invite" ? id : nil))
        }
        safe = true
        await feedback.tick(blocked: false, safe: { safe }, locale: "en", uptime: uptime)
        XCTAssertEqual(feedback.presentation?.invitationID, id)
        XCTAssertFalse(actions.contains("shown"))
        await feedback.acknowledgeShown(locale: "en"); XCTAssertEqual(actions.last, "shown")
    }
    func testLateReadCannotEraseConfirmedSubmission() async {
        let feedback = coordinator(delayed: true); feedback.start(userID: "user-a", demo: false)
        let started = expectation(description: "Old feedback read started")
        DelayedHistoryProtocol.handler = { request in
            if request.httpMethod == "GET" { started.fulfill(); return (Self.response(), 0.3) }
            return (Self.response(eligible: false, submitted: true), 0)
        }
        let load = Task { await feedback.openManual(locale: "en") }
        await fulfillment(of: [started], timeout: 2)
        var draft = FeedbackDraft(); draft.overall = 1; draft.recommendation = 2
        await feedback.submit(draft, locale: "en"); await load.value
        XCTAssertTrue(feedback.status?.submitted == true); XCTAssertNil(feedback.presentation)
    }
    func testRealFeedbackAPI() async throws {
        guard let base = ProcessInfo.processInfo.environment["JOBGENIE_TEST_BASE_URL"] else { throw XCTSkip("Run isolated feedback acceptance") }
        let api = APIClient(baseURL: URL(string: base)!, vault: MemoryVault())
        _ = try await api.signIn(email: "ios-acceptance@example.test", password: "ios-local-test-password", remember: false)
        let initial = try await api.feedbackStatus(); XCTAssertFalse(initial.submitted)
        _ = try await api.feedbackAction(FeedbackBody(action: "never", requestId: UUID().uuidString))
        let optedOut = try await api.feedbackStatus(); XCTAssertTrue(optedOut.disabled)
        let body = FeedbackBody(action: "submit", overall: 1, recommendation: 2, comment: "Native API feedback", locale: "en_US")
        let result = try await api.feedbackAction(body); XCTAssertEqual(result.response?.overall, 1)
        let retry = try await api.feedbackAction(body); XCTAssertEqual(retry.response?.createdAt, result.response?.createdAt)
        try await api.signOut()
    }
}
