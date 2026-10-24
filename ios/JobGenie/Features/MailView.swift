import SwiftUI

struct MailView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.locale) private var locale
    @StateObject private var authorization = MailAuthorization()
    var body: some View {
        List {
            DemoNotice()
            Section {
                Label("机会，来自每一封来信", systemImage: "envelope.badge").font(.headline)
                Text("同步邮箱、重试失败邮件，并确认需要你决定的申请变更。")
                    .font(.subheadline).foregroundStyle(.secondary)
                if model.mailBusy { ProgressView("正在处理邮件…") }
                if let message = model.mailNotice { Text(message.localized(locale: locale)).font(.footnote) }
                if let message = authorization.message { Text(message.localized(locale: locale)).font(.footnote) }
            }
            if let error = model.mailError { Section { ErrorBanner(message: error) { Task { await model.refreshMail(force: true) } } } }
            Section("人工确认") {
                NavigationLink { PendingMailList() } label: {
                    LabeledContent("待确认邮件", value: model.pendingMail.count.formatted())
                }.accessibilityIdentifier("mail.pending")
            }
            Section("已连接的邮箱") {
                if model.mailLoading && model.mailboxes.isEmpty { ProgressView("正在加载邮箱…") }
                else if model.mailboxes.isEmpty { Text("尚未连接邮箱") }
                ForEach(model.mailboxes) { mailbox in
                    VStack(alignment: .leading, spacing: 12) {
                        Text(mailbox.provider == "gmail" ? "Gmail" : "Outlook").font(.headline)
                        Text(verbatim: mailbox.emailAddress).font(.subheadline)
                        HStack {
                            Button("立即同步") { Task { await model.runMail(accountID: mailbox.id, retry: false) } }
                                .accessibilityIdentifier("mail.sync.\(mailbox.id)")
                            Spacer()
                            Button("重试失败邮件") { Task { await model.runMail(accountID: mailbox.id, retry: true) } }
                                .disabled(mailbox.backlog?.failed == 0).accessibilityIdentifier("mail.retry.\(mailbox.id)")
                        }.buttonStyle(.borderless).disabled(model.mailBusy || authorization.busy)
                        if mailbox.hasMore == true { Text("仍有邮件未拉取，可再次同步继续。") .font(.footnote).foregroundStyle(.orange) }
                        if let backlog = mailbox.backlog {
                            LabeledContent("待处理", value: backlog.pending.formatted())
                            LabeledContent("处理中", value: backlog.processing.formatted())
                            LabeledContent("处理失败", value: backlog.failed.formatted())
                            LabeledContent("待确认邮件", value: backlog.pendingReview.formatted())
                        } else if !model.isDemo { Text("队列数量暂不可用，请刷新。") }
                        if let run = mailbox.lastSync {
                            Divider(); Text("最近同步结果").font(.subheadline.bold())
                            if let time = run.finishedAt { Text(time, format: .dateTime.year().month().day().hour().minute()).font(.caption) }
                            count("拉取", run.totalFetched); count("处理成功", run.processed)
                            count("处理失败", run.failed); count("转入人工确认", run.pendingReview)
                            count("错误数量", run.errorCount)
                            ForEach(run.errorStages ?? [], id: \.self) { Text(LocalizedStringKey(MailRun.stageTitle($0))).font(.caption).foregroundStyle(.orange) }
                            Text("处理成功包含转入人工确认和无关邮件，不等于新增申请数。") .font(.caption).foregroundStyle(.secondary)
                        }
                        if let failures = mailbox.failures, !failures.isEmpty {
                            Text("最近失败邮件（最多 10 封）").font(.subheadline.bold())
                            ForEach(failures) { failure in
                                VStack(alignment: .leading) { Text(verbatim: failure.subject); LabeledContent("尝试次数", value: failure.attempts.formatted()) }.font(.caption)
                            }
                        }
                    }.padding(.vertical, 5)
                }
            }
            Section("连接邮箱") {
                Button("连接 Gmail") { authorization.connect(provider: "google", model: model) }.accessibilityIdentifier("mail.connect.google")
                Button("连接 Outlook") { authorization.connect(provider: "outlook", model: model) }.accessibilityIdentifier("mail.connect.outlook")
                if authorization.busy { ProgressView("正在等待邮箱授权…") }
                Text(LocalizedStringKey(model.isDemo ? "演示模式不会连接真实邮箱。" : "将在系统授权窗口连接邮箱，完成后自动返回 App。"))
                    .font(.footnote).foregroundStyle(.secondary)
            }.disabled(model.isDemo || model.mailBusy || authorization.busy)
        }.localizedNavigationTitle("邮箱")
        .refreshable { await model.refreshMail(force: true) }.task { await model.refreshMail() }
        .onChange(of: scenePhase) { _, phase in if phase == .active { Task { await model.refreshMail() } } }
        .onDisappear { authorization.cancel() }
    }
    private func count(_ title: LocalizedStringKey, _ number: Int?) -> some View { LabeledContent(title, value: number?.formatted() ?? "—").font(.caption) }
}

