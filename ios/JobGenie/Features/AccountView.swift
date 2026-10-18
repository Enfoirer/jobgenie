import SwiftUI

struct MailView: View {
    @EnvironmentObject private var model: AppModel
    var body: some View {
        List {
                DemoNotice()
            Section {
                Label("机会，来自每一封来信", systemImage: "envelope.badge").font(.headline).padding(.vertical, 8)
                Text("查看已连接的邮箱。当前版本的绑定、同步和待确认邮件在网页版管理。") .font(.subheadline).foregroundStyle(.secondary)
            }
            if let error = model.mailError { Section { ErrorBanner(message: error) { Task { await model.refreshMail() } } } }
            Section("已连接的邮箱") {
                if model.mailLoading && model.mailboxes.isEmpty { ProgressView("正在加载邮箱…") }
                else if model.mailboxes.isEmpty { ContentUnavailableView("尚未连接邮箱", systemImage: "envelope", description: Text("先在网页版连接 Gmail 或 Outlook，随后下拉刷新。")) }
                ForEach(model.mailboxes) { mailbox in
                    HStack(spacing: 12) {
                        Image(systemName: "envelope.circle.fill").font(.largeTitle).foregroundStyle(Brand.teal)
                        VStack(alignment: .leading, spacing: 5) { Text(mailbox.provider == "gmail" ? "Gmail" : "Outlook").font(.headline); Text(mailbox.emailAddress).font(.subheadline).foregroundStyle(.secondary) }
                    }.padding(.vertical, 5)
                }
            }
            if !model.isDemo {
                Section {
                    Link(destination: model.api.baseURL.appendingPathComponent("dashboard/mail")) { Label("在网页版管理邮箱", systemImage: "safari") }
                    Text("浏览器与 App 独立登录；打开网页后可能需要重新登录。") .font(.footnote).foregroundStyle(.secondary)
                }
            }
        }.navigationTitle("邮箱").refreshable { await model.refreshMail() }.task { await model.refreshMail() }
    }
}
struct AccountView: View {
    @EnvironmentObject private var model: AppModel
    @State private var confirmingSignOut = false
    var body: some View {
        List {
                DemoNotice()
            Section {
                HStack(spacing: 14) {
                    Image(systemName: "person.crop.circle.fill").font(.system(size: 46)).foregroundStyle(Brand.teal)
                    VStack(alignment: .leading, spacing: 5) { Text(model.user?.name ?? "JobGenie 用户").font(.headline); Text(model.user?.email ?? "").font(.subheadline).foregroundStyle(.secondary) }
                }.padding(.vertical, 10)
            }
            Section("当前版本") {
                LabeledContent("JobGenie for iPhone", value: "0.1.0")
                Text("支持申请查看、新建与信息编辑，以及日程和邮箱概览。状态管理、邮箱授权、统计和推送将逐步加入。") .font(.subheadline).foregroundStyle(.secondary)
                if model.isDemo { Text("演示数据只在本次体验中保留，不会写入真实账号。") .font(.footnote).foregroundStyle(Brand.teal) }
            }
            if !model.isDemo {
                Section("更多功能") {
                    Link(destination: model.api.baseURL.appendingPathComponent("dashboard")) { Label("打开网页版", systemImage: "safari") }
                    Text("网页版与 App 共用账号数据，浏览器需单独登录。当前 App 不发送后台推送。") .font(.footnote).foregroundStyle(.secondary)
                }
            }
            Section { Button(model.isDemo ? "退出演示" : "退出登录", role: .destructive) { confirmingSignOut = true }.accessibilityIdentifier("account.signout") }
        }.navigationTitle("我的")
        .confirmationDialog(model.isDemo ? "退出后将清除演示改动" : "退出此设备的登录？", isPresented: $confirmingSignOut, titleVisibility: .visible) {
            Button("确认退出", role: .destructive) { Task { await model.signOut() } }
        }
    }
}
