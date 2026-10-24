import AuthenticationServices
import CryptoKit
import Security
import UIKit

struct MailAuthorizationAttempt {
    let verifier: String
    var challenge: String { Self.base64url(Data(SHA256.hash(data: Data(verifier.utf8)))) }
    static func base64url(_ data: Data) -> String { data.base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "") }
    static func make() throws -> Self {
        var bytes = [UInt8](repeating: 0, count: 32)
        guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else { throw APIError.secureStorage }
        return Self(verifier: base64url(Data(bytes)))
    }
    static func validateCallback(_ url: URL, state: String) throws {
        let c = URLComponents(url: url, resolvingAgainstBaseURL: false)
        guard c?.scheme == "com.enfoirer.jobgenie", c?.host == "oauth", c?.path == "/mail", c?.user == nil, c?.password == nil,
              c?.port == nil, c?.fragment == nil, c?.queryItems?.count == 1,
              c?.queryItems?.first?.name == "state", c?.queryItems?.first?.value == state else { throw APIError.invalidResponse }
    }
}
struct MailAuthorizationStart: Decodable {
    let state: String; let url: URL
    func validate(provider: String, challenge: String) throws {
        let c = URLComponents(url: url, resolvingAgainstBaseURL: false)
        let expectedHost = provider == "google" ? "accounts.google.com" : "login.microsoftonline.com"
        guard state.range(of: "^native_[A-Za-z0-9_-]{43}$", options: .regularExpression) != nil,
              c?.scheme == "https", c?.host == expectedHost, c?.user == nil, c?.password == nil, c?.port == nil,
              c?.queryItems?.filter({ $0.name == "state" }).map(\.value) == [state],
              c?.queryItems?.filter({ $0.name == "code_challenge" }).map(\.value) == [challenge] else { throw APIError.invalidResponse }
    }
}
struct MailAuthorizationOutcome: Decodable { let outcome: String }
extension APIClient {
    func startMailAuthorization(provider: String, challenge: String) async throws -> MailAuthorizationStart {
        struct Body: Encodable { let challenge: String }
        let data = try await send("api/oauth/\(provider)/native/start", method: "POST", body: JSONEncoder().encode(Body(challenge: challenge)))
        return try JSONDecoder().decode(MailAuthorizationStart.self, from: data)
    }
    func finishMailAuthorization(provider: String, state: String, verifier: String, cancel: Bool = false) async throws -> MailAuthorizationOutcome {
        struct Body: Encodable { let state: String; let verifier: String }
        let data = try await send("api/oauth/\(provider)/native/\(cancel ? "cancel" : "finish")", method: "POST", body: JSONEncoder().encode(Body(state: state, verifier: verifier)))
        return try JSONDecoder().decode(MailAuthorizationOutcome.self, from: data)
    }
}

@MainActor
final class MailAuthorization: NSObject, ObservableObject, ASWebAuthenticationPresentationContextProviding {
    @Published private(set) var busy = false
    @Published var message: UserMessage?
    private var session: ASWebAuthenticationSession?
    private var continuation: CheckedContinuation<URL, Error>?
    private var task: Task<Void, Never>?
    private let browser: (@MainActor (URL) async throws -> URL)?
    init(browser: (@MainActor (URL) async throws -> URL)? = nil) { self.browser = browser; super.init() }
    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
            .flatMap(\.windows).first(where: \.isKeyWindow) ?? ASPresentationAnchor()
    }
    func connect(provider: String, model: AppModel) {
        guard !busy, !model.isDemo, model.user != nil else { return }
        busy = true; message = nil
        let generation = model.sessionGeneration
        task = Task {
            var start: MailAuthorizationStart?
            var proof: MailAuthorizationAttempt?
            var submitted = false
            defer { busy = false; session = nil; task = nil }
            do {
                let attempt = try MailAuthorizationAttempt.make(); proof = attempt
                let response = try await model.api.startMailAuthorization(provider: provider, challenge: attempt.challenge); start = response
                try response.validate(provider: provider, challenge: attempt.challenge)
                try Task.checkCancellation()
                guard generation == model.sessionGeneration else { throw CancellationError() }
                let url: URL
                if let browser { url = try await browser(response.url) } else { url = try await open(response.url) }
                try MailAuthorizationAttempt.validateCallback(url, state: response.state)
                try Task.checkCancellation()
                guard generation == model.sessionGeneration else { throw CancellationError() }
                submitted = true
                let result = try await model.api.finishMailAuthorization(provider: provider, state: response.state, verifier: attempt.verifier)
                guard generation == model.sessionGeneration else { throw CancellationError() }
                switch result.outcome {
                case "connected": message = .text("邮箱绑定成功。")
                case "cancelled": message = .text("已取消邮箱授权。")
                default: message = .text("邮箱授权未完成，请重试。")
                }
                await model.refreshMail(force: true)
            } catch {
                if generation == model.sessionGeneration {
                    if error as? APIError == .unauthorized { await model.signOut() }
                    else if submitted {
                        message = .text("未能确认绑定结果，请刷新邮箱列表后再尝试授权。")
                    } else if error is CancellationError || (error as? ASWebAuthenticationSessionError)?.code == .canceledLogin {
                        message = .text("已取消邮箱授权。")
                    } else {
                        message = model.message(error)
                    }
                    if !submitted, let start, let proof {
                        _ = try? await model.api.finishMailAuthorization(provider: provider, state: start.state, verifier: proof.verifier, cancel: true)
                    }
                }
            }
        }
    }
    private func open(_ url: URL) async throws -> URL {
        try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { continuation in
                self.continuation = continuation
                let session = ASWebAuthenticationSession(url: url, callbackURLScheme: "com.enfoirer.jobgenie") { [weak self] url, error in
                    Task { @MainActor in
                        if let url { self?.resolve(.success(url)) }
                        else { self?.resolve(.failure(error ?? APIError.invalidResponse)) }
                    }
                }
                self.session = session
                session.presentationContextProvider = self
                session.prefersEphemeralWebBrowserSession = true
                if !session.start() { resolve(.failure(APIError.configuration)) }
            }
        } onCancel: { Task { @MainActor [weak self] in self?.session?.cancel(); self?.resolve(.failure(CancellationError())) } }
    }
    private func resolve(_ result: Result<URL, Error>) { let pending = continuation; continuation = nil; pending?.resume(with: result) }
    func cancel() { task?.cancel(); session?.cancel(); resolve(.failure(CancellationError())) }
}
