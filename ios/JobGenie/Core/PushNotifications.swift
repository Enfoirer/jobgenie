import SwiftUI
import UserNotifications
import UIKit
import Security

@MainActor
protocol PushSystem {
    func authorization() async -> UNAuthorizationStatus
    func requestAuthorization() async throws -> Bool
    func register()
    func stop()
    func clear()
    func removeInvalid(bindingID: String, reminderIDs: Set<String>, isCurrent: @MainActor () -> Bool) async
}
@MainActor
struct ApplePushSystem: PushSystem {
    func authorization() async -> UNAuthorizationStatus { await UNUserNotificationCenter.current().notificationSettings().authorizationStatus }
    func requestAuthorization() async throws -> Bool { try await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) }
    func register() { UIApplication.shared.registerForRemoteNotifications() }
    func stop() { UIApplication.shared.unregisterForRemoteNotifications() }
    func clear() {
        let center = UNUserNotificationCenter.current()
        center.removeAllDeliveredNotifications(); center.removeAllPendingNotificationRequests()
    }
    func removeInvalid(bindingID: String, reminderIDs: Set<String>, isCurrent: @MainActor () -> Bool) async {
        let center = UNUserNotificationCenter.current()
        let delivered = await center.deliveredNotifications()
        guard isCurrent() else { return }
        let invalid = delivered.filter {
            guard let data = $0.request.content.userInfo["jg"] as? [String: String], data["bindingId"] == bindingID,
                  let id = data["reminderId"], reminderIDs.contains(id) else { return true }
            return false
        }
        center.removeDeliveredNotifications(withIdentifiers: invalid.map { $0.request.identifier })
    }
}
struct PushCapability: Codable {
    var installationKey: String
    var sequence: Int = 0
    var enabledUserID: String?
    var token: String?
    var locale = "en"
    var bindingID: String?
    var pendingRevoke: Int?
    static func create() throws -> PushCapability {
        var bytes = [UInt8](repeating: 0, count: 32)
        guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else { throw APIError.secureStorage }
        return PushCapability(installationKey: bytes.map { String(format: "%02x", $0) }.joined())
    }
}
struct PushAvailability: Decodable { let available: Bool; let environments: [String] }
struct PushRegistration: Encodable {
    let installationKey: String; let sequence: Int; let token: String; let environment: String; let locale: String
}
struct PushRevoke: Encodable { let installationKey: String; let sequence: Int }
struct PushResolution: Encodable { let installationKey: String; let sequence: Int; let deliveryId: String }
struct PushDestination: Identifiable { let id = UUID(); let jobID: String }
struct PushNotice: Sendable {
    let deliveryID: String
    let bindingID: String
    init?(userInfo: [AnyHashable: Any]) {
        guard let data = userInfo["jg"] as? [String: String], let delivery = data["deliveryId"], let binding = data["bindingId"],
              delivery.count == 64, delivery.allSatisfy({ $0.isHexDigit }), UUID(uuidString: binding) != nil else { return nil }
        deliveryID = delivery; bindingID = binding
    }
}

