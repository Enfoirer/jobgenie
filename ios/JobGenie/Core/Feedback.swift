import SwiftUI
import UIKit

struct FeedbackResponse: Decodable, Equatable {
    let overall: Int
    let recommendation: Int
    let comment: String
    let source: String
    let createdAt: Date
}
struct FeedbackStatus: Decodable {
    let campaign: String
    let serverTime: Date
    let submitted: Bool
    let disabled: Bool
    let snoozedUntil: Date?
    let eligible: Bool
    let response: FeedbackResponse?
    var invitationId: String?
}
struct FeedbackDraft {
    var overall: Int?
    var recommendation: Int?
    var comment = ""
    var isValid: Bool {
        (1...5).contains(overall ?? 0) && (1...5).contains(recommendation ?? 0)
        && comment.utf16.count <= 2000
        && !comment.unicodeScalars.contains { $0.value < 32 && ![9, 10, 13].contains($0.value) }
    }
}
struct FeedbackBody: Encodable {
    let action: String
    var requestId: String?
    var invitationId: String?
    var overall: Int?
    var recommendation: Int?
    var comment: String?
    var appVersion: String = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0.1.0"
    var locale: String = "en"
}
extension APIClient {
    func feedbackStatus() async throws -> FeedbackStatus {
        try validateFeedback(await get("api/feedback"))
    }
    func feedbackAction(_ body: FeedbackBody) async throws -> FeedbackStatus {
        let data = try await send("api/feedback", method: "POST", body: JSONEncoder().encode(body))
        guard let status = try? JSONDecoder.jobGenie.decode(FeedbackStatus.self, from: data) else { throw APIError.invalidResponse }
        return try validateFeedback(status)
    }
    private func validateFeedback(_ status: FeedbackStatus) throws -> FeedbackStatus {
        guard status.campaign == "ios-product-v1", status.invitationId == nil || UUID(uuidString: status.invitationId!) != nil,
              status.response.map({ (1...5).contains($0.overall) && (1...5).contains($0.recommendation) && ["manual", "prompt"].contains($0.source) }) ?? true else { throw APIError.invalidResponse }
        return status
    }
}
struct FeedbackPresentation: Identifiable {
    let id = UUID()
    let invitationID: String?
}
private struct FeedbackPreference: Codable {
    var action: String
    var requestID: String
    var invitationID: String?
    var until: Date?
    var pending = true
}

