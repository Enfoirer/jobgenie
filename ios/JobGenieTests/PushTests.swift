import XCTest
import UserNotifications
@testable import JobGenie

@MainActor
final class FakePushSystem: PushSystem {
    var status: UNAuthorizationStatus = .authorized
    var allowed = true
    var requests = 0
    var registrations = 0
    var stops = 0
    var clears = 0
    var cleanedIDs: Set<String>?
    func authorization() async -> UNAuthorizationStatus { status }
    func requestAuthorization() async throws -> Bool { requests += 1; return allowed }
    func register() { registrations += 1 }
    func stop() { stops += 1 }
    func clear() { clears += 1 }
    func removeInvalid(bindingID: String, reminderIDs: Set<String>, isCurrent: @MainActor () -> Bool) async { if isCurrent() { cleanedIDs = reminderIDs } }
}

@MainActor
final class PushTests: XCTestCase {
    private let binding = "00000000-0000-4000-8000-000000000001"
    private let headers = ["Content-Type": "application/json"]
    private func client(delayed: Bool = false) -> APIClient {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = delayed ? [DelayedHistoryProtocol.self] : [StubProtocol.self]
        return APIClient(baseURL: URL(string: "https://push.example.test")!, vault: MemoryVault(), configuration: config)
    }
    private func responses(available: Bool = true) {
        let binding = binding, headers = headers
        StubProtocol.handler = { request in
            let result: String
            switch request.url!.lastPathComponent {
            case "status": result = "{\"available\":\(available),\"environments\":[\"sandbox\",\"production\"]}"
            case "register": result = "{\"bindingId\":\"\(binding)\",\"enabled\":true}"
            case "resolve": result = "{\"jobId\":\"owned-job\"}"
            default: result = "{\"enabled\":false}"
            }
            return (200, headers, Data(result.utf8))
        }
    }
    private func coordinator(vault: MemoryVault = MemoryVault(), system: FakePushSystem = FakePushSystem(), delayed: Bool = false) -> PushCoordinator {
        PushCoordinator(api: client(delayed: delayed), system: system, vault: vault, revokeAPI: client())
    }
    private func notice(binding: String? = nil) -> PushNotice {
        PushNotice(userInfo: ["jg": ["deliveryId": String(repeating: "a", count: 64), "bindingId": binding ?? self.binding]])!
    }
    private func enabled(_ c: PushCoordinator) async {
        await c.context(userID: "owner", demo: false, locale: "en")
        await c.enable(); await c.receivedToken(Data(repeating: 1, count: 32))
    }
    func testAuthorizationIsOnlyRequestedAfterExplicitEnable() async throws {
        responses(); let vault = MemoryVault(), system = FakePushSystem(), c = coordinator(vault: vault, system: system)
        await c.context(userID: "owner", demo: false, locale: "en")
        XCTAssertEqual(system.requests, 0); XCTAssertNil(vault.data)
        await c.enable(); XCTAssertEqual(system.requests, 1); XCTAssertTrue(c.enabled)
        await c.receivedToken(Data(repeating: 1, count: 32))
        let state = try JSONDecoder().decode(PushCapability.self, from: XCTUnwrap(vault.data))
        XCTAssertEqual(state.bindingID, binding); XCTAssertEqual(state.enabledUserID, "owner")
        XCTAssertEqual(state.installationKey.count, 64)
    }
    func testDemoAndUnconfiguredServerCannotRequestPermissionOrRegister() async {
        responses(); let system = FakePushSystem(), c = coordinator(system: system)
        await c.context(userID: "demo", demo: true, locale: "en"); await c.enable()
        XCTAssertEqual(system.requests, 0); XCTAssertEqual(system.registrations, 0)
        responses(available: false)
        await c.context(userID: "owner", demo: false, locale: "en"); await c.enable()
        XCTAssertFalse(c.enabled); XCTAssertEqual(system.requests, 0)
    }
    func testDeniedPermissionDoesNotCreateADeviceBinding() async {
        responses(); let system = FakePushSystem(); system.allowed = false
        let vault = MemoryVault(), c = coordinator(vault: vault, system: system)
        await enabled(c); XCTAssertFalse(c.enabled); XCTAssertNil(vault.data); XCTAssertEqual(system.registrations, 0)
    }
    func testTokenAndLanguageChangesAdvanceSequenceButDuplicateCallbackDoesNot() async throws {
        responses(); let vault = MemoryVault(), c = coordinator(vault: vault)
        await enabled(c)
        let first = try JSONDecoder().decode(PushCapability.self, from: XCTUnwrap(vault.data))
        await c.receivedToken(Data(repeating: 1, count: 32))
        XCTAssertEqual(try JSONDecoder().decode(PushCapability.self, from: XCTUnwrap(vault.data)).sequence, first.sequence)
        await c.context(userID: "owner", demo: false, locale: "zh_CN")
        await c.receivedToken(Data(repeating: 2, count: 32))
        let changed = try JSONDecoder().decode(PushCapability.self, from: XCTUnwrap(vault.data))
        XCTAssertGreaterThan(changed.sequence, first.sequence); XCTAssertEqual(changed.locale, "zh-Hans")
    }
    func testRelaunchRestoresOptInForSameAccountWithoutNewPermissionPrompt() async {
        responses(); let vault = MemoryVault(), first = coordinator(vault: vault)
        await enabled(first)
        let system = FakePushSystem(), second = coordinator(vault: vault, system: system)
        await second.context(userID: "owner", demo: false, locale: "en")
        XCTAssertTrue(second.enabled); XCTAssertEqual(system.requests, 0); XCTAssertEqual(system.registrations, 1)
    }
    func testOfflineLogoutClearsImmediatelyAndRetriesRevocationAfterRelaunch() async throws {
        responses(); let vault = MemoryVault(), system = FakePushSystem(), c = coordinator(vault: vault, system: system)
        await enabled(c)
        StubProtocol.handler = { _ in throw URLError(.notConnectedToInternet) }
        await c.disable()
        XCTAssertFalse(c.enabled); XCTAssertGreaterThan(system.stops, 0); XCTAssertGreaterThan(system.clears, 0)
        let saved = try JSONDecoder().decode(PushCapability.self, from: XCTUnwrap(vault.data))
        XCTAssertNil(saved.enabledUserID); XCTAssertNotNil(saved.pendingRevoke); XCTAssertNil(saved.token)
        responses(); let second = coordinator(vault: vault)
        await second.context(userID: nil, demo: false, locale: "en")
        XCTAssertNil(try JSONDecoder().decode(PushCapability.self, from: XCTUnwrap(vault.data)).pendingRevoke)
    }
    func testAccountSwitchDoesNotReuseOptInOrOpenOldNotification() async {
        responses(); let c = coordinator(); await enabled(c)
        await c.context(userID: "other", demo: false, locale: "en")
        XCTAssertFalse(c.enabled); let valid = await c.receive(notice(), open: true)
        XCTAssertFalse(valid); XCTAssertNil(c.destination)
    }
    func testResolveRequiresMatchingBindingAndServerValidation() async {
        responses(); let c = coordinator(); await enabled(c)
        let foreign = await c.receive(notice(binding: "00000000-0000-4000-8000-000000000002"), open: true)
        XCTAssertFalse(foreign); XCTAssertNil(c.destination)
        let valid = await c.receive(notice(), open: true)
        XCTAssertTrue(valid); XCTAssertEqual(c.destination?.jobID, "owned-job")
        c.destination = nil
        StubProtocol.handler = { _ in (409, ["Content-Type": "application/json"], Data("{}".utf8)) }
        let stale = await c.receive(notice(), open: true)
        XCTAssertFalse(stale); XCTAssertNil(c.destination)
    }
    func testColdLaunchTapWaitsForRestoredAccount() async {
        responses(); let vault = MemoryVault(), first = coordinator(vault: vault); await enabled(first)
        let c = coordinator(vault: vault)
        await c.queueTap(notice()); XCTAssertNil(c.destination)
        await c.context(userID: "owner", demo: false, locale: "en")
        XCTAssertEqual(c.destination?.jobID, "owned-job")
    }
    func testLateRegistrationCannotRestoreLoggedOutBinding() async throws {
        let vault = MemoryVault(), system = FakePushSystem()
        let binding = binding
        DelayedHistoryProtocol.handler = { request in
            if request.url!.lastPathComponent == "register" { return (Data("{\"bindingId\":\"\(binding)\",\"enabled\":true}".utf8), 0.2) }
            return (Data("{\"available\":true,\"environments\":[\"sandbox\"]}".utf8), 0)
        }
        responses(); let c = coordinator(vault: vault, system: system, delayed: true)
        await c.context(userID: "owner", demo: false, locale: "en"); await c.enable()
        let pending = Task { await c.receivedToken(Data(repeating: 1, count: 32)) }
        try await Task.sleep(for: .milliseconds(40)); c.detach(); await pending.value
        XCTAssertFalse(c.enabled); XCTAssertNil(c.destination)
        XCTAssertNil(try JSONDecoder().decode(PushCapability.self, from: XCTUnwrap(vault.data)).bindingID)
    }
    func testExpiredSystemPermissionDisablesPreviouslyEnabledDevice() async {
        responses(); let system = FakePushSystem(), c = coordinator(system: system); await enabled(c)
        system.status = .denied; await c.foreground()
        XCTAssertFalse(c.enabled); XCTAssertGreaterThan(system.stops, 0)
    }
    func testCleaningUsesOnlyLiveUnreadRemindersAndLogoutClearsAll() async {
        responses(); let system = FakePushSystem(), c = coordinator(system: system); await enabled(c)
        await c.cleanDelivered(reminderIDs: ["entry:appointment:2"])
        XCTAssertEqual(system.cleanedIDs, ["entry:appointment:2"])
        c.detach(); await c.cleanDelivered(reminderIDs: [])
        XCTAssertGreaterThan(system.clears, 0)
    }
    func testKeychainFailureNeverReportsEnabled() async {
        responses(); let vault = MemoryVault(); vault.failWrites = true
        let c = coordinator(vault: vault); await enabled(c)
        XCTAssertFalse(c.enabled); XCTAssertNotNil(c.notice)
    }
    func testRejectsMalformedPushMetadata() {
        XCTAssertNil(PushNotice(userInfo: ["jg": ["deliveryId": "invalid", "bindingId": binding]]))
        XCTAssertNil(PushNotice(userInfo: ["jg": ["deliveryId": String(repeating: "a", count: 64), "bindingId": "invalid"]]))
    }
    func testUnauthorizedPushRequestsNotifySessionOwner() async {
        responses(); let c = coordinator(); await enabled(c)
        var expired = false; c.onUnauthorized = { expired = true }
        StubProtocol.handler = { _ in (401, ["Content-Type": "application/json"], Data("{}".utf8)) }
        let valid = await c.receive(notice(), open: true)
        XCTAssertFalse(valid); XCTAssertTrue(expired); XCTAssertNil(c.destination)
    }
}
