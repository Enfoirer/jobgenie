import XCTest
@testable import JobGenie

final class ShareTests: XCTestCase {
    func testOnlyWebLinksWithoutCredentialsAreAccepted() throws {
        for value in ["javascript:alert(1)", "file:///tmp/a", "ftp://example.com", "https://user:password@example.com", "https://", "https://example.com/a b", "https://example.com/" + String(repeating: "a", count: 2048)] {
            XCTAssertNil(SharedJobDraft.webURL(value), value)
        }
        XCTAssertEqual(try SharedJobDraft(url: " https://example.com/jobs/1?ref=test ").url, "https://example.com/jobs/1?ref=test")
    }
    func testTextExtractionRequiresOneDistinctWebLink() {
        XCTAssertEqual(SharedJobDraft.extractURL(from: "Apply here https://example.com/jobs/1")?.host, "example.com")
        XCTAssertNil(SharedJobDraft.extractURL(from: "https://a.example/jobs https://b.example/jobs"))
        XCTAssertNil(SharedJobDraft.extractURL(from: "No job link"))
        XCTAssertNil(SharedJobDraft.extractURL(from: "Email jobs@example.com"))
    }
    func testPersistenceDeduplicationRemovalAndNoCredentials() throws {
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: folder) }
        let store = SharedJobDraftStore(directory: folder)
        let draft = try SharedJobDraft(url: "https://example.com/jobs/1", company: " Acme ", position: " Engineer ", title: "Careers")
        try store.save(draft)
        let duplicate = try store.save(SharedJobDraft(url: draft.url, company: draft.company, position: draft.position))
        XCTAssertEqual(duplicate.id, draft.id)
        let reopened = SharedJobDraftStore(directory: folder)
        XCTAssertEqual(try reopened.list(), [draft]); XCTAssertEqual(draft.company, "Acme")
        let data = try Data(contentsOf: folder.appendingPathComponent(draft.id.uuidString + ".json"))
        let keys = Set(try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any]).keys)
        XCTAssertEqual(keys, ["id", "createdAt", "url", "company", "position", "title"])
        try reopened.remove(draft.id); try reopened.remove(draft.id)
        XCTAssertTrue(try store.list().isEmpty)
    }
    func testLimitAndMalformedFilesDoNotLoseDrafts() throws {
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: folder) }
        let store = SharedJobDraftStore(directory: folder)
        for i in 0..<50 { try store.save(SharedJobDraft(url: "https://example.com/jobs/\(i)")) }
        XCTAssertThrowsError(try store.save(SharedJobDraft(url: "https://example.com/jobs/overflow")))
        try Data("bad json".utf8).write(to: folder.appendingPathComponent("invalid.json"))
        XCTAssertEqual(try store.list().count, 50)
        XCTAssertThrowsError(try SharedJobDraft(url: "https://example.com", company: String(repeating: "a", count: 201)))
    }
    @MainActor func testSharedContainerIsAvailableToHostApp() throws {
        let store = try SharedJobDraftStore.shared()
        let draft = try SharedJobDraft(url: "https://example.com/share-test/\(UUID().uuidString)")
        defer { try? store.remove(draft.id) }
        try store.save(draft)
        XCTAssertTrue(try store.list().contains(draft))
    }
}
