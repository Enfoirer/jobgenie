import Foundation
import Security

protocol SessionVault {
    func read() throws -> Data?
    func write(_ data: Data) throws
    func clear() throws
}
struct KeychainSessionVault: SessionVault {
    let account: String
    private var query: [String: Any] { [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "jobgenie.ios.session", kSecAttrAccount as String: account] }
    func read() throws -> Data? {
        var q = query
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(q as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess else { throw APIError.secureStorage }
        return result as? Data
    }
    func write(_ data: Data) throws {
        let attributes: [String: Any] = [kSecValueData as String: data, kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly]
        let status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if status == errSecItemNotFound {
            guard SecItemAdd(query.merging(attributes) { _, new in new } as CFDictionary, nil) == errSecSuccess else { throw APIError.secureStorage }
        } else if status != errSecSuccess { throw APIError.secureStorage }
    }
    func clear() throws {
        let status = SecItemDelete(query as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else { throw APIError.secureStorage }
    }
}
struct SavedCookie: Codable {
    let name: String
    let value: String
    let domain: String
    let path: String
    let secure: Bool
    let expires: Date
    init?(_ cookie: HTTPCookie) {
        guard let expires = cookie.expiresDate else { return nil }
        name = cookie.name; value = cookie.value; domain = cookie.domain; path = cookie.path; secure = cookie.isSecure; self.expires = expires
    }
    func cookie(for origin: URL, now: Date = .now) -> HTTPCookie? {
        guard Self.isSessionName(name), domain == origin.host, path == "/", expires > now,
              origin.scheme != "https" || secure else { return nil }
        var properties: [HTTPCookiePropertyKey: Any] = [.name: name, .value: value, .domain: domain, .path: path, .expires: expires]
        // Foundation treats the presence of Secure as enabled, even for "FALSE".
        if secure { properties[.secure] = "TRUE" }
        return HTTPCookie(properties: properties)
    }
    static func isSessionName(_ name: String) -> Bool {
        name.range(of: "^(__Secure-)?next-auth\\.session-token(\\.[0-9]+)?$", options: .regularExpression) != nil
    }
}
