import Foundation

struct SharedJobDraft: Codable, Identifiable, Equatable {
    let id: UUID
    let createdAt: Date
    var url: String
    var company: String
    var position: String
    var title: String
    init(url: String, company: String = "", position: String = "", title: String = "") throws {
        guard let safe = Self.webURL(url), company.count <= 200, position.count <= 200 else { throw ShareDraftError.invalid }
        id = UUID(); createdAt = .now; self.url = safe.absoluteString
        self.company = company.trimmingCharacters(in: .whitespacesAndNewlines)
        self.position = position.trimmingCharacters(in: .whitespacesAndNewlines)
        self.title = String(title.prefix(500))
    }
    static func webURL(_ value: String) -> URL? {
        let value = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard value.count <= 2048, !value.contains(where: { $0.isWhitespace }),
              let url = URL(string: value), ["https", "http"].contains(url.scheme?.lowercased() ?? ""),
              let host = url.host, !host.isEmpty, url.user == nil, url.password == nil else { return nil }
        return url
    }
    static func extractURL(from text: String) -> URL? {
        if let url = webURL(text) { return url }
        guard text.count <= 20000,
              let detector = try? NSDataDetector(types: NSTextCheckingResult.CheckingType.link.rawValue) else { return nil }
        let urls = Set(detector.matches(in: text, range: NSRange(text.startIndex..., in: text))
            .compactMap { $0.url }.compactMap { webURL($0.absoluteString)?.absoluteString })
        guard urls.count == 1, let only = urls.first else { return nil }
        return URL(string: only)
    }
}
enum ShareDraftError: Error { case unavailable, invalid, full }

/// Only unassigned drafts live here. Authentication tokens never enter the group.
struct SharedJobDraftStore {
    static let group = "group.com.enfoirer.jobgenie"
    let directory: URL
    init(directory: URL) { self.directory = directory }
    static func shared() throws -> Self {
        guard let root = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group) else { throw ShareDraftError.unavailable }
        return Self(directory: root.appendingPathComponent("SharedJobDrafts", isDirectory: true))
    }
    func list() throws -> [SharedJobDraft] {
        guard FileManager.default.fileExists(atPath: directory.path) else { return [] }
        return try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: [.fileSizeKey])
            .filter { $0.pathExtension == "json" }
            .compactMap { url -> SharedJobDraft? in
                guard let size = try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize, size <= 20000,
                      let data = try? Data(contentsOf: url), let draft = try? JSONDecoder().decode(SharedJobDraft.self, from: data),
                      url.deletingPathExtension().lastPathComponent == draft.id.uuidString,
                      SharedJobDraft.webURL(draft.url) != nil, draft.company.count <= 200, draft.position.count <= 200, draft.title.count <= 500 else { return nil }
                return draft
            }.sorted { $0.createdAt < $1.createdAt }
    }
    @discardableResult func save(_ draft: SharedJobDraft) throws -> SharedJobDraft {
        guard SharedJobDraft.webURL(draft.url) != nil, draft.company.count <= 200, draft.position.count <= 200 else { throw ShareDraftError.invalid }
        let existing = try list()
        if let same = existing.first(where: { $0.url == draft.url && $0.company == draft.company && $0.position == draft.position }) { return same }
        guard existing.count < 50 else { throw ShareDraftError.full }
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try JSONEncoder().encode(draft).write(to: directory.appendingPathComponent(draft.id.uuidString + ".json"), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        return draft
    }
    func remove(_ id: UUID) throws {
        let file = directory.appendingPathComponent(id.uuidString + ".json")
        if FileManager.default.fileExists(atPath: file.path) { try FileManager.default.removeItem(at: file) }
    }
}
