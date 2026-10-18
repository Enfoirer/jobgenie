import Foundation

enum APIError: LocalizedError, Equatable {
    case unauthorized, credentials, rateLimited(Int), server, invalidResponse, secureStorage, configuration
    var errorDescription: String? {
        switch self {
        case .unauthorized: "登录已过期，请重新登录。"
        case .credentials: "邮箱或密码不正确。"
        case .rateLimited(let seconds): "操作过于频繁，请在 \(max(1, Int(ceil(Double(seconds) / 60)))) 分钟后重试。"
        case .server: "服务暂时不可用，请稍后重试。"
        case .invalidResponse: "未能读取服务器数据，请稍后重试。"
        case .secureStorage: "无法访问安全存储，请解锁设备后重试。"
        case .configuration: "服务地址配置无效。"
        }
    }
}
final class NoRedirects: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }
}
@MainActor
final class APIClient {
    let baseURL: URL
    private var session: URLSession
    private var cookies: HTTPCookieStorage
    private let protocolClasses: [AnyClass]?
    private var generation = UUID()
    private let vault: any SessionVault
    private var persistSession = false
    init(baseURL: URL, vault: (any SessionVault)? = nil, configuration: URLSessionConfiguration = .ephemeral) {
        self.baseURL = baseURL
        self.vault = vault ?? KeychainSessionVault(account: baseURL.absoluteString)
        configuration.urlCache = nil
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.timeoutIntervalForRequest = 25
        configuration.timeoutIntervalForResource = 45
        protocolClasses = configuration.protocolClasses
        cookies = configuration.httpCookieStorage!
        session = URLSession(configuration: configuration, delegate: NoRedirects(), delegateQueue: nil)
    }
    static func configuredURL() -> URL {
        #if DEBUG
        if let raw = ProcessInfo.processInfo.environment["JOBGENIE_TEST_BASE_URL"], let url = URL(string: raw),
           ["127.0.0.1", "localhost"].contains(url.host ?? ""), url.scheme == "http" { return url }
        #endif
        return URL(string: "https://jobgenie-six.vercel.app")!
    }
    func restore() async throws -> SessionUser? {
        guard let data = try vault.read() else { return nil }
        let saved = try JSONDecoder().decode([SavedCookie].self, from: data)
        let valid = saved.compactMap { $0.cookie(for: baseURL) }
        guard !valid.isEmpty else { try clearLocalSession(); return nil }
        valid.forEach(cookies.setCookie)
        persistSession = true
        do { return try await currentUser() }
        catch APIError.unauthorized { try clearLocalSession(); return nil }
    }
    func signIn(email: String, password: String, remember: Bool) async throws -> SessionUser {
        try clearLocalSession()
        struct CSRF: Decodable { let csrfToken: String }
        struct Redirect: Decodable { let url: String }
        let csrf: CSRF = try await get("api/auth/csrf")
        let data = try await send("api/auth/callback/credentials", method: "POST", body: Self.form([
            "csrfToken": csrf.csrfToken, "email": email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased(),
            "password": password, "rememberMe": String(remember), "json": "true", "callbackUrl": baseURL.absoluteString + "/dashboard",
        ]), contentType: "application/x-www-form-urlencoded")
        let redirect = try decode(Redirect.self, data)
        let error = URLComponents(string: redirect.url)?.queryItems?.first { $0.name == "error" }?.value
        if error != nil { try clearLocalSession(); throw APIError.credentials }
        do {
            let user = try await currentUser()
            persistSession = remember
            try saveSession()
            return user
        } catch { try? clearLocalSession(); throw error }
    }
    func currentUser() async throws -> SessionUser {
        let response: SessionResponse = try await get("api/auth/session")
        guard let user = response.user, let expiry = response.expires, expiry > .now else { throw APIError.unauthorized }
        return user
    }
    func signOut() async throws {
        // Local removal always happens, including when the network is offline.
        try clearLocalSession()
    }
    func clearLocalSession() throws {
        persistSession = false
        generation = UUID()
        session.invalidateAndCancel()
        cookies.cookies?.forEach(cookies.deleteCookie)
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = protocolClasses
        configuration.urlCache = nil
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.timeoutIntervalForRequest = 25
        configuration.timeoutIntervalForResource = 45
        cookies = configuration.httpCookieStorage!
        session = URLSession(configuration: configuration, delegate: NoRedirects(), delegateQueue: nil)
        try vault.clear()
    }
    private func saveSession() throws {
        guard persistSession else { return }
        let saved = (cookies.cookies(for: baseURL) ?? []).filter { SavedCookie.isSessionName($0.name) }.compactMap(SavedCookie.init)
        guard !saved.isEmpty else { try clearLocalSession(); throw APIError.unauthorized }
        try vault.write(JSONEncoder().encode(saved))
    }
    func get<T: Decodable>(_ path: String) async throws -> T { try decode(T.self, await send(path)) }
    func save(_ draft: JobDraft, id: String?) async throws -> Job {
        let data = try JSONEncoder().encode(draft.normalized)
        let response = try await send(id.map { "api/jobs/\($0)" } ?? "api/jobs", method: id == nil ? "POST" : "PATCH", body: data)
        return try decode(JobResponse.self, response).job
    }
    private func decode<T: Decodable>(_ type: T.Type, _ data: Data) throws -> T {
        do { return try JSONDecoder.jobGenie.decode(type, from: data) } catch { throw APIError.invalidResponse }
    }
    func send(_ path: String, method: String = "GET", body: Data? = nil, contentType: String = "application/json") async throws -> Data {
        guard !path.contains(".."), !path.contains("://"), !path.hasPrefix("/"),
              baseURL.scheme == "https" || ["127.0.0.1", "localhost"].contains(baseURL.host ?? "") else { throw APIError.configuration }
        var request = URLRequest(url: baseURL.appendingPathComponent(path))
        request.httpMethod = method; request.httpBody = body
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue(baseURL.absoluteString, forHTTPHeaderField: "Origin")
        if body != nil { request.setValue(contentType, forHTTPHeaderField: "Content-Type") }
        let current = generation
        let (data, response) = try await session.data(for: request)
        guard current == generation else { throw CancellationError() }
        guard let http = response as? HTTPURLResponse else { throw APIError.invalidResponse }
        switch http.statusCode {
        case 200..<300: break
        case 401: throw path == "api/auth/callback/credentials" ? APIError.credentials : APIError.unauthorized
        case 429: throw APIError.rateLimited(Int(http.value(forHTTPHeaderField: "Retry-After") ?? "60") ?? 60)
        default: throw APIError.server
        }
        guard http.value(forHTTPHeaderField: "Content-Type")?.lowercased().contains("application/json") == true else { throw APIError.invalidResponse }
        // A session GET may rotate the encrypted cookie without extending its lifetime.
        try saveSession()
        return data
    }
    static func form(_ values: [String: String]) -> Data {
        let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-._~"))
        return values.sorted { $0.key < $1.key }.map { key, value in
            "\(key.addingPercentEncoding(withAllowedCharacters: allowed)!)=\(value.addingPercentEncoding(withAllowedCharacters: allowed)!)"
        }.joined(separator: "&").data(using: .utf8)!
    }
}