@MainActor
final class FeedbackCoordinator: ObservableObject {
    @Published var presentation: FeedbackPresentation?
    @Published private(set) var status: FeedbackStatus?
    @Published private(set) var busy = false
    @Published var error: UserMessage?
    @Published var notice: UserMessage?
    var onUnauthorized: (() -> Void)?
    private let api: APIClient
    private let defaults: UserDefaults
    private var userID: String?
    private var session = UUID()
    private var demo = false
    private var preference: FeedbackPreference?
    private var visitingDay: String?
    private var requestBusy = false
    private var shownThisSession = false
    private var invitationRequest = UUID().uuidString
    private var pendingInvitation: String?
    private var foregroundSince: TimeInterval?
    private var foregroundSeconds: TimeInterval = 0
    private var lastInteraction: TimeInterval = 0
    private var key: String? { userID.map { "jobgenie.feedback.\(api.baseURL.absoluteString).\($0)" } }
    init(api: APIClient, defaults: UserDefaults = .standard) { self.api = api; self.defaults = defaults }
    func start(userID: String?, demo: Bool) {
        guard self.userID != userID || self.demo != demo else { return }
        reset(); self.userID = userID; self.demo = demo
        if let key, let data = defaults.data(forKey: key) { preference = try? JSONDecoder().decode(FeedbackPreference.self, from: data) }
    }
    func reset() {
        session = UUID(); userID = nil; demo = false; presentation = nil; status = nil; busy = false
        error = nil; notice = nil; preference = nil; visitingDay = nil; requestBusy = false
        shownThisSession = false; invitationRequest = UUID().uuidString; pendingInvitation = nil
        foregroundSince = nil; foregroundSeconds = 0; lastInteraction = 0
    }
    func setForeground(_ active: Bool, uptime: TimeInterval = ProcessInfo.processInfo.systemUptime) {
        if active { if foregroundSince == nil { foregroundSince = uptime }; lastInteraction = uptime }
        else if let since = foregroundSince { foregroundSeconds += max(0, uptime - since); foregroundSince = nil }
    }
    func interacted(uptime: TimeInterval = ProcessInfo.processInfo.systemUptime) { lastInteraction = uptime }
    func canPrompt(blocked: Bool, now: Date = .now, uptime: TimeInterval = ProcessInfo.processInfo.systemUptime) -> Bool {
        guard userID != nil, !demo, foregroundSince != nil, !blocked, !busy, presentation == nil,
              !shownThisSession, preference?.action != "never", !(preference?.until.map { $0 > now } ?? false),
              status?.disabled != true, status?.submitted != true else { return false }
        let active = foregroundSeconds + max(0, uptime - (foregroundSince ?? uptime))
        return active >= 120 && uptime - lastInteraction >= 30
    }
    private func persistPreference() {
        if let key, let preference, let data = try? JSONEncoder().encode(preference) { defaults.set(data, forKey: key) }
    }
    private func storeStatus(_ result: FeedbackStatus) {
        // Submission and permanent opt-out are monotonic for this campaign.
        // A late GET/display acknowledgment must not erase a confirmed write.
        let submitted = result.submitted || status?.submitted == true
        let disabled = result.disabled || status?.disabled == true
        status = FeedbackStatus(campaign: result.campaign, serverTime: result.serverTime,
            submitted: submitted, disabled: disabled, snoozedUntil: result.snoozedUntil,
            eligible: result.eligible && !submitted && !disabled, response: result.response ?? status?.response,
            invitationId: result.invitationId)
    }
    private func failed(_ failure: Error) {
        if failure as? APIError == .unauthorized { reset(); onUnauthorized?() }
        else if !(failure is CancellationError) { error = (failure as? APIError)?.userMessage ?? .text("反馈暂时无法发送，请检查网络后重试。") }
    }
    private func syncPreference(locale: String) async {
        guard let preference, preference.pending, !demo else { return }
        let current = session
        do {
            let result = try await api.feedbackAction(FeedbackBody(action: preference.action, requestId: preference.requestID, invitationId: preference.invitationID, locale: locale))
            guard current == session, self.preference?.requestID == preference.requestID else { return }
            storeStatus(result); self.preference?.pending = false; persistPreference()
        } catch { if current == session && error as? APIError == .unauthorized { failed(error) } }
    }
    func tick(blocked: Bool, safe: @MainActor () -> Bool, locale: String, now: Date = .now, uptime: TimeInterval = ProcessInfo.processInfo.systemUptime) async {
        guard userID != nil, !demo, foregroundSince != nil, !requestBusy else { return }
        requestBusy = true; let current = session
        defer { if current == session { requestBusy = false } }
        await syncPreference(locale: locale)
        guard current == session else { return }
        let day = ISO8601DateFormatter().string(from: now).prefix(10).description
        do {
            if visitingDay != day {
                let result = try await api.feedbackAction(FeedbackBody(action: "visit", locale: locale))
                guard current == session else { return }; storeStatus(result); visitingDay = day
            }
            guard canPrompt(blocked: blocked, now: now, uptime: uptime), safe(), status?.eligible == true || pendingInvitation != nil else { return }
            let result = try await api.feedbackAction(FeedbackBody(action: "invite", requestId: invitationRequest, locale: locale))
            guard current == session else { return }; storeStatus(result); pendingInvitation = result.invitationId
            // Recheck the actual surface after the network wait; never interrupt a newly opened editor.
            guard let id = pendingInvitation, safe(), canPrompt(blocked: blocked, now: now, uptime: ProcessInfo.processInfo.systemUptime) else { return }
            shownThisSession = true; presentation = FeedbackPresentation(invitationID: id)
        } catch { if current == session && error as? APIError == .unauthorized { failed(error) } }
    }
    func acknowledgeShown(locale: String) async {
        guard let id = presentation?.invitationID, !demo else { return }
        let current = session
        do {
            let result = try await api.feedbackAction(FeedbackBody(action: "shown", invitationId: id, locale: locale))
            if current == session { storeStatus(result) }
        } catch { if current == session && error as? APIError == .unauthorized { failed(error) } }
    }
    func openManual(locale: String) async {
        guard userID != nil, !busy, presentation == nil else { return }
        error = nil; notice = nil; presentation = FeedbackPresentation(invitationID: nil)
        let presentationID = presentation?.id
        guard !demo else { return }
        let current = session
        await syncPreference(locale: locale)
        do { let result = try await api.feedbackStatus(); if current == session && presentation?.id == presentationID { storeStatus(result) } }
        catch { if current == session && presentation?.id == presentationID { failed(error) } }
    }
    func dismiss(never: Bool, locale: String, now: Date = .now) async {
        guard !busy, presentation != nil else { return }
        let id = presentation?.invitationID
        presentation = nil; error = nil; shownThisSession = true
        guard !demo else { notice = .text("演示选择不会保存到真实账号。"); return }
        if preference?.action != "never" {
            preference = FeedbackPreference(action: never ? "never" : "later", requestID: UUID().uuidString, invitationID: id, until: never ? nil : now.addingTimeInterval(14 * 86400))
            persistPreference()
        }
        notice = .text(never ? "已关闭自动评价邀请。离线时会在联网后同步，你仍可主动反馈。" : "稍后再说。至少 14 天内不会自动邀请，离线选择会在联网后同步。")
        await syncPreference(locale: locale)
    }
    func submit(_ draft: FeedbackDraft, locale: String) async {
        guard draft.isValid, !busy, userID != nil, presentation != nil else { return }
        error = nil; busy = true; let current = session
        defer { if current == session { busy = false } }
        if demo { presentation = nil; notice = .text("演示反馈未提交到真实数据库。"); return }
        do {
            if presentation?.invitationID != nil { await acknowledgeShown(locale: locale) }
            guard current == session else { return }
            let result = try await api.feedbackAction(FeedbackBody(action: "submit", invitationId: presentation?.invitationID, overall: draft.overall, recommendation: draft.recommendation, comment: draft.comment, locale: locale))
            guard current == session else { return }
            guard result.submitted else { throw APIError.invalidResponse }
            storeStatus(result); presentation = nil; shownThisSession = true; notice = .text("感谢你的反馈，已保存。"); error = nil
        } catch { if current == session { failed(error) } }
    }
}

