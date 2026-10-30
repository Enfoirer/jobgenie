import SwiftUI

struct BulkControls: View {
    @EnvironmentObject private var model: AppModel
    @Binding var selected: Set<String>
    let records: [(id: String, label: String)]
    var pending = false
    var archived = false
    @State private var action = ""
    @State private var confirming = false
    @State private var report: BulkResponse?
    @State private var error: UserMessage?
    private var options: [(String, String)] {
        if pending { return [("accept", "批量确认邮件"), ("ignore", "批量忽略邮件")] }
        return [(archived ? "restore" : "archive", archived ? "恢复所选申请" : "归档所选申请")]
            + ApplicationStatus.allCases.map { ($0.rawValue, $0.title) }
    }
    private var currentAction: String { options.contains { $0.0 == action } ? action : options[0].0 }
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Button("选择当前列表（最多 50 项）") { selected = Set(records.prefix(50).map(\.id)) }
                    .accessibilityIdentifier("bulk.selectAll")
                Spacer()
                Button("清除选择") { selected = [] }
            }.buttonStyle(.borderless).disabled(model.bulkBusy || model.mailBusy)
            Text("已选择 \(selected.count) 项")
            Picker("批量操作", selection: Binding(get: { currentAction }, set: { action = $0 })) {
                ForEach(options, id: \.0) { option in Text(LocalizedStringKey(option.1)).tag(option.0) }
            }.disabled(model.bulkBusy || model.mailBusy).accessibilityIdentifier("bulk.action")
            Text(LocalizedStringKey(pending
                ? "确认将使用每封邮件当前的内容和目标申请；目标不明确的邮件会保留待确认，请逐封编辑。"
                : "归档保留历史和统计，隐藏日程与提醒，可随时恢复。修改状态会按需新增历史。"))
                .font(.caption).foregroundStyle(.secondary)
            Button("应用到所选项目") { confirming = true }
                .disabled(selected.isEmpty || selected.count > 50 || model.bulkBusy || model.mailBusy)
                .accessibilityIdentifier("bulk.apply")
                .buttonStyle(.borderless)
            if model.bulkBusy { ProgressView("正在批量处理…") }
            if let report {
                Text("成功 \(report.succeeded) 项，失败 \(report.failed) 项").accessibilityIdentifier("bulk.result")
                if report.failed > 0 { Text("失败项目仍被选中，可以修正后重试。").font(.caption) }
                ForEach(report.results.filter { !$0.success }) { item in
                    VStack(alignment: .leading) {
                        Text(verbatim: records.first { $0.id == item.id }?.label ?? item.id).font(.caption.bold())
                        Text(LocalizedStringKey(item.status == 404 ? "记录不存在或无权操作。" : "请检查记录内容和目标，刷新后重试。"))
                            .font(.caption).foregroundStyle(.red)
                        if let detail = item.error { Text(verbatim: detail).font(.caption).foregroundStyle(.secondary) }
                    }
                }
            }
            if let error { ErrorBanner(message: error) }
        }
        .confirmationDialog("确认批量操作？", isPresented: $confirming, titleVisibility: .visible) {
            Button(LocalizedStringKey(options.first { $0.0 == currentAction }!.1)) { Task { await submit() } }
                .accessibilityIdentifier("bulk.confirm")
            Button("取消", role: .cancel) { }
        } message: { Text("将处理所选的 \(selected.count) 项。每项独立保存，失败不会撤销已成功的项目。") }
    }
    private func submit() async {
        error = nil; report = nil
        let generation = model.sessionGeneration
        let submitted = selected.intersection(Set(records.map(\.id)))
        let status = pending ? nil : ApplicationStatus(rawValue: currentAction)
        do {
            let result = try await model.performBulk(ids: submitted, action: status == nil ? currentAction : "status", status: status, pending: pending)
            guard generation == model.sessionGeneration else { return }
            report = result; selected = Set(result.results.filter { !$0.success }.map(\.id))
        } catch is CancellationError { }
        catch { if generation == model.sessionGeneration { self.error = model.message(error) } }
    }
}

struct BulkSelectionToggle: View {
    @Binding var selected: Set<String>
    let id: String
    let label: String
    var body: some View {
        Button {
            if selected.contains(id) { selected.remove(id) } else if selected.count < 50 { selected.insert(id) }
        } label: {
            Image(systemName: selected.contains(id) ? "checkmark.circle.fill" : "circle")
                .font(.title2).foregroundStyle(Brand.teal).frame(minWidth: 44, minHeight: 44)
        }.buttonStyle(.borderless).accessibilityLabel(Text(verbatim: label))
            .accessibilityValue(selected.contains(id) ? Text("已选择") : Text("未选择"))
            .accessibilityIdentifier("bulk.select.\(id)")
            .disabled(!selected.contains(id) && selected.count >= 50)
    }
}
