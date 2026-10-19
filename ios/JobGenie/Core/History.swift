import Foundation

struct HistorySource: Decodable, Equatable {
    var provider: String?
    var subject: String?
    var from: String?
}
struct HistoryEntry: Decodable, Identifiable, Equatable {
    var id: String
    var status: ApplicationStatus
    var date: Date
    var notes: String?
    var interviewStage: String?
    var createdAt: Date?
    var statusApplied: Bool?
    var source: HistorySource?
    var scheduledTime: Date?
    var deadline: Date?
    enum CodingKeys: String, CodingKey {
        case id = "_id", status, date, notes, interviewStage, createdAt, statusApplied, source, scheduledTime, deadline
    }
    var affectsCurrentStatus: Bool { statusApplied != false }
    static func newestFirst(_ lhs: Self, _ rhs: Self) -> Bool {
        if lhs.date != rhs.date { return lhs.date > rhs.date }
        if lhs.createdAt != rhs.createdAt { return (lhs.createdAt ?? .distantPast) > (rhs.createdAt ?? .distantPast) }
        return lhs.id > rhs.id
    }
}

/// Only editable history fields are sent. Source, statusApplied, scheduling and
/// reminder fields remain owned by the server and survive a metadata edit.
struct HistoryDraft: Encodable {
    var status: ApplicationStatus
    var date: Date
    var interviewStage: String
    var notes: String
    init(entry: HistoryEntry? = nil, status: ApplicationStatus = .applied, now: Date = .now) {
        self.status = entry?.status ?? status
        date = entry?.date ?? now
        interviewStage = entry?.interviewStage ?? ""
        notes = entry?.notes ?? ""
    }
    var normalized: Self {
        var value = self
        value.notes = notes.trimmingCharacters(in: .whitespacesAndNewlines)
        value.interviewStage = status == .interviewing ? interviewStage.trimmingCharacters(in: .whitespacesAndNewlines) : ""
        return value
    }
    static let dateRange = Date(timeIntervalSince1970: 0)...Date(timeIntervalSince1970: 253402300799)
    var validationMessage: String? {
        if !date.timeIntervalSince1970.isFinite || !Self.dateRange.contains(date) { return "请选择有效的状态发生时间。" }
        if normalized.notes.utf16.count > 10000 { return "备注不能超过 10,000 个字符。" }
        if normalized.interviewStage.utf16.count > 200 { return "面试或笔试阶段不能超过 200 个字符。" }
        return nil
    }
    enum CodingKeys: String, CodingKey { case status, date, interviewStage, notes }
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        try container.encode(status, forKey: .status)
        try container.encode(formatter.string(from: date), forKey: .date)
        try container.encode(interviewStage, forKey: .interviewStage)
        try container.encode(notes, forKey: .notes)
    }
}
struct HistoryMutationResponse: Decodable {
    let job: Job
    let statusHistory: HistoryEntry?
}
