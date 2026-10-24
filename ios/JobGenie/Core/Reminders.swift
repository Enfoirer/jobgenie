import Foundation

struct ReminderSettings: Codable, Equatable {
    var enabled = true
    var leadMinutes = 60
    static let leadTimes = [15, 30, 60, 1440]
    var isValid: Bool { Self.leadTimes.contains(leadMinutes) }
    static func title(_ minutes: Int) -> String {
        switch minutes { case 15: "提前 15 分钟"; case 30: "提前 30 分钟"; case 1440: "提前 24 小时"; default: "提前 1 小时" }
    }
}
enum ReminderStatus: String, Codable { case unread, read, snoozed, cancelled }
enum ReminderAction: String, Encodable { case read, snooze, cancel }
enum ReminderFilter: String, CaseIterable, Identifiable {
    case unread, snoozed, handled
    var id: String { rawValue }
    var title: String { switch self { case .unread: "未读"; case .snoozed: "已延后"; case .handled: "已处理" } }
    func includes(_ status: ReminderStatus) -> Bool {
        switch self { case .unread: status == .unread; case .snoozed: status == .snoozed; case .handled: status == .read || status == .cancelled }
    }
}
struct ReminderItem: Decodable, Identifiable, Equatable {
    let id: String
    let historyId: String
    let jobId: String
    let kind: String
    let revision: Int
    var company: String
    var position: String
    let label: String
    let time: Date
    let dueAt: Date
    var status: ReminderStatus
    var snoozedUntil: Date?
    let canSnooze: Bool
    var title: String { ScheduleEvent(id: id, jobId: jobId, company: company, position: position, kind: kind, time: time, label: label).title }
    var statusTitle: String { switch status { case .unread: "未读"; case .read: "已读"; case .snoozed: "已延后"; case .cancelled: "已取消提醒" } }
}
struct RemindersResponse: Decodable {
    let settings: ReminderSettings
    let reminders: [ReminderItem]
    let unreadCount: Int
    let serverTime: Date
}
struct ReminderActionBody: Encodable {
    let historyId: String
    let kind: String
    let revision: Int
    let action: ReminderAction
}
extension APIClient {
    func actOnReminder(_ item: ReminderItem, action: ReminderAction) async throws {
        struct Result: Decodable { let success: Bool }
        let body = ReminderActionBody(historyId: item.historyId, kind: item.kind, revision: item.revision, action: action)
        let data = try await send("api/reminders", method: "PATCH", body: JSONEncoder().encode(body))
        guard try JSONDecoder().decode(Result.self, from: data).success else { throw APIError.invalidResponse }
    }
    func saveReminderSettings(_ settings: ReminderSettings) async throws -> ReminderSettings {
        guard settings.isValid else { throw APIError.invalidInput }
        struct Result: Decodable { let settings: ReminderSettings }
        let data = try await send("api/reminders/settings", method: "PATCH", body: JSONEncoder().encode(settings))
        return try JSONDecoder().decode(Result.self, from: data).settings
    }
}
