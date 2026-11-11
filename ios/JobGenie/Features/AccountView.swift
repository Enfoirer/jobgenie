import SwiftUI

struct AccountView: View {
    @EnvironmentObject private var model: AppModel
    @EnvironmentObject private var feedback: FeedbackCoordinator
    @Environment(\.locale) private var locale
    @State private var confirmingSignOut = false
    private var accountName: Text {
        if let name = model.user?.name { return Text(verbatim: name) }
        return Text("JobGenie 用户")
    }
    var body: some View {
        List {
                DemoNotice()
            Section {
                HStack(spacing: 14) {
                    Image(systemName: "person.crop.circle.fill").font(.system(size: 46)).foregroundStyle(Brand.teal)
                    VStack(alignment: .leading, spacing: 5) { accountName.font(.headline); Text(model.user?.email ?? "").font(.subheadline).foregroundStyle(.secondary) }
                }.padding(.vertical, 10)
            }
            Section("数据与文件") {
                NavigationLink { AnalyticsView() } label: { Label("统计分析", systemImage: "chart.bar") }.accessibilityIdentifier("analytics.open")
                NavigationLink { AttachmentsView() } label: { Label("附件", systemImage: "paperclip") }.accessibilityIdentifier("attachments.open")
            }
            Section("偏好设置") {
                LanguagePicker()
                NavigationLink { RemindersView() } label: { Label("提醒", systemImage: "bell") }
                    .accessibilityIdentifier("reminders.open")
            }
            Section("帮助我们改进") {
                Button { feedback.start(userID: model.user?.id, demo: model.isDemo); Task { await feedback.openManual(locale: locale.identifier) } } label: {
                    Label("评价 JobGenie", systemImage: "star.bubble")
                }.accessibilityIdentifier("feedback.open")
                if let notice = feedback.notice { Text(notice.localized(locale: locale)).font(.footnote).accessibilityIdentifier("feedback.notice") }
            }
            Section("当前版本") {
                LabeledContent("JobGenie for iPhone", value: "0.1.0")
                Text("支持申请与历史管理、日程编辑、邮箱操作、统计分析和附件。系统通知可在提醒设置中开启，需服务器和签名配置就绪。") .font(.subheadline).foregroundStyle(.secondary)
                if model.isDemo { Text("演示数据只在本次体验中保留，不会写入真实账号。") .font(.footnote).foregroundStyle(Brand.teal) }
            }
            if !model.isDemo {
                Section("更多功能") {
                    Link(destination: model.api.baseURL.appendingPathComponent("dashboard")) { Label("打开网页版", systemImage: "safari") }
                    Text("网页版与 App 共用账号数据，浏览器需单独登录。系统通知按设备管理，退出账号会关闭此设备通知。") .font(.footnote).foregroundStyle(.secondary)
                }
            }
            Section { Button(LocalizedStringKey(model.isDemo ? "退出演示" : "退出登录"), role: .destructive) { confirmingSignOut = true }.accessibilityIdentifier("account.signout") }
        }.localizedNavigationTitle("我的")
        .confirmationDialog(LocalizedStringKey(model.isDemo ? "退出后将清除演示改动" : "退出此设备的登录？"), isPresented: $confirmingSignOut, titleVisibility: .visible) {
            Button("确认退出", role: .destructive) { Task { await model.signOut() } }
        }
        .feedbackSurface(blocked: confirmingSignOut)
        .onChange(of: locale.identifier) { _, _ in feedback.interacted() }
    }
}
