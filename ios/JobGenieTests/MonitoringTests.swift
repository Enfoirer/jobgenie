import XCTest
@testable import JobGenie
@MainActor
final class MonitoringTests: XCTestCase {
    nonisolated private static func body(_ request: URLRequest) throws -> [String: Any] {
        var data = request.httpBody ?? Data()
        if let stream = request.httpBodyStream {
            stream.open(); defer { stream.close() }
            var buffer = [UInt8](repeating: 0, count: 1024)
            while stream.hasBytesAvailable { let count = stream.read(&buffer, maxLength: buffer.count); if count <= 0 { break }; data.append(buffer, count: count) }
        }
        return try JSONSerialization.jsonObject(with: data) as! [String: Any]
    }
    func testNetworkReportHasOnlySafeMetadataAndRepeatedFailureReusesReference() async throws {
        let configuration = URLSessionConfiguration.ephemeral; configuration.protocolClasses = [StubProtocol.self]
        let api = APIClient(baseURL: URL(string: "https://example.test")!, vault: MemoryVault(), configuration: configuration)
        let id = "JG-00000000-0000-4000-8000-000000000001"
        let model = AppModel(api: api)
        nonisolated(unsafe) var reports = 0
        StubProtocol.handler = { request in
            if request.url!.path == "/api/auth/session" { return (200, ["Content-Type": "application/json"], Data("{\"user\":{\"id\":\"owner\",\"email\":\"test@example.test\"},\"expires\":\"2099-01-01T00:00:00Z\"}".utf8)) }
            if request.url!.path == "/api/monitoring/report" {
                reports += 1
                let data = try Self.body(request)
                XCTAssertEqual(Set(data.keys), Set(["platform", "version", "kind", "route", "method"]))
                XCTAssertEqual(data["route"] as? String, "/api/jobs/[id]")
                XCTAssertFalse(String(describing: data).contains("fixture-password"))
                return (200, ["Content-Type": "application/json"], Data("{\"errorId\":\"\(id)\"}".utf8))
            }
            throw URLError(.timedOut)
        }
        _ = try await api.currentUser()
        for _ in 0..<2 {
            do { _ = try await api.send("api/jobs/0123456789abcdef01234567", method: "POST", body: Data("fixture-password mail-body".utf8), query: [URLQueryItem(name: "token", value: "fixture-token")]); XCTFail() }
            catch { XCTAssertEqual(error as? APIError, .tracked(id)) }
        }
        XCTAssertEqual(reports, 1)
        XCTAssertEqual(model.lastErrorReference, id)
        try await api.signOut()
        do { _ = try await api.send("api/jobs/0123456789abcdef01234567"); XCTFail() } catch { XCTAssertTrue(error is URLError) }
        XCTAssertEqual(reports, 1)
    }
    func testServerReferenceIsShownWithoutResponseBody() async throws {
        let configuration = URLSessionConfiguration.ephemeral; configuration.protocolClasses = [StubProtocol.self]
        let api = APIClient(baseURL: URL(string: "https://example.test")!, vault: MemoryVault(), configuration: configuration)
        let model = AppModel(api: api)
        let id = "JG-00000000-0000-4000-8000-000000000001"
        StubProtocol.handler = { _ in (503, ["Content-Type": "application/json", "X-Error-Reference": id], Data("password token email body".utf8)) }
        do { _ = try await api.send("api/jobs"); XCTFail() }
        catch { XCTAssertEqual(error as? APIError, .tracked(id)); XCTAssertFalse(error.localizedDescription.contains("password")) }
        XCTAssertEqual(model.lastErrorReference, id)
        await model.signOut(); XCTAssertNil(model.lastErrorReference)
    }
    func testUntrustedReferenceIsRejectedAndLocalizationIsBilingual() {
        XCTAssertFalse(APIClient.validReference("secret password"))
        XCTAssertFalse(APIClient.validReference("JG-00000000-0000-0000-0000-000000000001"))
        let text = UserMessage.errorReference("JG-example").localized(locale: Locale(identifier: "en"))
        XCTAssertTrue(text.contains("JG-example")); XCTAssertTrue(text.contains("reference"))
    }
}
