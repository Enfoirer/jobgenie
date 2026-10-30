import Foundation

enum ScheduleKind: String, CaseIterable, Identifiable {
    case appointment, deadline
    var id: String { rawValue }
    var editTitle: String { self == .appointment ? "编辑面试时间" : "编辑笔试截止时间" }
}

/// A partial PATCH: nil explicitly clears this field; the other date is omitted.
struct ScheduleDraft: Encodable {
    let kind: ScheduleKind
    var time: Date?
    var isValid: Bool {
        guard let time else { return true }
        return time.timeIntervalSince1970.isFinite && HistoryDraft.dateRange.contains(time)
    }
    enum CodingKeys: String, CodingKey { case scheduledTime, deadline }
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        let key: CodingKeys = kind == .appointment ? .scheduledTime : .deadline
        if let time {
            let formatter = ISO8601DateFormatter()
            formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            try container.encode(formatter.string(from: time), forKey: key)
        } else { try container.encodeNil(forKey: key) }
    }
}

extension ScheduleEvent {
    // Mirrors lib/schedule/events.js for demo and confirmed mutation responses.
    static func project(_ entry: HistoryEntry, job: Job) -> [Self] {
        guard job.archivedAt == nil else { return [] }
        let stage = (entry.interviewStage ?? "").trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let assessment = ["online assessment", "oa", "笔试"].contains(stage)
            || ((entry.interviewStage ?? "").isEmpty && entry.source?.eventType == "oa")
        var result: [Self] = []
        func append(_ kind: ScheduleKind, _ time: Date?, _ label: String) {
            result.append(Self(historyId: entry.id, id: "\(entry.id):\(kind.rawValue)", jobId: job.id,
                               company: job.company, position: job.position, kind: kind.rawValue, time: time, label: label))
        }
        if let time = entry.scheduledTime { append(.appointment, time, assessment ? "Assessment appointment" : "Interview") }
        if let time = entry.deadline { append(.deadline, time, assessment ? "Assessment deadline" : "Deadline") }
        if entry.status == .interviewing {
            if assessment && entry.deadline == nil { append(.deadline, nil, "Assessment deadline") }
            if !assessment && entry.scheduledTime == nil { append(.appointment, nil, "Interview") }
        }
        return result
    }
}
