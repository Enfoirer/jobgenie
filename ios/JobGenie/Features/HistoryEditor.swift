import SwiftUI

struct HistoryEditorTarget: Identifiable {
    let id = UUID()
    let entry: HistoryEntry?
}
struct HistoryEditor: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.dismiss) private var dismiss
    let jobID: String
    let entry: HistoryEntry?
    @State private var draft: HistoryDraft
    @State private var saving = false
    @State private var error: UserMessage?
    @State private var needsVerification = false
    init(jobID: String, entry: HistoryEntry?, status: ApplicationStatus) {
        self.jobID = jobID; self.entry = entry
        _draft = State(initialValue: HistoryDraft(entry: entry, status: status))
    }
    var body: some View {
        NavigationStack {
            Form {
                Section("状态记录") {
                    Picker("状态", selection: $draft.status) {
                        ForEach(ApplicationStatus.allCases) { status in
                            Text(LocalizedStringKey(status == .interviewing ? "面试 / 笔试" : status.title)).tag(status)
                        }
                    }.accessibilityIdentifier("historyEditor.status")
                    DatePicker("状态发生时间", selection: $draft.date, in: HistoryDraft.dateRange, displayedComponents: [.date, .hourAndMinute])
                        .accessibilityIdentifier("historyEditor.date")
                    if draft.status == .interviewing {
                        TextField("阶段，例如笔试、初面、终面", text: $draft.interviewStage)
                            .accessibilityIdentifier("historyEditor.stage")
                    }
                    TextField("备注", text: $draft.notes, axis: .vertical).lineLimit(3...8).accessibilityIdentifier("historyEditor.notes")
                }.disabled(saving || needsVerification)
                Section {
                    Text("状态发生时间用于排列历史，不是面试预约或笔试截止时间。时间按 iPhone 当前时区显示。")
                    if entry?.affectsCurrentStatus == false {
                        Text("此记录仅保留历史。编辑后仍不会用于计算当前状态。")
                    }
                    if entry?.source != nil { Text("邮件来源会保留，无法在此修改。") }
                }.font(.footnote).foregroundStyle(.secondary)
                if let error { Section { ErrorBanner(message: error) } }
                if needsVerification {
                    Section { Text("保存结果未确认。请返回并刷新时间线，确认是否已保存后再新增，避免重复记录。") }
                }
            }
            .localizedNavigationTitle(entry == nil ? "新增状态记录" : "编辑状态记录")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("取消") { dismiss() }.disabled(saving) }
                ToolbarItem(placement: .confirmationAction) {
                    Button(LocalizedStringKey(saving ? "保存中…" : "保存")) { Task { await save() } }
                        .disabled(saving || needsVerification).accessibilityIdentifier("historyEditor.save")
                }
            }.interactiveDismissDisabled(saving)
        }
    }
    private func save() async {
        guard !saving else { return }
        if let message = draft.validationMessage { error = .text(message); return }
        saving = true; error = nil
        defer { saving = false }
        do { try await model.saveHistory(draft, jobID: jobID, entryID: entry?.id); dismiss() }
        catch {
            self.error = model.message(error)
            // POST may have committed before the connection broke. No automatic
            // retry; require a fresh timeline before another create attempt.
            if entry == nil {
                switch error as? APIError {
                case .invalidInput, .notFound, .conflict, .rateLimited, .unauthorized: break
                default: needsVerification = true
                }
            }
        }
    }
}
