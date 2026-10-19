import XCTest
@testable import JobGenie

final class MemoryVault: SessionVault {
    var data: Data?
    var failWrites = false
    func read() throws -> Data? { data }
    func write(_ data: Data) throws { if failWrites { throw APIError.secureStorage }; self.data = data }
    func clear() throws { data = nil }
}
final class StubProtocol: URLProtocol, @unchecked Sendable {
    nonisolated(unsafe) static var handler: ((URLRequest) throws -> (Int, [String: String], Data))?
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        do {
            let (status, headers, data) = try Self.handler!(request)
            client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: headers)!, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        } catch { client?.urlProtocol(self, didFailWithError: error) }
    }
    override func stopLoading() {}
}
@MainActor
final class CoreTests: XCTestCase {
    func client(vault: MemoryVault = MemoryVault()) -> APIClient {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [StubProtocol.self]
        return APIClient(baseURL: URL(string: "https://example.test")!, vault: vault, configuration: config)
    }
    func testBackendJobContractAndDates() throws {
        let data = Data(#"{"jobs":[{"_id":"abc","company":"公司","position":"iOS","status":"interviewing","dateApplied":"2026-10-17T16:00:00.123Z","userId":"ignored"}]}"#.utf8)
        let response = try JSONDecoder.jobGenie.decode(JobsResponse.self, from: data)
        XCTAssertEqual(response.jobs.first?.id, "abc")
        XCTAssertEqual(response.jobs.first?.status, .interviewing)
        XCTAssertNotNil(response.jobs.first?.dateApplied)
        XCTAssertThrowsError(try JSONDecoder.jobGenie.decode(Job.self, from: Data(#"{"_id":"a","company":"x","position":"y","status":"applied","dateApplied":"bad"}"#.utf8)))
    }
    func testScheduleBoundariesAndMissingTime() throws {
        let data = Data(#"{"events":[{"id":"1","jobId":"a","company":"x","position":"y","kind":"deadline","time":null,"label":"Assessment deadline"},{"id":"2","jobId":"a","company":"x","position":"y","kind":"appointment","time":"2026-10-18T00:00:00Z","label":"Interview"}]}"#.utf8)
        let events = try JSONDecoder.jobGenie.decode(ScheduleResponse.self, from: data).events
        let time = try XCTUnwrap(events[1].time)
        XCTAssertEqual(events[0].bucket(at: time), .unscheduled)
        XCTAssertEqual(events[1].bucket(at: time), .upcoming)
        XCTAssertEqual(events[1].bucket(at: time.addingTimeInterval(1)), .past)
    }
    func testDraftValidationAndNoProtectedFields() throws {
        var draft = JobDraft()
        XCTAssertNotNil(draft.validationMessage)
        draft.company = "  Acme  "; draft.position = "iOS"; draft.jobUrl = "javascript:alert(1)"
        XCTAssertNotNil(draft.validationMessage)
        draft.jobUrl = "https://user:pass@example.com"
        XCTAssertNotNil(draft.validationMessage)
        draft.jobUrl = "https://example.com/jobs"
        XCTAssertNil(draft.validationMessage)
        let object = try JSONSerialization.jsonObject(with: JSONEncoder().encode(draft.normalized)) as! [String: String]
        XCTAssertEqual(object["company"], "Acme")
        XCTAssertNil(object["status"]); XCTAssertNil(object["userId"])
    }
    func testFormEscapesPasswordsAndUnicode() {
        let data = APIClient.form(["password": "a+b&c=密 码", "email": "a+b@test.com"])
        let text = String(decoding: data, as: UTF8.self)
        XCTAssertTrue(text.contains("%2B")); XCTAssertTrue(text.contains("%26")); XCTAssertTrue(text.contains("%3D")); XCTAssertFalse(text.contains("密"))
        let decoded = text.split(separator: "&").map { $0.split(separator: "=", maxSplits: 1).map { String($0).removingPercentEncoding! } }
        XCTAssertEqual(Dictionary(uniqueKeysWithValues: decoded.map { ($0[0], $0[1]) })["password"], "a+b&c=密 码")
    }
    func testCookieScopeExpiryAndChunkNames() throws {
        let url = URL(string: "https://example.test")!
        let cookie = HTTPCookie(properties: [.name:"__Secure-next-auth.session-token.0", .value:"secret", .domain:"example.test", .path:"/", .secure:"TRUE", .expires:Date.now.addingTimeInterval(3600)])!
        let saved = try XCTUnwrap(SavedCookie(cookie))
        XCTAssertNotNil(saved.cookie(for: url))
        XCTAssertNil(saved.cookie(for: URL(string: "https://other.test")!))
        XCTAssertNil(saved.cookie(for: url, now: .now.addingTimeInterval(7200)))
        XCTAssertFalse(SavedCookie.isSessionName("next-auth.csrf-token"))
        XCTAssertFalse(SavedCookie.isSessionName("next-auth.session-token.evil"))
        let insecure = HTTPCookie(properties: [.name:"next-auth.session-token", .value:"secret", .domain:"example.test", .path:"/", .expires:Date.now.addingTimeInterval(3600)])!
        XCTAssertNil(SavedCookie(insecure)?.cookie(for: url))
        let local = try XCTUnwrap(SavedCookie(insecure)?.cookie(for: URL(string: "http://example.test")!))
        XCTAssertFalse(local.isSecure, "Local HTTP cookies must not acquire a Secure attribute on restoration")
    }
    func testUnauthorizedAndRateLimit() async throws {
        let api = client()
        StubProtocol.handler = { _ in (401, ["Content-Type":"application/json"], Data("{}".utf8)) }
        do { let _: JobsResponse = try await api.get("api/jobs"); XCTFail() } catch { XCTAssertEqual(error as? APIError, .unauthorized) }
        StubProtocol.handler = { _ in (429, ["Content-Type":"application/json", "Retry-After":"121"], Data("{}".utf8)) }
        do { let _: JobsResponse = try await api.get("api/jobs"); XCTFail() } catch { XCTAssertEqual(error as? APIError, .rateLimited(121)) }
    }
    func testRejectsHTMLAndUnsafeRoutes() async throws {
        let api = client()
        StubProtocol.handler = { _ in (200, ["Content-Type":"text/html"], Data("<html>Login</html>".utf8)) }
        do { let _: JobsResponse = try await api.get("api/jobs"); XCTFail() } catch { XCTAssertEqual(error as? APIError, .invalidResponse) }
        do { let _: JobsResponse = try await api.get("https://evil.test"); XCTFail() } catch { XCTAssertEqual(error as? APIError, .configuration) }
    }
    func testSuccessfulReadUsesOriginAndSafeCookieStorage() async throws {
        let api = client()
        StubProtocol.handler = { request in
            XCTAssertEqual(request.url?.absoluteString, "https://example.test/api/jobs")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Origin"), "https://example.test")
            XCTAssertEqual(request.httpMethod, "GET")
            return (200, ["Content-Type":"application/json"], Data(#"{"jobs":[]}"#.utf8))
        }
        let response: JobsResponse = try await api.get("api/jobs")
        XCTAssertTrue(response.jobs.isEmpty)
    }
    func testExpiredSavedSessionClearsVaultWithoutNetwork() async throws {
        let vault = MemoryVault()
        let cookie = HTTPCookie(properties: [.name:"next-auth.session-token", .value:"old", .domain:"example.test", .path:"/", .expires:Date.now.addingTimeInterval(-100)])!
        vault.data = try JSONEncoder().encode([SavedCookie(cookie)!])
        StubProtocol.handler = { _ in XCTFail("Expired cookies must not be sent"); throw APIError.server }
        let user = try await client(vault: vault).restore()
        XCTAssertNil(user); XCTAssertNil(vault.data)
    }
    func testSignOutClearsVaultEvenWithoutNetwork() async throws {
        let vault = MemoryVault(); vault.data = Data("secret".utf8)
        try await client(vault: vault).signOut()
        XCTAssertNil(vault.data)
    }
    func testDemoEditsStayLocalAndClearOnExit() async throws {
        let model = AppModel(api: client())
        model.useDemo()
        var draft = JobDraft(job: model.jobs[0]); draft.company = "Changed"
        try await model.save(draft, id: model.jobs[0].id)
        XCTAssertEqual(model.jobs[0].company, "Changed")
        XCTAssertEqual(model.events[0].company, "Changed")
        await model.signOut()
        XCTAssertTrue(model.jobs.isEmpty); XCTAssertTrue(model.events.isEmpty); XCTAssertNil(model.user)
        model.useDemo(); XCTAssertEqual(model.jobs[0].company, "Northstar")
    }
    func testRevokedSessionClearsPrivateData() async {
        let api = client(); let model = AppModel(api: api)
        model.user = SessionUser(id: "real", name: "User", email: "user@example.test")
        model.jobs = DemoData.jobs
        StubProtocol.handler = { _ in (200, ["Content-Type":"application/json"], Data("{}".utf8)) }
        await model.revalidate()
        XCTAssertNil(model.user); XCTAssertTrue(model.jobs.isEmpty)
        XCTAssertEqual(model.authMessage, APIError.unauthorized.userMessage)
    }
}
