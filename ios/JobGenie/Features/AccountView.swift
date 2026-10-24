import SwiftUI

struct AccountView: View {
    @EnvironmentObject private var model: AppModel
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
            Section("偏好设置") {
                LanguagePicker()
                NavigationLink { RemindersView() } label: { Label("提醒", systemImage: "bell") }
                    .accessibilityIdentifier("reminders.open")
            }
            Section("当前版本") {
                LabeledContent("JobGenie for iPhone", value: "0.1.0")
                Text("支持申请与历史管理、日程编辑、App 内提醒、邮箱同步、人工确认和邮箱授权。统计和后台推送将逐步加入。") .font(.subheadline).foregroundStyle(.secondary)
                if model.isDemo { Text("演示数据只在本次体验中保留，不会写入真实账号。") .font(.footnote).foregroundStyle(Brand.teal) }
            }
            if !model.isDemo {
                Section("更多功能") {
                    Link(destination: model.api.baseURL.appendingPathComponent("dashboard")) { Label("打开网页版", systemImage: "safari") }
                    Text("网页版与 App 共用账号数据，浏览器需单独登录。当前 App 不发送后台推送。") .font(.footnote).foregroundStyle(.secondary)
                }
            }
            Section { Button(LocalizedStringKey(model.isDemo ? "退出演示" : "退出登录"), role: .destructive) { confirmingSignOut = true }.accessibilityIdentifier("account.signout") }
        }.localizedNavigationTitle("我的")
        .confirmationDialog(LocalizedStringKey(model.isDemo ? "退出后将清除演示改动" : "退出此设备的登录？"), isPresented: $confirmingSignOut, titleVisibility: .visible) {
            Button("确认退出", role: .destructive) { Task { await model.signOut() } }
        }
    }
}