@MainActor
final class PushCoordinator: ObservableObject {
    var onUnauthorized: (() -> Void)?
    @Published private(set) var available = false
    @Published private(set) var enabled = false
    @Published private(set) var busy = false
    @Published private(set) var notice: UserMessage?
    @Published var destination: PushDestination?
    private let api: APIClient
    private let revokeAPI: APIClient
    private let system: any PushSystem
    private let vault: any SessionVault
    private var capability: PushCapability?
    private var userID: String?
    private var locale = "en"
    private var demo = false
    private var generation = UUID()
    private var registering = false
    private var refreshing = false
    private var revoking = false
    private var allowedEnvironments: [String] = []
    private var pendingTap: PushNotice?
    private static var environment: String {
        #if DEBUG
        "sandbox"
        #else
        "production"
        #endif
    }
    init(api: APIClient, system: any PushSystem = ApplePushSystem(), vault: (any SessionVault)? = nil, revokeAPI: APIClient? = nil) {
        self.api = api; self.system = system
        self.vault = vault ?? KeychainSessionVault(account: "push-installation:\(api.baseURL.absoluteString)")
        self.revokeAPI = revokeAPI ?? APIClient(baseURL: api.baseURL)
    }
    private func load() throws {
        guard capability == nil else { return }
        if let data = try vault.read() {
            let saved = try JSONDecoder().decode(PushCapability.self, from: data)
            guard saved.installationKey.count == 64, saved.installationKey.allSatisfy({ $0.isHexDigit }), saved.sequence >= 0 else { throw APIError.secureStorage }
            capability = saved
        }
    }
    private func persist(_ value: PushCapability) throws {
        try vault.write(JSONEncoder().encode(value)); capability = value
    }
    func context(userID: String?, demo: Bool, locale: String) async {
        let target = demo ? nil : userID
        if self.userID != target || self.demo != demo { generation = UUID(); busy = false; destination = nil; system.clear() }
        self.userID = target; self.demo = demo; self.locale = locale.lowercased().hasPrefix("zh") ? "zh-Hans" : "en"
        do {
            try load()
            if let owner = capability?.enabledUserID, owner != target { detach() }
            enabled = target != nil && capability?.enabledUserID == target
            await foreground()
            if target != nil, let info = pendingTap { pendingTap = nil; _ = await receive(info, open: true) }
        } catch { enabled = false; system.stop(); system.clear(); notice = APIError.secureStorage.userMessage }
    }
    func foreground() async {
        await drainRevocation()
        guard userID != nil, !demo, !refreshing else { return }
        let current = generation
        refreshing = true
        defer {
            refreshing = false
            if current != generation, userID != nil, !demo { Task { await foreground() } }
        }
        do {
            let response: PushAvailability = try await api.get("api/push/status")
            guard current == generation else { return }
            available = response.available; allowedEnvironments = response.environments
            if enabled {
                let status = await system.authorization()
                guard current == generation else { return }
                if status == .denied { await disable(); notice = .text("系统通知已被拒绝，请到 iPhone 设置中允许通知。"); return }
                if available && allowedEnvironments.contains(Self.environment) { system.register() }
            }
        } catch {
            if current == generation {
                available = false; notice = .text("暂时无法连接通知服务，请重试。")
                if error as? APIError == .unauthorized { onUnauthorized?() }
            }
        }
    }
    func enable() async {
        guard let owner = userID, !demo, !busy else { return }
        guard available, allowedEnvironments.contains(Self.environment) else { notice = .text("此版本的系统推送尚未配置，App 内提醒仍可使用。"); return }
        let current = generation
        busy = true; notice = nil
        defer { if current == generation { busy = false } }
        do {
            guard try await system.requestAuthorization(), current == generation else {
                if current == generation { notice = .text("系统通知已被拒绝，请到 iPhone 设置中允许通知。") }; return
            }
            try load()
            var saved = try capability ?? PushCapability.create()
            saved.sequence += 1; saved.enabledUserID = owner; saved.bindingID = nil; saved.locale = locale
            try persist(saved)
            enabled = true; system.register()
            notice = .text("正在注册系统通知，请稍候。")
        } catch { if current == generation { notice = .text("无法开启系统通知，请重试。") } }
    }
    func receivedToken(_ token: Data) async {
        let hex = token.map { String(format: "%02x", $0) }.joined()
        guard let owner = userID, !demo, enabled, var saved = capability, saved.enabledUserID == owner else { return }
        if saved.token != hex || saved.locale != locale {
            saved.sequence += 1; saved.token = hex; saved.locale = locale; saved.bindingID = nil
            do { try persist(saved) } catch { notice = APIError.secureStorage.userMessage; return }
        }
        await registerCurrent()
    }
    private func registerCurrent() async {
        guard !registering, let saved = capability, let token = saved.token, let owner = userID,
              saved.enabledUserID == owner, enabled else { return }
        let current = generation, sequence = saved.sequence
        registering = true
        defer {
            registering = false
            if enabled && capability?.sequence != sequence { Task { await registerCurrent() } }
        }
        do {
            struct Result: Decodable { let bindingId: String; let enabled: Bool }
            let body = PushRegistration(installationKey: saved.installationKey, sequence: sequence, token: token, environment: Self.environment, locale: saved.locale)
            let data = try await api.send("api/push/register", method: "POST", body: JSONEncoder().encode(body))
            let response = try JSONDecoder().decode(Result.self, from: data)
            guard current == generation, capability?.sequence == sequence, userID == owner, enabled else { return }
            guard response.enabled, UUID(uuidString: response.bindingId) != nil else { throw APIError.invalidResponse }
            var latest = capability!; latest.bindingID = response.bindingId; try persist(latest)
            notice = .text("此 iPhone 的系统通知已开启。")
        } catch {
            if current == generation {
                notice = .text("设备注册尚未完成，请重试。")
                if error as? APIError == .unauthorized { onUnauthorized?() }
            }
        }
    }
    func registrationFailed() { if enabled { notice = .text("设备注册尚未完成，请重试。") } }
    func queueTap(_ info: PushNotice) async {
        if userID == nil { pendingTap = info }
        else { _ = await receive(info, open: true) }
    }
    // Clear locally before any network await. Revocation uses its own cookie-free
    // client so session clearing cannot cancel it; failures remain in Keychain.
    func detach() {
        generation = UUID(); enabled = false; busy = false; available = false; destination = nil; pendingTap = nil
        system.stop(); system.clear()
        do {
            try load()
            if var saved = capability, saved.enabledUserID != nil {
                saved.sequence += 1; saved.enabledUserID = nil; saved.bindingID = nil; saved.token = nil
                saved.pendingRevoke = saved.sequence
                try persist(saved)
            }
        } catch { notice = .text("本机通知已关闭，服务器解绑尚未保存，请联网后重试。") }
        userID = nil
        Task { await drainRevocation() }
    }
    func disable() async {
        let owner = userID
        detach(); userID = owner
        await drainRevocation()
    }
    private func drainRevocation() async {
        guard !revoking, let saved = capability, let sequence = saved.pendingRevoke else { return }
        revoking = true
        defer { revoking = false }
        do {
            _ = try await revokeAPI.send("api/push/revoke", method: "POST", body: JSONEncoder().encode(PushRevoke(installationKey: saved.installationKey, sequence: sequence)))
            if var latest = capability, latest.pendingRevoke == sequence { latest.pendingRevoke = nil; try persist(latest) }
            if !enabled { notice = .text("此 iPhone 的系统通知已关闭。") }
        } catch { if !enabled { notice = .text("本机通知已关闭，服务器将在联网后解绑。") } }
    }
    func cleanDelivered(reminderIDs: Set<String>) async {
        guard enabled, let binding = capability?.bindingID else { system.clear(); return }
        let current = generation
        await system.removeInvalid(bindingID: binding, reminderIDs: reminderIDs) { [weak self] in
            self?.generation == current && self?.capability?.bindingID == binding && self?.enabled == true
        }
    }
    func receive(_ info: PushNotice, open: Bool) async -> Bool {
        guard enabled, !demo, let owner = userID, let saved = capability, saved.enabledUserID == owner,
              info.bindingID == saved.bindingID else { return false }
        let current = generation
        do {
            struct Result: Decodable { let jobId: String }
            let body = PushResolution(installationKey: saved.installationKey, sequence: saved.sequence, deliveryId: info.deliveryID)
            let response = try await api.send("api/push/resolve", method: "POST", body: JSONEncoder().encode(body))
            let result = try JSONDecoder().decode(Result.self, from: response)
            guard current == generation, userID == owner, enabled else { return false }
            if open { destination = PushDestination(jobID: result.jobId) }
            return true
        } catch {
            if current == generation {
                if open { notice = .text("此提醒已失效或暂时无法验证，请查看最新日程。") }
                if error as? APIError == .unauthorized { onUnauthorized?() }
            }
            return false
        }
    }
}

