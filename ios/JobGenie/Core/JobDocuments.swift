import Foundation

enum JobDocumentKind: String, Codable, CaseIterable, Identifiable {
    case resume, coverLetter, portfolio
    var id: String { rawValue }
    var title: String { switch self { case .resume: "简历"; case .coverLetter: "求职信"; case .portfolio: "作品集" } }
}
struct JobDocument: Decodable, Identifiable {
    let id: String
    let kind: JobDocumentKind
    let version: Int
    let label: String
    let name: String
    let type: String
    let size: String
    let uploadDate: Date
    var attachment: Attachment { Attachment(id: id, name: name, type: type, size: size, uploadDate: uploadDate) }
}
extension APIClient {
    func jobDocuments(_ jobID: String) async throws -> [JobDocument] {
        guard AttachmentPolicy.validID(jobID) else { throw APIError.invalidInput }
        struct Result: Decodable { let documents: [JobDocument] }
        let result: Result = try await get("api/jobs/\(jobID)/documents")
        return result.documents
    }
    func linkDocument(jobID: String, fileID: String, kind: JobDocumentKind, label: String) async throws {
        guard AttachmentPolicy.validID(jobID), AttachmentPolicy.validID(fileID), label.count <= 200 else { throw APIError.invalidInput }
        struct Body: Encodable { let fileId: String; let kind: JobDocumentKind; let label: String }
        _ = try await send("api/jobs/\(jobID)/documents", method: "POST", body: JSONEncoder().encode(Body(fileId: fileID, kind: kind, label: label)))
    }
    func jobDocumentData(jobID: String, documentID: String) async throws -> Data {
        guard AttachmentPolicy.validID(jobID), AttachmentPolicy.validID(documentID) else { throw APIError.invalidInput }
        return try await send("api/jobs/\(jobID)/documents/\(documentID)", binary: true)
    }
}
