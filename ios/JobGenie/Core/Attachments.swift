import Foundation

struct Attachment: Decodable, Identifiable, Equatable {
    let id: String
    let name: String
    let type: String
    let size: String
    let uploadDate: Date
    // filePath from the server is deliberately ignored; requests use a validated ID.
    var canPreview: Bool { (try? AttachmentPolicy.mime(name: name)) == type }
}
enum AttachmentPolicy {
    static let maxBytes = 4 * 1024 * 1024
    static let types = ["pdf": "application/pdf", "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg"]
    static func mime(name: String) throws -> String {
        guard !name.isEmpty, name == name.trimmingCharacters(in: .whitespacesAndNewlines), name.count <= 180, name.utf8.count <= 240,
              !name.hasPrefix("."), !name.hasSuffix("."), !name.contains(where: { "/\\:*?\"<>|".contains($0) }),
              name.unicodeScalars.allSatisfy({ !CharacterSet.controlCharacters.contains($0) && $0.properties.generalCategory != .format }),
              name.contains("."), let type = types[(name as NSString).pathExtension.lowercased()] else { throw APIError.unsupportedFile }
        return type
    }
    static func validate(name: String, data: Data) throws -> String {
        guard !data.isEmpty else { throw APIError.unsupportedFile }
        guard data.count <= maxBytes else { throw APIError.fileTooLarge }
        return try mime(name: name)
    }
    static func validID(_ id: String) -> Bool { id.range(of: "^[a-fA-F0-9]{24}$", options: .regularExpression) != nil }
    static func multipart(name: String, data: Data, boundary: String) throws -> Data {
        let type = try validate(name: name, data: data)
        var result = Data("--\(boundary)\r\nContent-Disposition: form-data; name=\"file\"; filename=\"\(name)\"\r\nContent-Type: \(type)\r\n\r\n".utf8)
        result.append(data); result.append(Data("\r\n--\(boundary)--\r\n".utf8)); return result
    }
    static func read(_ url: URL) throws -> Data {
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        _ = try mime(name: url.lastPathComponent)
        let handle = try FileHandle(forReadingFrom: url); defer { try? handle.close() }
        let data = try handle.read(upToCount: maxBytes + 1) ?? Data()
        _ = try validate(name: url.lastPathComponent, data: data)
        return data
    }
}
final class AttachmentCache {
    private let root: URL
    init(root: URL = FileManager.default.temporaryDirectory.appendingPathComponent("jobgenie-previews", isDirectory: true)) { self.root = root; clear() }
    func clear() { try? FileManager.default.removeItem(at: root) }
    func store(_ data: Data, name: String) throws -> URL {
        _ = try AttachmentPolicy.validate(name: name, data: data)
        let directory = root.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.protectionKey: FileProtectionType.complete])
        let url = directory.appendingPathComponent(name)
        try data.write(to: url, options: [.atomic, .completeFileProtection]); return url
    }
}
extension APIClient {
    func uploadAttachment(name: String, data: Data) async throws -> Attachment {
        struct Result: Decodable { let success: Bool; let file: Attachment }
        let boundary = "JobGenie-" + UUID().uuidString
        let body = try AttachmentPolicy.multipart(name: name, data: data, boundary: boundary)
        let result = try JSONDecoder.jobGenie.decode(Result.self, from: await send("api/uploads", method: "POST", body: body, contentType: "multipart/form-data; boundary=\(boundary)"))
        guard result.success else { throw APIError.invalidResponse }; return result.file
    }
    func downloadAttachment(_ file: Attachment) async throws -> Data {
        guard AttachmentPolicy.validID(file.id) else { throw APIError.invalidInput }
        return try await send("api/uploads/download/\(file.id)", binary: true)
    }
}
extension AppModel {
    func resetResources() {
        analytics = nil; analyticsRequest = UUID(); attachments = []; attachmentsRequest = UUID()
        attachmentNotice = nil; attachmentBusy = false; demoAttachmentData = [:]; attachmentCache.clear()
    }
    func loadAttachments() async throws {
        guard user != nil else { throw CancellationError() }
        if isDemo { return }
        let current = sessionGeneration, request = UUID(); attachmentsRequest = request
        do {
            struct Result: Decodable { let files: [Attachment] }
            let result: Result = try await api.get("api/uploads")
            guard current == sessionGeneration, request == attachmentsRequest else { throw CancellationError() }
            attachments = result.files
        } catch { try await resourceError(error, generation: current); throw error }
    }
    func uploadAttachment(name: String, data: Data) async throws {
        guard user != nil, !attachmentBusy else { throw APIError.conflict }
        _ = try AttachmentPolicy.validate(name: name, data: data)
        let current = sessionGeneration; attachmentBusy = true; attachmentNotice = nil
        defer { if current == sessionGeneration { attachmentBusy = false } }
        do {
            let file: Attachment
            if isDemo {
                file = Attachment(id: UUID().uuidString, name: name, type: try AttachmentPolicy.mime(name: name), size: "\(Int(ceil(Double(data.count) / 1024))) KB", uploadDate: .now)
                demoAttachmentData[file.id] = data
            } else { file = try await api.uploadAttachment(name: name, data: data) }
            guard current == sessionGeneration else { throw CancellationError() }
            attachmentsRequest = UUID(); attachments.removeAll { $0.id == file.id }; attachments.insert(file, at: 0)
            attachmentNotice = .text("附件已上传。")
        } catch { try await resourceError(error, generation: current); throw error }
    }
    func attachmentData(_ file: Attachment) async throws -> Data {
        guard user != nil else { throw CancellationError() }
        let current = sessionGeneration
        do {
            let data: Data
            if isDemo { guard let stored = demoAttachmentData[file.id] else { throw APIError.notFound }; data = stored }
            else { data = try await api.downloadAttachment(file) }
            guard current == sessionGeneration else { throw CancellationError() }
            return data
        } catch { try await resourceError(error, generation: current); throw error }
    }
    private func resourceError(_ error: Error, generation: UUID) async throws {
        guard generation == sessionGeneration else { throw CancellationError() }
        if error as? APIError == .unauthorized { await signOut(); authMessage = APIError.unauthorized.userMessage }
    }
}
