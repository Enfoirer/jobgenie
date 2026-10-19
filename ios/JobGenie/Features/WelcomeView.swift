import SwiftUI

struct WelcomeView: View {
    @EnvironmentObject private var model: AppModel
    @State private var email = ""
    @State private var password = ""
    @State private var remember = true
    @FocusState private var focus: Field?
    private enum Field { case email, password }
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 26) {
                    VStack(alignment: .leading, spacing: 16) {
                        Image(systemName: "sparkles.rectangle.stack.fill").font(.system(size: 38)).foregroundStyle(Brand.teal)
                        Text("JobGenie").font(.system(.largeTitle, design: .rounded, weight: .bold))
                        Text("下一份机会，\n从容掌握。").font(.largeTitle.weight(.bold))
                        Text("申请进展、面试和待办，随时在手边。") .foregroundStyle(.secondary)
                    }.padding(.top, 20)
                    VStack(spacing: 16) {
                        TextField("邮箱", text: $email).textContentType(.username).keyboardType(.emailAddress)
                            .textInputAutocapitalization(.never).autocorrectionDisabled().focused($focus, equals: .email)
                            .submitLabel(.next).onSubmit { focus = .password }.accessibilityIdentifier("login.email")
                        Divider()
                        SecureField("密码", text: $password).textContentType(.password).focused($focus, equals: .password)
                            .submitLabel(.go).onSubmit { login() }.accessibilityIdentifier("login.password")
                        Toggle("记住我 · 最长 30 天", isOn: $remember).font(.subheadline)
                    }.padding(20).background(.background, in: RoundedRectangle(cornerRadius: 20))
                    if let message = model.authMessage { ErrorBanner(message: message) }
                    Button(action: login) {
                        HStack { if model.isSigningIn { ProgressView().tint(.white) }; Text(LocalizedStringKey(model.isSigningIn ? "正在登录…" : "登录")).fontWeight(.semibold) }.frame(maxWidth: .infinity).padding(.vertical, 8)
                    }.buttonStyle(.borderedProminent).controlSize(.large)
                        .disabled(email.trimmingCharacters(in: .whitespaces).isEmpty || password.isEmpty || model.isSigningIn)
                        .accessibilityIdentifier("login.submit")
                    HStack {
                        Link("创建账号", destination: model.api.baseURL.appendingPathComponent("login"))
                        Spacer()
                        Link("忘记密码？", destination: model.api.baseURL.appendingPathComponent("forgot-password"))
                    }.font(.subheadline)
                    Button { focus = nil; password = ""; model.useDemo() } label: {
                        Label("先体验演示版", systemImage: "play.circle").frame(maxWidth: .infinity)
                    }.buttonStyle(.bordered).controlSize(.large).disabled(model.isSigningIn).accessibilityIdentifier("login.demo")
                    Text("使用与网页版相同的账号。创建账号和找回密码会打开网页版；不勾选“记住我”时，会话仅在本次 App 运行期间保留，最长 12 小时。")
                        .font(.footnote).foregroundStyle(.secondary)
                }.padding(24).frame(maxWidth: 500)
            }.background(Brand.background).scrollDismissesKeyboard(.interactively)
            .toolbar { ToolbarItem(placement: .topBarTrailing) { LanguagePicker() } }
        }
    }
    private func login() {
        guard !email.isEmpty, !password.isEmpty, !model.isSigningIn else { return }
        focus = nil
        let secret = password
        password = ""
        Task { await model.signIn(email: email, password: secret, remember: remember) }
    }
}
