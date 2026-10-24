import XCTest
@testable import JobGenie

@MainActor
final class MailTests: XCTestCase {
    private func model() -> AppModel {
        let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [StubProtocol.self]
        let m = AppModel(api: APIClient(baseURL: URL(string: "https://example.test")!, vault: MemoryVault(), configuration: config))
        m.user = SessionUser(id: "u", name: nil, email: "u@test"); return m
    }
    func testPKCEKnownVectorRandomnessAndStrictCallback() throws {
        let proof = MailAuthorizationAttempt(verifier: "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")
        XCTAssertEqual(proof.challenge, "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")
        let a = try MailAuthorizationAttempt.make(), b = try MailAuthorizationAttempt.make()
        XCTAssertEqual(a.verifier.count, 43); XCTAssertNotEqual(a.verifier, b.verifier)
        try MailAuthorizationAttempt.validateCallback(URL(string: "com.enfoirer.jobgenie://oauth/mail?state=expected")!, state: "expected")
        for raw in ["https://oauth/mail?state=expected", "com.enfoirer.jobgenie://evil/mail?state=expected", "com.enfoirer.jobgenie://oauth/mail?state=wrong", "com.enfoirer.jobgenie://oauth/mail?state=expected&state=expected", "com.enfoirer.jobgenie://oauth/mail?state=expected&code=secret"] {
            XCTAssertThrowsError(try MailAuthorizationAttempt.validateCallback(URL(string: raw)!, state: "expected"))
        }
    }
    func testAuthorizationRejectsWrongProviderAndNonHTTPSURL() throws {
        let state = "native_" + String(repeating: "a", count: 43)
        let good = MailAuthorizationStart(state: state, url: URL(string: "https://accounts.google.com/o/oauth2/v2/auth?state=\(state)&code_challenge=proof")!)
        try good.validate(provider: "google", challenge: "proof")
        XCTAssertThrowsError(try good.validate(provider: "outlook", challenge: "proof"))
        XCTAssertThrowsError(try good.validate(provider: "google", challenge: "different"))
        let bad = MailAuthorizationStart(state: state, url: URL(string: "http://accounts.google.com/?state=\(state)&code_challenge=proof")!)
        XCTAssertThrowsError(try bad.validate(provider: "google", challenge: "proof"))
    }
    func testReviewRequiresExplicitTargetAndWhitelistsFields() throws {
        let item = PendingMail(id: "p", company: "Acme", position: "Engineer", eventType: "other")
        var draft = MailReviewDraft(item)
        XCTAssertFalse(draft.isValid); draft.eventType = "offer"; XCTAssertFalse(draft.isValid)
        draft.target = "new"; XCTAssertTrue(draft.isValid)
        draft.interviewTime = Date(timeIntervalSince1970: 1792425600)
        let body = try JSONSerialization.jsonObject(with: JSONEncoder().encode(draft)) as! [String: Any]
        XCTAssertEqual(Set(body.keys), ["company", "position", "eventType", "targetJobId", "createNew", "interviewTime", "deadline"])
        XCTAssertTrue(body["targetJobId"] is NSNull); XCTAssertTrue(body["deadline"] is NSNull)
        XCTAssertEqual(body["createNew"] as? Bool, true)
        XCTAssertTrue((body["interviewTime"] as! String).hasSuffix("Z"))
        draft.company = " "; XCTAssertFalse(draft.isValid)
        draft.target = "existing"; XCTAssertTrue(draft.isValid)
        draft.deadline = Date(timeIntervalSince1970: -1); XCTAssertFalse(draft.isValid)
    }
    func testLegacyAndUnknownBacklogDecodeWithoutInventingZero() throws {
        let response = try JSONDecoder.jobGenie.decode(MailboxesResponse.self, from: Data(#"{"accounts":[{"id":"mail","provider":"gmail","emailAddress":"mail@test","backlog":null,"lastSync":null,"hasMore":true,"failures":[]}]}"#.utf8))
        XCTAssertNil(response.accounts[0].backlog); XCTAssertNil(response.accounts[0].lastSync)
        XCTAssertEqual(response.accounts[0].hasMore, true)
    }
    func testDemoRetryConfirmAndIgnoreAreIsolatedAndDoNotDuplicate() async throws {
        let m = model(); m.useDemo()
        await m.runMail(accountID: "demo-mail", retry: true)
        XCTAssertEqual(m.mailboxes[0].lastSync?.totalFetched, 0)
        XCTAssertEqual(m.mailboxes[0].backlog?.failed, 0)
        let item = try XCTUnwrap(m.pendingMail.first), before = m.histories["demo-1"]!.count
        try await m.reviewMail(item, draft: MailReviewDraft(item), ignore: false)
        XCTAssertTrue(m.pendingMail.isEmpty); XCTAssertEqual(m.histories["demo-1"]!.count, before + 1)
        do { try await m.reviewMail(item, draft: MailReviewDraft(item), ignore: false); XCTFail() } catch { XCTAssertEqual(error as? APIError, .conflict) }
        await m.signOut(); m.useDemo()
        let ignored = m.pendingMail[0], count = m.histories["demo-1"]!.count
        try await m.reviewMail(ignored, draft: MailReviewDraft(ignored), ignore: true)
        XCTAssertEqual(m.histories["demo-1"]!.count, count); XCTAssertTrue(m.pendingMail.isEmpty)
    }
    func testSyncConfirmedCountsSurviveFailedRefreshAndUsesPOST() async throws {
        let m = model(); m.mailboxes = [Mailbox(id: "mail", provider: "gmail", emailAddress: "mail@test")]
        StubProtocol.handler = { request in
            if request.httpMethod == "POST" {
                XCTAssertEqual(request.url?.path, "/api/mail")
                return (200, ["Content-Type":"application/json"], Data(#"{"accounts":[{"accountId":"mail","totalFetched":7,"processed":4,"failed":1,"pendingReview":2,"errorCount":1}]}"#.utf8))
            }
            return (503, ["Content-Type":"application/json"], Data("{}".utf8))
        }
        await m.runMail(accountID: "mail", retry: false)
        XCTAssertEqual(m.mailboxes[0].lastSync?.totalFetched, 7)
        XCTAssertEqual(m.mailboxes[0].lastSync?.failed, 1); XCTAssertNotNil(m.mailError); XCTAssertFalse(m.mailBusy)
    }
    func testFailedReviewKeepsPendingAndUnauthorizedClearsPrivateData() async throws {
        let m = model(), item = PendingMail(id: "p", company: "Acme", position: "Engineer", eventType: "interview", targetJobId: "j")
        m.pendingMail = [item]
        StubProtocol.handler = { _ in (409, ["Content-Type":"application/json"], Data("{}".utf8)) }
        do { try await m.reviewMail(item, draft: MailReviewDraft(item), ignore: false); XCTFail() } catch { XCTAssertEqual(error as? APIError, .conflict) }
        XCTAssertEqual(m.pendingMail.count, 1); XCTAssertFalse(m.mailBusy)
        StubProtocol.handler = { _ in (401, ["Content-Type":"application/json"], Data("{}".utf8)) }
        await m.refreshMail()
        XCTAssertNil(m.user); XCTAssertTrue(m.pendingMail.isEmpty); XCTAssertTrue(m.mailboxes.isEmpty)
    }
    private func waitForAuthorization(_ authorization: MailAuthorization) async throws {
        for _ in 0..<150 { if !authorization.busy { return }; try await Task.sleep(for: .milliseconds(20)) }
        XCTFail("Authorization did not finish")
    }
    private func oauthStub(_ completed: @escaping @Sendable (String) -> Void) {
        let state = "native_" + String(repeating: "a", count: 43)
        StubProtocol.handler = { request in
            let path = request.url!.path; completed(path)
            var data = request.httpBody ?? Data()
            if let stream = request.httpBodyStream {
                stream.open(); defer { stream.close() }
                var buffer = [UInt8](repeating: 0, count: 4096)
                while stream.hasBytesAvailable { let count = stream.read(&buffer, maxLength: buffer.count); if count <= 0 { break }; data.append(contentsOf: buffer.prefix(count)) }
            }
            let body = (try? JSONSerialization.jsonObject(with: data)) as? [String: String]
            let result: String
            if path.hasSuffix("/start") {
                let challenge = body?["challenge"] ?? "missing"
                result = "{\"state\":\"\(state)\",\"url\":\"https://accounts.google.com/o/oauth2/v2/auth?state=\(state)&code_challenge=\(challenge)\"}"
            } else if path.hasSuffix("/finish") || path.hasSuffix("/cancel") {
                XCTAssertEqual(body?["state"], state); XCTAssertEqual(body?["verifier"]?.count, 43)
                result = path.hasSuffix("/finish") ? "{\"outcome\":\"connected\"}" : "{\"outcome\":\"cancelled\"}"
            } else { result = path == "/api/pending" ? "{\"items\":[]}" : "{\"accounts\":[]}" }
            return (200, ["Content-Type":"application/json"], Data(result.utf8))
        }
    }
    func testAuthorizationCoordinatorFinishesAndRefreshesOnlyAfterValidatedCallback() async throws {
        let m = model(); nonisolated(unsafe) var paths: [String] = []
        oauthStub { paths.append($0) }
        let authorization = MailAuthorization(browser: { url in
            let state = URLComponents(url: url, resolvingAgainstBaseURL: false)!.queryItems!.first { $0.name == "state" }!.value!
            return URL(string: "com.enfoirer.jobgenie://oauth/mail?state=\(state)")!
        })
        authorization.connect(provider: "google", model: m)
        try await waitForAuthorization(authorization)
        XCTAssertEqual(authorization.message, .text("邮箱绑定成功。"))
        XCTAssertEqual(paths.filter { $0.hasSuffix("/finish") }.count, 1)
        XCTAssertTrue(paths.contains("/api/mail/status")); XCTAssertTrue(paths.contains("/api/pending"))
    }
    func testAuthorizationCancellationInvalidatesAttemptWithoutFinishing() async throws {
        let m = model(); nonisolated(unsafe) var paths: [String] = []
        oauthStub { paths.append($0) }
        let authorization = MailAuthorization(browser: { _ in throw CancellationError() })
        authorization.connect(provider: "google", model: m); try await waitForAuthorization(authorization)
        XCTAssertEqual(authorization.message, .text("已取消邮箱授权。"))
        XCTAssertTrue(paths.contains("/api/oauth/google/native/cancel")); XCTAssertFalse(paths.contains("/api/oauth/google/native/finish"))
    }
    func testCancellationAfterFinishSubmissionDoesNotClaimBindingWasCancelled() async throws {
        let m = model(); nonisolated(unsafe) var paths: [String] = []
        oauthStub { paths.append($0) }
        let handler = StubProtocol.handler!
        StubProtocol.handler = { request in
            if request.url!.path.hasSuffix("/finish") { throw CancellationError() }
            return try handler(request)
        }
        let authorization = MailAuthorization(browser: { url in
            let state = URLComponents(url: url, resolvingAgainstBaseURL: false)!.queryItems!.first { $0.name == "state" }!.value!
            return URL(string: "com.enfoirer.jobgenie://oauth/mail?state=\(state)")!
        })
        authorization.connect(provider: "google", model: m); try await waitForAuthorization(authorization)
        XCTAssertEqual(authorization.message, .text("未能确认绑定结果，请刷新邮箱列表后再尝试授权。"))
        XCTAssertFalse(paths.contains("/api/oauth/google/native/cancel"))
    }
    func testSigningOutDuringAuthorizationNeverFinishesForAnotherSession() async throws {
        let m = model(); nonisolated(unsafe) var paths: [String] = []
        oauthStub { paths.append($0) }
        let authorization = MailAuthorization(browser: { url in
            await m.signOut()
            let state = URLComponents(url: url, resolvingAgainstBaseURL: false)!.queryItems!.first { $0.name == "state" }!.value!
            return URL(string: "com.enfoirer.jobgenie://oauth/mail?state=\(state)")!
        })
        authorization.connect(provider: "google", model: m); try await waitForAuthorization(authorization)
        XCTAssertNil(m.user); XCTAssertFalse(paths.contains("/api/oauth/google/native/finish"))
    }
    func testMailEnglishTranslations() {
        for key in ["立即同步", "重试失败邮件", "人工确认", "连接 Gmail", "邮箱绑定成功。", "确认并应用"] {
            XCTAssertNotEqual(L10n.string(key, locale: Locale(identifier: "en")), key)
        }
    }
}