struct PendingMailList: View {
    @EnvironmentObject private var model: AppModel
    var body: some View {
        List {
            if let error = model.mailError { ErrorBanner(message: error) { Task { await model.refreshMail(force: true) } } }
            if model.pendingMail.isEmpty { Text("没有待确认邮件") }
            ForEach(model.pendingMail) { item in
                NavigationLink { MailReviewView(item: item) } label: {
                    VStack(alignment: .leading, spacing: 5) {
                        Text(verbatim: item.subject ?? "—").font(.headline)
                        Text(verbatim: item.from ?? "—").font(.caption).foregroundStyle(.secondary)
                    }
                }.accessibilityIdentifier("mail.review.\(item.id)")
            }
        }.localizedNavigationTitle("待确认邮件")
        .refreshable { await model.refreshMail(force: true) }.task { await model.refreshMail() }
    }
}
struct MailReviewView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.dismiss) private var dismiss
    let item: PendingMail
    @State private var draft: MailReviewDraft
    @State private var saving = false
    @State private var ignoring = false
    @State private var error: UserMessage?
    init(item: PendingMail) { self.item = item; _draft = State(initialValue: MailReviewDraft(item)) }
    var body: some View {
        Form {
            Section("邮件来源") {
                Text(verbatim: item.subject ?? "—").font(.headline)
                Text(verbatim: item.from ?? "—")
                if let date = item.receivedAt { Text(date, format: .dateTime.year().month().day().hour().minute()) }
                if let snippet = item.snippet { Text(verbatim: snippet).font(.subheadline) }
                if let summary = item.summary { Text(verbatim: summary).font(.subheadline) }
                if let confidence = item.confidence, confidence.isFinite, (0...1).contains(confidence) {
                    LabeledContent("提取置信度", value: confidence.formatted(.percent.precision(.fractionLength(0))))
                }
                Text("请核对邮件内容、事件类型和目标申请，再确认。") .font(.footnote).foregroundStyle(.secondary)
            }
            Section("确认内容") {
                TextField("公司", text: $draft.company).accessibilityIdentifier("review.company")
                TextField("职位", text: $draft.position).accessibilityIdentifier("review.position")
                Picker("邮件事件", selection: $draft.eventType) {
                    if MailEventType(rawValue: draft.eventType) == nil { Text("请选择事件类型").tag(draft.eventType) }
                    ForEach(MailEventType.allCases) { Text(LocalizedStringKey($0.title)).tag($0.rawValue) }
                }.accessibilityIdentifier("review.event")
                Picker("目标申请", selection: $draft.target) {
                    Text("请选择目标申请").tag("")
                    Text("新建申请").tag("new")
                    ForEach(model.jobs) { Text(verbatim: "\($0.company) · \($0.position)").tag($0.id) }
                    if !draft.target.isEmpty && draft.target != "new" && !model.jobs.contains(where: { $0.id == draft.target }) {
                        Text("目标申请尚未加载，请刷新或重新选择").tag(draft.target)
                    }
                }.accessibilityIdentifier("review.target")
                if model.jobsError != nil { Text("申请列表加载失败，请返回后重试。") }
                optionalTime("面试时间", value: $draft.interviewTime)
                optionalTime("笔试截止时间", value: $draft.deadline)
            }
            if let error { Section { ErrorBanner(message: error) } }
            Section {
                Button("确认并应用") { Task { await submit(ignore: false) } }.accessibilityIdentifier("review.accept")
                Button("忽略这封邮件", role: .destructive) { ignoring = true }.accessibilityIdentifier("review.ignore")
                if saving { ProgressView() }
            }
        }.disabled(saving || model.mailBusy)
        .localizedNavigationTitle("人工确认")
        .task { await model.refreshJobs() }
        .confirmationDialog("忽略这封邮件？", isPresented: $ignoring, titleVisibility: .visible) {
            Button("确认忽略", role: .destructive) { Task { await submit(ignore: true) } }
        }
    }
    private func optionalTime(_ title: LocalizedStringKey, value: Binding<Date?>) -> some View {
        VStack(alignment: .leading) {
            Toggle(title, isOn: Binding(get: { value.wrappedValue != nil }, set: { value.wrappedValue = $0 ? .now.addingTimeInterval(86400) : nil }))
            if value.wrappedValue != nil {
                DatePicker(title, selection: Binding(get: { value.wrappedValue ?? .now }, set: { value.wrappedValue = $0 }), in: HistoryDraft.dateRange)
            }
        }
    }
    private func submit(ignore: Bool) async {
        guard ignore || (draft.isValid && (draft.target == "new" || model.jobs.contains { $0.id == draft.target })) else {
            error = .text("请填写公司、职位，选择有效的事件类型和目标申请。"); return
        }
        saving = true; error = nil
        defer { saving = false }
        do { try await model.reviewMail(item, draft: draft, ignore: ignore); dismiss() }
        catch is CancellationError { }
        catch { self.error = model.message(error) }
    }
}
