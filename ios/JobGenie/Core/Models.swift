import Foundation

enum ApplicationStatus: String, Codable, CaseIterable, Identifiable {
    case applied, interviewing, offer, rejected
    var id: String { rawValue }
    var title: String {
        switch self { case .applied: "已申请"; case .interviewing: "面试中"; case .offer: "已获 Offer"; case .rejected: "未通过" }
    }
    var symbol: String {
        switch self { case .applied: "paperplane"; case .interviewing: "person.2"; case .offer: "checkmark.seal"; case .rejected: "archivebox" }
    }
}

struct Job: Codable, Identifiable, Equatable {
    var id: String
    var company: String
    var position: String
    var location: String?
    var notes: String?
    var jobUrl: String?
    var status: ApplicationStatus
    var dateApplied: Date
    enum CodingKeys: String, CodingKey { case id = "_id", company, position, location, notes, jobUrl, status, dateApplied }
}
struct JobDraft: Encodable {
    var company = ""
    var position = ""
    var location = ""
    var notes = ""
    var jobUrl = ""
    init(job: Job? = nil) {
        if let job { company = job.company; position = job.position; location = job.location ?? ""; notes = job.notes ?? ""; jobUrl = job.jobUrl ?? "" }
    }
    var normalized: Self {
        var copy = self
        copy.company = company.trimmingCharacters(in: .whitespacesAndNewlines)
        copy.position = position.trimmingCharacters(in: .whitespacesAndNewlines)
        copy.location = location.trimmingCharacters(in: .whitespacesAndNewlines)
        copy.notes = notes.trimmingCharacters(in: .whitespacesAndNewlines)
        copy.jobUrl = jobUrl.trimmingCharacters(in: .whitespacesAndNewlines)
        return copy
    }
    var validationMessage: String? {
        let d = normalized
        if d.company.isEmpty || d.position.isEmpty { return "请填写公司和职位。" }
        if d.company.count > 200 || d.position.count > 200 || d.location.count > 200 { return "公司、职位和地点不能超过 200 个字符。" }
        if d.notes.count > 10000 { return "备注不能超过 10,000 个字符。" }
        if !d.jobUrl.isEmpty && (d.jobUrl.count > 2048 || Self.safeURL(d.jobUrl) == nil) { return "请填写完整的 http 或 https 岗位链接。" }
        return nil
    }
    static func safeURL(_ string: String) -> URL? {
        guard let url = URL(string: string), ["http", "https"].contains(url.scheme?.lowercased() ?? ""),
              url.host != nil, url.user == nil, url.password == nil else { return nil }
        return url
    }
}
struct HistoryEntry: Decodable, Identifiable {
    let id: String
    let status: ApplicationStatus
    let date: Date
    let notes: String?
    let interviewStage: String?
    enum CodingKeys: String, CodingKey { case id = "_id", status, date, notes, interviewStage }
}
struct ScheduleEvent: Decodable, Identifiable {
    let id: String
    let jobId: String
    let company: String
    let position: String
    let kind: String
    let time: Date?
    let label: String
    func bucket(at now: Date) -> ScheduleBucket { guard let time else { return .unscheduled }; return time < now ? .past : .upcoming }
    var title: String { kind == "deadline" ? "截止时间" : "面试 / 笔试" }
}
enum ScheduleBucket: String, CaseIterable, Identifiable {
    case upcoming, past, unscheduled
    var id: String { rawValue }
    var title: String { switch self { case .upcoming: "即将到来"; case .past: "已过时间"; case .unscheduled: "时间待补充" } }
}
struct Mailbox: Decodable, Identifiable {
    let id: String
    let provider: String
    let emailAddress: String
}
struct SessionUser: Codable { let id: String; let name: String?; let email: String }
struct SessionResponse: Decodable { let user: SessionUser?; let expires: Date? }
struct JobsResponse: Decodable { let jobs: [Job] }
struct JobResponse: Decodable { let job: Job }
struct HistoryResponse: Decodable { let statusHistory: [HistoryEntry] }
struct ScheduleResponse: Decodable { let events: [ScheduleEvent] }
struct MailboxesResponse: Decodable { let accounts: [Mailbox] }

extension JSONDecoder {
    static var jobGenie: JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let container = try decoder.singleValueContainer()
            let text = try container.decode(String.self)
            let formatter = ISO8601DateFormatter()
            formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            if let date = formatter.date(from: text) { return date }
            formatter.formatOptions = [.withInternetDateTime]
            if let date = formatter.date(from: text) { return date }
            throw DecodingError.dataCorruptedError(in: container, debugDescription: "Invalid ISO 8601 date")
        }
        return decoder
    }
}
