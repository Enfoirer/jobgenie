import XCTest
@testable import JobGenie

@MainActor final class JobDocumentTests: XCTestCase {
    func testDocumentDecodesSnapshotMetadata() throws {
        let data = Data(#"{"id":"012345678901234567890123","kind":"resume","version":2,"label":"Submitted","name":"resume.pdf","type":"application/pdf","size":"1 KB","uploadDate":"2026-11-03T00:00:00Z"}"#.utf8)
        let document = try JSONDecoder.jobGenie.decode(JobDocument.self, from: data)
        XCTAssertEqual(document.version, 2); XCTAssertEqual(document.kind, .resume)
        XCTAssertTrue(document.attachment.canPreview)
    }
    func testInvalidIDsNeverReachNetwork() async throws {
        let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [StubProtocol.self]
        let api = APIClient(baseURL: URL(string: "https://example.test")!, vault: MemoryVault(), configuration: config)
        StubProtocol.handler = { _ in XCTFail("Invalid ID reached network"); return (500, [:], Data()) }
        do { _ = try await api.jobDocuments("../uploads"); XCTFail() } catch { XCTAssertEqual(error as? APIError, .invalidInput) }
        do { _ = try await api.jobDocumentData(jobID: "012345678901234567890123", documentID: "bad"); XCTFail() } catch { XCTAssertEqual(error as? APIError, .invalidInput) }
    }
    func testRealApplicationDocuments() async throws {
        guard let base = ProcessInfo.processInfo.environment["JOBGENIE_TEST_BASE_URL"] else { throw XCTSkip("Run isolated documents acceptance") }
        let api = APIClient(baseURL: URL(string: base)!, vault: MemoryVault())
        _ = try await api.signIn(email: "ios-acceptance@example.test", password: "ios-local-test-password", remember: false)
        var draft = JobDraft(); draft.company = "Native Documents"; draft.position = "Engineer"
        let job = try await api.save(draft, id: nil)
        let file = try await api.uploadAttachment(name: "native-resume.pdf", data: ResourceTests.pdf)
        for label in ["First submission", "Revised submission", "Revised submission"] {
            try await api.linkDocument(jobID: job.id, fileID: file.id, kind: .resume, label: label)
        }
        _ = try await api.send("api/uploads/\(file.id)", method: "DELETE")
        let documents = try await api.jobDocuments(job.id)
        XCTAssertEqual(documents.map(\.version), [2, 1])
        for document in documents {
            let data = try await api.jobDocumentData(jobID: job.id, documentID: document.id)
            XCTAssertEqual(data, ResourceTests.pdf)
        }
        try await api.signOut()
    }
}
