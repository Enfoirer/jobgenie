import XCTest
@testable import JobGenie

@MainActor
final class ResourceTests: XCTestCase {
    func model() -> AppModel {
        let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [StubProtocol.self]
        let model = AppModel(api: APIClient(baseURL: URL(string: "https://example.test")!, vault: MemoryVault(), configuration: config))
        model.user = SessionUser(id: "u", name: nil, email: "u@test"); return model
    }
    nonisolated static let pdf = Data("%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF".utf8)
    nonisolated static let fileJSON = #"{"id":"012345678901234567890123","name":"resume.pdf","type":"application/pdf","size":"1 KB","uploadDate":"2026-10-25T00:00:00Z","filePath":"https://evil.test/credential"}"#
    func testCalendarRangeUsesLocalDaysAcrossDSTAndLimits() {
        let now = ISO8601DateFormatter().date(from: "2026-03-10T03:00:00Z")!
        let range = AnalyticsRange(now: now, days: 3, timeZone: TimeZone(identifier: "America/New_York")!)
        XCTAssertEqual(range.day(range.start), "2026-03-07"); XCTAssertEqual(range.day(range.end), "2026-03-09")
        XCTAssertEqual(range.end.timeIntervalSince(range.start), 47 * 3600)
        XCTAssertTrue(range.isValid(now: now))
        XCTAssertFalse(AnalyticsRange(now: now, days: 367).isValid(now: now))
        var bad = range; bad.start = now.addingTimeInterval(86400); XCTAssertFalse(bad.isValid(now: now))
        let shanghai = AnalyticsRange(now: now, timeZone: TimeZone(identifier: "Asia/Shanghai")!)
        XCTAssertEqual(shanghai.day(shanghai.end), "2026-03-10")
    }
    func testQueryEncodingPreservesIanaTimeZoneAndJSONContract() async throws {
        let m = model()
        StubProtocol.handler = { request in
            let params = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)!.queryItems!
            XCTAssertEqual(request.url?.path, "/api/stats")
            XCTAssertEqual(params.first { $0.name == "timeZone" }?.value, "Asia/Shanghai")
            return (200, ["Content-Type":"application/json"], Data(#"{"range":{"start":"2026-01-01","end":"2026-01-31","timeZone":"Asia/Shanghai","observedThrough":"2026-01-31T15:59:59Z"},"currentStatus":{"total":0,"counts":{},"asOf":"2026-02-01T00:00:00Z"},"cohort":{"total":0,"reached":{},"offersWithoutPriorInterview":0,"withoutHistory":0,"conversion":{"appliedToInterview":{"numerator":0,"denominator":0,"percent":null},"interviewToOffer":{"numerator":0,"denominator":0,"percent":null},"appliedToOffer":{"numerator":0,"denominator":0,"percent":null}}}}"#.utf8))
        }
        try await m.loadAnalytics(AnalyticsRange(timeZone: TimeZone(identifier: "Asia/Shanghai")!))
        XCTAssertNil(m.analytics?.cohort.conversion.appliedToOffer.fraction)
    }
    func testDemoCurrentDistributionAndCohortAreDifferentAndNoInferredInterview() async throws {
        let m = model(); m.useDemo()
        try await m.loadAnalytics(AnalyticsRange(days: 1))
        XCTAssertEqual(m.analytics?.currentStatus.total, 4); XCTAssertEqual(m.analytics?.cohort.total, 0)
        try await m.loadAnalytics(AnalyticsRange(days: 30))
        XCTAssertEqual(m.analytics?.cohort.total, 4); XCTAssertEqual(m.analytics?.cohort.offersWithoutPriorInterview, 1)
        XCTAssertEqual(m.analytics?.cohort.conversion.interviewToOffer.numerator, 0)
        XCTAssertEqual(m.analytics?.cohort.conversion.appliedToOffer.fraction, 0.25)
    }
    func testUploadWhitelistSizeAndMultipartInjection() throws {
        for name in ["a.html", "a.svg", "a.doc", "../a.pdf", "bad\r\nheader.pdf", ".a.pdf", "a\".pdf", "a\u{202e}.pdf"] {
            XCTAssertThrowsError(try AttachmentPolicy.validate(name: name, data: Self.pdf))
        }
        XCTAssertThrowsError(try AttachmentPolicy.validate(name: "a.pdf", data: Data()))
        XCTAssertThrowsError(try AttachmentPolicy.validate(name: "a.pdf", data: Data(count: AttachmentPolicy.maxBytes + 1)))
        XCTAssertNoThrow(try AttachmentPolicy.validate(name: "简历.PDF", data: Data(count: AttachmentPolicy.maxBytes)))
        let body = try AttachmentPolicy.multipart(name: "简历.pdf", data: Self.pdf, boundary: "TEST")
        let text = String(decoding: body, as: UTF8.self)
        XCTAssertTrue(text.contains("name=\"file\"; filename=\"简历.pdf\"")); XCTAssertTrue(text.hasSuffix("\r\n--TEST--\r\n"))
    }
    func testNativeUploadAndBinaryDownloadIgnoreServerURL() async throws {
        let m = model()
        StubProtocol.handler = { request in
            XCTAssertEqual(request.httpMethod, "POST"); XCTAssertEqual(request.url?.path, "/api/uploads")
            XCTAssertTrue(request.value(forHTTPHeaderField: "Content-Type")!.hasPrefix("multipart/form-data; boundary="))
            XCTAssertEqual(request.value(forHTTPHeaderField: "Origin"), "https://example.test")
            return (201, ["Content-Type":"application/json"], Data("{\"success\":true,\"file\":\(Self.fileJSON)}".utf8))
        }
        try await m.uploadAttachment(name: "resume.pdf", data: Self.pdf)
        let file = try XCTUnwrap(m.attachments.first)
        StubProtocol.handler = { request in
            XCTAssertEqual(request.url?.host, "example.test"); XCTAssertEqual(request.url?.path, "/api/uploads/download/012345678901234567890123")
            return (200, ["Content-Type":"application/octet-stream"], Self.pdf)
        }
        let bytes = try await m.attachmentData(file); XCTAssertEqual(bytes, Self.pdf)
    }
    func testDownloadRejectsHTMLAndUnauthorizedClearsResources() async throws {
        let m = model(); let file = try JSONDecoder.jobGenie.decode(Attachment.self, from: Data(Self.fileJSON.utf8))
        m.attachments = [file]
        StubProtocol.handler = { _ in (200, ["Content-Type":"text/html"], Data("login".utf8)) }
        do { _ = try await m.attachmentData(file); XCTFail() } catch { XCTAssertEqual(error as? APIError, .invalidResponse) }
        StubProtocol.handler = { _ in (401, ["Content-Type":"application/json"], Data("{}".utf8)) }
        do { _ = try await m.attachmentData(file); XCTFail() } catch { XCTAssertEqual(error as? APIError, .unauthorized) }
        XCTAssertNil(m.user); XCTAssertTrue(m.attachments.isEmpty)
    }
    func testPreviewCacheAndDemoFilesClearedOnSignOut() async throws {
        let m = model(); m.useDemo()
        try await m.uploadAttachment(name: "resume.pdf", data: Self.pdf)
        let url = try m.attachmentCache.store(Self.pdf, name: "resume.pdf")
        XCTAssertEqual(try Data(contentsOf: url), Self.pdf)
        await m.signOut()
        XCTAssertFalse(FileManager.default.fileExists(atPath: url.path)); XCTAssertTrue(m.demoAttachmentData.isEmpty); XCTAssertTrue(m.attachments.isEmpty)
        m.useDemo(); XCTAssertTrue(m.attachments.isEmpty)
    }
    func testFailedUploadDoesNotAddRecordAndSizeTypeErrorsAreSpecific() async {
        let m = model()
        for (status, expected) in [(413, APIError.fileTooLarge), (415, APIError.unsupportedFile), (500, APIError.server)] {
            StubProtocol.handler = { _ in (status, ["Content-Type":"application/json"], Data("{}".utf8)) }
            do { try await m.uploadAttachment(name: "a.pdf", data: Self.pdf); XCTFail() } catch { XCTAssertEqual(error as? APIError, expected) }
            XCTAssertTrue(m.attachments.isEmpty); XCTAssertFalse(m.attachmentBusy)
        }
    }
    func testLogoutDropsDelayedFileListAndClearsAccountState() async throws {
        let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [DelayedHistoryProtocol.self]
        let m = AppModel(api: APIClient(baseURL: URL(string: "https://example.test")!, vault: MemoryVault(), configuration: config))
        m.user = SessionUser(id: "old", name: nil, email: "old@test")
        DelayedHistoryProtocol.handler = { _ in (Data("{\"files\":[\(Self.fileJSON)]}".utf8), 0.15) }
        let pending = Task { try? await m.loadAttachments() }
        try await Task.sleep(for: .milliseconds(20)); await m.signOut()
        m.user = SessionUser(id: "new", name: nil, email: "new@test")
        await pending.value
        XCTAssertTrue(m.attachments.isEmpty); XCTAssertNil(m.analytics)
    }
    func testBoundedFileReadAndProtectedPreviewFilename() throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: dir) }
        let url = dir.appendingPathComponent("large.pdf")
        try Data(count: AttachmentPolicy.maxBytes + 20).write(to: url)
        XCTAssertThrowsError(try AttachmentPolicy.read(url)) { XCTAssertEqual($0 as? APIError, .fileTooLarge) }
        let cache = AttachmentCache(root: dir.appendingPathComponent("cache"))
        XCTAssertThrowsError(try cache.store(Self.pdf, name: "../escape.pdf"))
        XCTAssertFalse(FileManager.default.fileExists(atPath: dir.appendingPathComponent("escape.pdf").path))
    }
    func testRealResourcesAPI() async throws {
        guard let base = ProcessInfo.processInfo.environment["JOBGENIE_TEST_BASE_URL"] else { throw XCTSkip("Run isolated resources acceptance") }
        let api = APIClient(baseURL: URL(string: base)!, vault: MemoryVault())
        _ = try await api.signIn(email: "ios-acceptance@example.test", password: "ios-local-test-password", remember: false)
        let file = try await api.uploadAttachment(name: "native-resume.pdf", data: Self.pdf)
        XCTAssertEqual(file.name, "native-resume.pdf")
        let bytes = try await api.downloadAttachment(file); XCTAssertEqual(bytes, Self.pdf)
        struct Files: Decodable { let files: [Attachment] }
        let files: Files = try await api.get("api/uploads")
        XCTAssertEqual(files.files.count, 1); XCTAssertEqual(files.files[0].id, file.id)
        let data = try await api.send("api/stats", query: AnalyticsRange().query)
        let stats = try JSONDecoder.jobGenie.decode(AnalyticsResponse.self, from: data)
        XCTAssertEqual(stats.currentStatus.total, 2); XCTAssertEqual(stats.cohort.total, 1)
        XCTAssertEqual(stats.cohort.conversion.appliedToInterview.numerator, 1)
        XCTAssertEqual(stats.cohort.conversion.interviewToOffer.fraction, 1)
        try await api.signOut()
    }
}
