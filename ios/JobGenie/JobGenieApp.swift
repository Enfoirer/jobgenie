import SwiftUI

@main
struct JobGenieApp: App {
    @StateObject private var model = AppModel()
    @StateObject private var language = LanguageSettings()
    @Environment(\.scenePhase) private var scenePhase
    var body: some Scene {
        WindowGroup {
            Group {
                if model.isRestoring { ProgressView("正在恢复会话…") }
                else if model.user == nil { WelcomeView() }
                else { MainTabs().id(model.user?.id) }
            }
            .environmentObject(model)
            .environmentObject(language)
            .environment(\.locale, language.locale)
            .tint(Brand.teal)
            .task { await model.restore() }
            .onChange(of: scenePhase) { _, phase in
                if phase == .active { language.refreshSystemLanguages(); Task { await model.revalidate() } }
            }
        }
    }
}
struct MainTabs: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.scenePhase) private var scenePhase
    var body: some View {
        TabView {
            NavigationStack { ApplicationsView() }.tabItem { Label("申请", systemImage: "square.stack.3d.up") }
            NavigationStack { ScheduleView() }.tabItem { Label("日程", systemImage: "calendar") }.badge(model.reminderUnreadCount)
            NavigationStack { MailView() }.tabItem { Label("邮箱", systemImage: "envelope") }
            NavigationStack { AccountView() }.tabItem { Label("我的", systemImage: "person.crop.circle") }
        }
        .task(id: scenePhase) {
            guard scenePhase == .active else { return }
            while !Task.isCancelled {
                await model.refreshReminders()
                do { try await Task.sleep(for: .seconds(30)) } catch { return }
            }
        }
    }
}
