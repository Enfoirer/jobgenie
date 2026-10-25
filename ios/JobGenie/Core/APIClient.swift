import Foundation

enum APIError: LocalizedError, Equatable {
    case unauthorized, credentials, rateLimited(Int), server, invalidResponse, secureStorage, configuration, invalidInput, notFound, conflict, fileTooLarge, unsupportedFile
    var errorDescription: String? { userMessage.localized(locale: .current) }
    var userMessage: UserMessage {
        switch self {
        case .unauthorized: .text("登录已过期，请重新登录。")
        case .credentials: .text("邮箱或密码不正确。")
        case .rateLimited(let seconds): .rateLimited(minutes: max(1, Int(ceil(Double(seconds) / 60))))
        case .server: .text("服务暂时不可用，请稍后重试。")
        case .invalidResponse: .text("未能读取服务器数据，请稍后重试。")
        case .secureStorage: .text("无法访问安全存储，请解锁设备后重试。")
        case .configuration: .text("服务地址配置无效。")
        case .invalidInput: .text("提交内容无效，请检查后重试。")
        case .notFound: .text("记录已不存在或无权访问，请刷新后重试。")
        case .fileTooLarge: .text("文件不能超过 4 MB。")
        case .unsupportedFile: .text("请选择有效的 PDF、DOCX、PNG 或 JPG/JPEG 文件。")
        case .conflict: .text("记录已发生变化，请刷新后重试。")
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
    func saveHistory(_ draft: HistoryDraft, jobID: String, entryID: String?) async throws -> HistoryMutationResponse {
        guard draft.validationMessage == nil else { throw APIError.invalidInput }
        let path = "api/jobs/\(jobID)/status-history" + (entryID.map { "/\($0)" } ?? "")
        let data = try await send(path, method: entryID == nil ? "POST" : "PATCH", body: JSONEncoder().encode(draft.normalized))
        let result = try decode(HistoryMutationResponse.self, data)
        guard result.job.id == jobID, let entry = result.statusHistory,
              entryID == nil || entry.id == entryID else { throw APIError.invalidResponse }
        return result
    }
    func saveSchedule(_ draft: ScheduleDraft, jobID: String, entryID: String) async throws -> HistoryMutationResponse {
        guard draft.isValid else { throw APIError.invalidInput }
        let data = try await send("api/jobs/\(jobID)/status-history/\(entryID)", method: "PATCH", body: JSONEncoder().encode(draft))
        let result = try decode(HistoryMutationResponse.self, data)
        guard result.job.id == jobID, result.statusHistory?.id == entryID else { throw APIError.invalidResponse }
        return result
    }
    func deleteHistory(jobID: String, entryID: String) async throws -> HistoryMutationResponse {
        let data = try await send("api/jobs/\(jobID)/status-history/\(entryID)", method: "DELETE")
        let result = try decode(HistoryMutationResponse.self, data)
        guard result.job.id == jobID else { throw APIError.invalidResponse }
        return result
    }
    private func decode<T: Decodable>(_ type: T.Type, _ data: Data) throws -> T {
        do { return try JSONDecoder.jobGenie.decode(type, from: data) } catch { throw APIError.invalidResponse }
    }
    func send(_ path: String, method: String = "GET", body: Data? = nil, contentType: String = "application/json", query: [URLQueryItem] = [], binary: Bool = false) async throws -> Data {
        guard !path.contains(".."), !path.contains("://"), !path.hasPrefix("/"),
              baseURL.scheme == "https" || ["127.0.0.1", "localhost"].contains(baseURL.host ?? "") else { throw APIError.configuration }
        var components = URLComponents(url: baseURL.appendingPathComponent(path), resolvingAgainstBaseURL: false)!
        if !query.isEmpty { components.queryItems = query }
        guard let url = components.url else { throw APIError.configuration }
        var request = URLRequest(url: url)
        request.httpMethod = method; request.httpBody = body
        request.setValue(binary ? "application/octet-stream" : "application/json", forHTTPHeaderField: "Accept")
        request.setValue(baseURL.absoluteString, forHTTPHeaderField: "Origin")
        if body != nil { request.setValue(contentType, forHTTPHeaderField: "Content-Type") }
        let current = generation
        let (data, response) = try await session.data(for: request)
        guard current == generation else { throw CancellationError() }
        guard let http = response as? HTTPURLResponse else { throw APIError.invalidResponse }
        switch http.statusCode {
        case 200..<300: break
        case 401: throw path == "api/auth/callback/credentials" ? APIError.credentials : APIError.unauthorized
        case 400, 422: throw APIError.invalidInput
        case 403, 404: throw APIError.notFound
        case 409: throw APIError.conflict
        case 413: throw APIError.fileTooLarge
        case 415: throw APIError.unsupportedFile
        case 429: throw APIError.rateLimited(Int(http.value(forHTTPHeaderField: "Retry-After") ?? "60") ?? 60)
        default: throw APIError.server
        }
        let receivedType = http.value(forHTTPHeaderField: "Content-Type")?.lowercased().split(separator: ";").first.map(String.init)
        guard receivedType == (binary ? "application/octet-stream" : "application/json") else { throw APIError.invalidResponse }
        if binary && data.count > AttachmentPolicy.maxBytes { throw APIError.fileTooLarge }
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
