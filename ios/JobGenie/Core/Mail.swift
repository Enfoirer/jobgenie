import Foundation

struct MailBacklog: Decodable { var pending: Int; var processing: Int; var failed: Int; var pendingReview: Int }
struct MailFailure: Decodable, Identifiable { let id: String; let subject: String; let attempts: Int }
struct MailRun: Decodable {
    var totalFetched: Int?; var processed: Int?; var failed: Int?; var pendingReview: Int?
    var applied: Int?; var historical: Int?; var skipped: Int?; var retried: Int?
    var errorCount: Int?; var hasMore: Bool?; var finishedAt: Date?
    var errorStages: [String]?
    static func stageTitle(_ stage: String) -> String {
        switch stage {
        case "ingest": "拉取邮件失败，请检查邮箱授权后重新同步。"
        case "process": "邮件处理失败，可重试失败邮件。"
        case "queue": "读取处理队列失败，请重试。"
        case "summary": "读取同步汇总失败，请刷新。"
        case "result": "保存同步结果失败，请刷新。"
        default: "同步遇到错误，请刷新后重试。"
        }
    }
}
struct MailSyncResponse: Decodable {
    let accounts: [MailAccountRun]
    struct MailAccountRun: Decodable { let accountId: String; let totalFetched: Int; let processed: Int; let failed: Int; let pendingReview: Int; let errorCount: Int }
}
enum MailEventType: String, CaseIterable, Identifiable {
    case submission, oa, interview, rejection, offer
    var id: String { rawValue }
    var title: String {
        switch self { case .submission: "申请确认"; case .oa: "笔试"; case .interview: "面试"; case .rejection: "拒信"; case .offer: "Offer" }
    }
    var status: ApplicationStatus {
        switch self { case .submission: .applied; case .oa, .interview: .interviewing; case .rejection: .rejected; case .offer: .offer }
    }
}
struct PendingMail: Decodable, Identifiable {
    let id: String
    var subject: String?; var from: String?; var snippet: String?; var receivedAt: Date?
    var company: String?; var position: String?; var eventType: String?
    var interviewTime: Date?; var deadline: Date?; var summary: String?; var confidence: Double?
    var targetJobId: String?; var reviewReasons: [String]?
    enum CodingKeys: String, CodingKey { case id = "_id", subject, from, snippet, receivedAt, company, position, eventType, interviewTime, deadline, summary, confidence, targetJobId, reviewReasons }
}
struct PendingResponse: Decodable { let items: [PendingMail] }
struct ReviewResponse: Decodable { let jobId: String?; let statusApplied: Bool? }
struct MailReviewDraft: Encodable {
    var company: String; var position: String; var eventType: String; var target: String
    var interviewTime: Date?; var deadline: Date?
    init(_ item: PendingMail) {
        company = item.company ?? ""; position = item.position ?? ""; eventType = item.eventType ?? "other"
        target = item.targetJobId ?? ""; interviewTime = item.interviewTime; deadline = item.deadline
    }
    var isValid: Bool {
        MailEventType(rawValue: eventType) != nil && !target.isEmpty
            && (target != "new" || (!company.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !position.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty))
            && company.utf16.count <= 200 && position.utf16.count <= 200
            && [interviewTime, deadline].allSatisfy { ScheduleDraft(kind: .appointment, time: $0).isValid }
    }
    enum CodingKeys: String, CodingKey { case company, position, eventType, targetJobId, createNew, interviewTime, deadline }
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(company.trimmingCharacters(in: .whitespacesAndNewlines), forKey: .company)
        try c.encode(position.trimmingCharacters(in: .whitespacesAndNewlines), forKey: .position)
        try c.encode(eventType, forKey: .eventType)
        if target == "new" { try c.encodeNil(forKey: .targetJobId) } else { try c.encode(target, forKey: .targetJobId) }
        try c.encode(target == "new", forKey: .createNew)
        let formatter = ISO8601DateFormatter(); formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        for (key, time) in [(CodingKeys.interviewTime, interviewTime), (.deadline, deadline)] {
            if let time { try c.encode(formatter.string(from: time), forKey: key) } else { try c.encodeNil(forKey: key) }
        }
    }
}
extension APIClient {
    func syncMail(accountID: String, retry: Bool) async throws -> MailSyncResponse {
        struct Body: Encodable { let action: String; let accountId: String }
        let data = try await send("api/mail", method: "POST", body: JSONEncoder().encode(Body(action: retry ? "retry" : "sync", accountId: accountID)))
        return try JSONDecoder.jobGenie.decode(MailSyncResponse.self, from: data)
    }
    func reviewMail(id: String, draft: MailReviewDraft, ignore: Bool) async throws -> ReviewResponse {
        guard ignore || draft.isValid else { throw APIError.invalidInput }
        struct Body: Encodable { let action: String; let updates: MailReviewDraft? }
        let data = try await send("api/pending/\(id)", method: "PATCH", body: JSONEncoder().encode(Body(action: ignore ? "ignore" : "accept", updates: ignore ? nil : draft)))
        return try JSONDecoder.jobGenie.decode(ReviewResponse.self, from: data)
    }
}