@MainActor
final class PushAppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    static weak var coordinator: PushCoordinator?
    private static var pendingTap: PushNotice?
    static func attach(_ value: PushCoordinator) {
        coordinator = value
        if let info = pendingTap { pendingTap = nil; Task { await value.queueTap(info) } }
    }
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        return true
    }
    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        Task { await Self.coordinator?.receivedToken(deviceToken) }
    }
    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) { Self.coordinator?.registrationFailed() }
    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
        guard let info = PushNotice(userInfo: notification.request.content.userInfo) else { return [] }
        return await Self.present(info)
    }
    private static func present(_ info: PushNotice) async -> UNNotificationPresentationOptions {
        await coordinator?.receive(info, open: false) == true ? [.banner, .sound] : []
    }
    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
        guard response.actionIdentifier == UNNotificationDefaultActionIdentifier,
              let info = PushNotice(userInfo: response.notification.request.content.userInfo) else { return }
        let identifier = response.notification.request.identifier
        await Self.open(info, identifier: identifier)
    }
    private static func open(_ info: PushNotice, identifier: String) async {
        if let coordinator { await coordinator.queueTap(info) }
        else { pendingTap = info }
        UNUserNotificationCenter.current().removeDeliveredNotifications(withIdentifiers: [identifier])
    }
}
