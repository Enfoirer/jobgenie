import SwiftUI

struct ScheduleEditorTarget: Identifiable {
    let id = UUID()
    let jobID: String
    let entryID: String
    let kind: ScheduleKind
    let time: Date?
}

struct ScheduleEditor: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.dismiss) private var dismiss
    let target: ScheduleEditorTarget
    @State private var hasTime: Bool
    @State private var time: Date
    @State private var saving = false
    @State private var error: UserMessage?
    init(target: ScheduleEditorTarget) {
        self.target = target
        _hasTime = State(initialValue: target.time != nil)
        _time = State(initialValue: target.time ?? .now.addingTimeInterval(86400))
    }
    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Toggle("设置时间", isOn: $hasTime).accessibilityIdentifier("scheduleEditor.enabled")
                    if hasTime {
                        DatePicker("日程时间", selection: $time, in: HistoryDraft.dateRange)
                            .accessibilityIdentifier("scheduleEditor.time")
                        Button("清除时间", role: .destructive) { hasTime = false }
                            .accessibilityIdentifier("scheduleEditor.clear")
                    }
                } footer: {
                    Text("关闭“设置时间”或点击“清除时间”，保存后移除该时间。面试或笔试记录仍会保留。")
                }
                Section { Text("此处只修改日程时间，不改变状态发生时间或申请当前状态。时间按 iPhone 当前时区显示。") }
                if let error { Section { ErrorBanner(message: error) } }
            }.disabled(saving)
            .localizedNavigationTitle(target.kind.editTitle).navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("取消") { dismiss() }.disabled(saving) }
                ToolbarItem(placement: .confirmationAction) {
                    Button(LocalizedStringKey(saving ? "保存中…" : "保存")) { Task { await save() } }
                        .disabled(saving).accessibilityIdentifier("scheduleEditor.save")
                }
            }.interactiveDismissDisabled(saving)
        }
    }
    private func save() async {
        let draft = ScheduleDraft(kind: target.kind, time: hasTime ? time : nil)
        guard draft.isValid else { error = .text("请选择有效的日程时间。"); return }
        saving = true; error = nil
        defer { saving = false }
        do { try await model.saveSchedule(draft, jobID: target.jobID, entryID: target.entryID); dismiss() }
        catch is CancellationError { }
        catch { self.error = model.message(error) }
    }
}
