import SwiftUI

@main
struct JobGenieApp: App {
    @StateObject private var model = AppModel()
    @Environment(\.scenePhase) private var scenePhase
    var body: some Scene {
        WindowGroup {
            Group {
                if model.isRestoring { ProgressView("正在恢复会话…") }
                else if model.user == nil { WelcomeView() }
                else { MainTabs().id(model.user?.id) }
            }
            .environmentObject(model)
            .tint(Brand.teal)
            .task { await model.restore() }
            .onChange(of: scenePhase) { _, phase in
                if phase == .active { Task { await model.revalidate() } }
            }
        }
    }
}
struct MainTabs: View {
    @EnvironmentObject private var model: AppModel
    var body: some View {
        TabView {
            NavigationStack { ApplicationsView() }.tabItem { Label("申请", systemImage: "square.stack.3d.up") }
            NavigationStack { ScheduleView() }.tabItem { Label("日程", systemImage: "calendar") }
            NavigationStack { MailView() }.tabItem { Label("邮箱", systemImage: "envelope") }
            NavigationStack { AccountView() }.tabItem { Label("我的", systemImage: "person.crop.circle") }
        }
    }
}
