import SwiftUI

struct FeedbackView: View {
    @EnvironmentObject private var feedback: FeedbackCoordinator
    @Environment(\.locale) private var locale
    @State private var draft = FeedbackDraft()
    @FocusState private var commentFocused: Bool
    var body: some View {
        NavigationStack {
            Form {
                if feedback.status?.submitted == true {
                    Section {
                        Label("本轮反馈已收到，谢谢。", systemImage: "checkmark.circle")
                        Text("你已完成这轮评价，不会再收到本轮自动邀请。")
                    }
                } else {
                    Section {
                        Text("你的真实体验，帮助我们改进。").font(.headline)
                        Text("这是发给 JobGenie 的产品反馈，不是 App Store 评价。没有标准答案，也不会影响你的申请或服务。")
                            .font(.footnote).foregroundStyle(.secondary)
                    }
                    Section("总体来说，你对 JobGenie 满意吗？") {
                        stars(selection: $draft.overall, name: "overall")
                        Text("1 星：非常不满意 · 5 星：非常满意").font(.caption).foregroundStyle(.secondary)
                    }
                    Section("你有多大可能向朋友推荐 JobGenie？") {
                        stars(selection: $draft.recommendation, name: "recommendation")
                        Text("1 星：非常不可能 · 5 星：非常可能").font(.caption).foregroundStyle(.secondary)
                    }
                    Section("还有什么建议或评价？（可选）") {
                        TextEditor(text: $draft.comment).focused($commentFocused).frame(minHeight: 120).accessibilityIdentifier("feedback.comment")
                        Text("\(draft.comment.utf16.count)/2000").font(.caption).foregroundStyle(draft.comment.utf16.count > 2000 ? .red : .secondary)
                    }
                    Section {
                        Text("反馈会与账号、App 版本和语言一起保存，用于产品分析。请勿填写密码、邮件正文或其他敏感信息。")
                            .font(.footnote).foregroundStyle(.secondary)
                        if let error = feedback.error { ErrorBanner(message: error) }
                        Button { Task { await feedback.submit(draft, locale: locale.identifier) } } label: {
                            if feedback.busy { ProgressView("正在提交反馈…") } else { Text("提交反馈") }
                        }.disabled(!draft.isValid || feedback.busy).accessibilityIdentifier("feedback.submit")
                    }
                }
                Section {
                    Button("永远不再自动显示") { Task { await feedback.dismiss(never: true, locale: locale.identifier) } }
                        .accessibilityIdentifier("feedback.never").disabled(feedback.busy)
                    Text("关闭后仍可在“我的”中主动反馈。").font(.footnote).foregroundStyle(.secondary)
                }
            }
            .localizedNavigationTitle("评价 JobGenie").navigationBarTitleDisplayMode(.inline)
            .scrollDismissesKeyboard(.interactively)
            .toolbar { ToolbarItem(placement: .cancellationAction) {
                Button(LocalizedStringKey(feedback.status?.submitted == true ? "关闭" : "稍后回答")) { Task { await feedback.dismiss(never: false, locale: locale.identifier) } }
                    .accessibilityIdentifier("feedback.later").disabled(feedback.busy)
            } }
            .toolbar { ToolbarItemGroup(placement: .keyboard) {
                Spacer()
                Button("完成") { commentFocused = false }.accessibilityIdentifier("feedback.keyboardDone")
            } }
            .interactiveDismissDisabled()
            .task { await feedback.acknowledgeShown(locale: locale.identifier) }
        }
    }
    private func stars(selection: Binding<Int?>, name: String) -> some View {
        HStack(spacing: 10) {
            ForEach(1...5, id: \.self) { number in
                Button { selection.wrappedValue = number } label: {
                    Image(systemName: number <= (selection.wrappedValue ?? 0) ? "star.fill" : "star")
                        .font(.system(size: 27)).foregroundStyle(Brand.teal).frame(minWidth: 44, minHeight: 44)
                }.buttonStyle(.plain).disabled(feedback.busy)
                    .accessibilityLabel(Text(String(format: L10n.string("%lld 星（满分 5 星）", locale: locale), Int64(number))))
                    .accessibilityValue(number == selection.wrappedValue ? Text("已选择") : Text("未选择"))
                    .accessibilityIdentifier("feedback.\(name).\(number)")
            }
        }.frame(maxWidth: .infinity)
    }
}
