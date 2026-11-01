import SwiftUI

struct SharedJobsView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.scenePhase) private var scenePhase
    @State private var drafts: [SharedJobDraft] = []
    @State private var editing: SharedJobDraft?
    @State private var removing: SharedJobDraft?
    @State private var error: String?
    var body: some View {
        List {
            Section {
                Text("Safari → 分享 → JobGenie，将岗位链接保存到这里。")
                Text("草稿尚未提交。确认保存后才会创建申请，并同步到网页。")
                    .font(.footnote).foregroundStyle(.secondary)
                if let user = model.user { Text(verbatim: user.email).font(.caption) }
                if model.isDemo { Text("演示模式不能导入分享草稿，请登录真实账号。") }
            }
            if let error { Text(LocalizedStringKey(error)).foregroundStyle(.red) }
            if drafts.isEmpty { ContentUnavailableView("没有分享的岗位", systemImage: "square.and.arrow.down") }
            ForEach(drafts) { draft in
                VStack(alignment: .leading, spacing: 8) {
                    Text(verbatim: draft.position.isEmpty ? (draft.title.isEmpty ? draft.url : draft.title) : draft.position).font(.headline)
                    if !draft.company.isEmpty { Text(verbatim: draft.company) }
                    Text(verbatim: draft.url).font(.caption).lineLimit(3).foregroundStyle(.secondary)
                    if model.jobs.contains(where: { $0.jobUrl == draft.url }) {
                        Text("已有相同链接的申请，请确认是否仍需新建。") .font(.caption).foregroundStyle(.orange)
                    }
                    HStack {
                        Button("补充并创建申请") { editing = draft }.disabled(model.isDemo)
                            .accessibilityIdentifier("shared.create.\(draft.id)")
                        Spacer()
                        Button("删除草稿", role: .destructive) { removing = draft }
                    }.buttonStyle(.borderless)
                }
            }
        }
        .localizedNavigationTitle("分享的岗位")
        .task { load() }
        .refreshable { load() }
        .onChange(of: scenePhase) { _, phase in if phase == .active { load() } }
        .sheet(item: $editing, onDismiss: { load() }) { draft in
            JobEditor(shared: draft) {
                do { try SharedJobDraftStore.shared().remove(draft.id); load() }
                catch { self.error = "申请已保存，但草稿清理失败，请删除草稿以免重复创建。" }
            }
        }
        .confirmationDialog("删除草稿？", isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } })) {
            Button("删除草稿", role: .destructive) {
                guard let draft = removing else { return }
                do { try SharedJobDraftStore.shared().remove(draft.id); removing = nil; load() }
                catch { self.error = "无法读取或删除分享草稿，请重试。" }
            }
        }
    }
    private func load() {
        do { drafts = try SharedJobDraftStore.shared().list() }
        catch { self.error = "无法读取或删除分享草稿，请重试。" }
    }
}