// Only root lists opt in. Navigation, keyboards, sheets, authorization and editing
// suppress invitations. Eligibility never examines success, sentiment or job status.
private struct FeedbackSurface: ViewModifier {
    @EnvironmentObject private var feedback: FeedbackCoordinator
    @EnvironmentObject private var model: AppModel
    @Environment(\.scenePhase) private var phase
    @Environment(\.locale) private var locale
    let blocked: Bool
    @State private var visible = false
    @State private var keyboard = false
    private struct TaskKey: Equatable { let active: Bool; let blocked: Bool }
    private var safe: Bool { visible && phase == .active && !blocked && !keyboard && !model.bulkBusy && !model.mailBusy && !model.remindersBusy && !model.attachmentBusy && model.historyMutations.isEmpty && !Self.hasPresentedController() }
    private static func hasPresentedController() -> Bool {
        func interacting(_ view: UIView) -> Bool {
            if let scroll = view as? UIScrollView, scroll.isTracking || scroll.isDragging || scroll.isDecelerating { return true }
            if let control = view as? UIControl, control.isTracking { return true }
            return view.subviews.contains(where: interacting)
        }
        func presented(_ controller: UIViewController) -> Bool {
            controller.presentedViewController != nil || controller.children.contains(where: presented)
                || (controller.viewIfLoaded.map(interacting) ?? false)
        }
        return UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.flatMap(\.windows).filter(\.isKeyWindow).contains { $0.rootViewController.map(presented) ?? false }
    }
    @ViewBuilder private func tracking(_ content: Content) -> some View {
        if #available(iOS 18, *) {
            content.onScrollPhaseChange { _, phase in if phase != .idle { feedback.interacted() } }
        } else { content }
    }
    func body(content: Content) -> some View {
        tracking(content)
            .onAppear { visible = true; feedback.interacted() }
            .onDisappear { visible = false; feedback.interacted() }
            .onChange(of: blocked) { _, _ in feedback.interacted() }
            .onChange(of: model.bulkBusy || model.mailBusy || model.remindersBusy || model.attachmentBusy || !model.historyMutations.isEmpty) { _, _ in feedback.interacted() }
            .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillShowNotification)) { _ in keyboard = true; feedback.interacted() }
            .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillHideNotification)) { _ in keyboard = false; feedback.interacted() }
            .task(id: TaskKey(active: phase == .active, blocked: blocked)) {
                guard phase == .active else { return }
                while !Task.isCancelled {
                    await feedback.tick(blocked: !safe, safe: { safe }, locale: locale.identifier)
                    do { try await Task.sleep(for: .seconds(15)) } catch { return }
                }
            }
    }
}
extension View {
    func feedbackSurface(blocked: Bool = false) -> some View { modifier(FeedbackSurface(blocked: blocked)) }
}
