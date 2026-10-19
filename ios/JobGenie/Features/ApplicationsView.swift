import SwiftUI

struct ApplicationsView: View {
    @EnvironmentObject private var model: AppModel
    @State private var search = ""
    @State private var filter: ApplicationStatus?
    @State private var creating = false
    private var filtered: [Job] {
        model.jobs.filter { job in
            (filter == nil || job.status == filter) && (search.isEmpty || "\(job.company) \(job.position) \(job.location ?? "")".localizedCaseInsensitiveContains(search))
        }
    }
    var body: some View {
        List {
                DemoNotice()
            Section {
                VStack(alignment: .leading, spacing: 12) {
                    Text("每一步，都算数。").font(.title2.bold())
                    Text("记录进展，把精力留给下一个机会。") .font(.subheadline).foregroundStyle(.secondary)
                    HStack(spacing: 20) {
                        metric("全部申请", count: model.jobs.count)
                        metric("面试中", count: model.jobs.filter { $0.status == .interviewing }.count)
                        metric("Offer", count: model.jobs.filter { $0.status == .offer }.count)
                    }.padding(.top, 6)
                }.padding(.vertical, 8)
            }
            Section {
                Picker("状态", selection: $filter) {
                    Text("全部状态").tag(ApplicationStatus?.none)
                    ForEach(ApplicationStatus.allCases) { status in Text(LocalizedStringKey(status.title)).tag(Optional(status)) }
                }.accessibilityIdentifier("jobs.filter")
            }
            if let error = model.jobsError { Section { ErrorBanner(message: error) { Task { await model.refreshJobs() } } } }
            Section("申请记录 · \(filtered.count)") {
                if model.jobsLoading && model.jobs.isEmpty { ProgressView("正在加载申请…") }
                else if filtered.isEmpty {
                    ContentUnavailableView(LocalizedStringKey(search.isEmpty && filter == nil ? "还没有申请记录" : "没有匹配的申请"), systemImage: "tray", description: Text("点击右上角添加，或调整搜索条件。"))
                } else {
                    ForEach(filtered) { job in
                        NavigationLink { JobDetailView(jobID: job.id) } label: {
                            HStack(alignment: .top, spacing: 12) {
                                CompanyMark(company: job.company)
                                VStack(alignment: .leading, spacing: 7) {
                                    Text(job.company).font(.headline)
                                    Text(job.position).font(.subheadline)
                                    if let location = job.location, !location.isEmpty { Text(location).font(.caption).foregroundStyle(.secondary) }
                                    StatusBadge(status: job.status)
                                }
                            }.padding(.vertical, 6)
                        }.accessibilityIdentifier("job.\(job.id)")
                    }
                }
            }
        }
        .localizedNavigationTitle("我的申请")
        .searchable(text: $search, prompt: "搜索公司、职位或地点")
        .toolbar { Button { creating = true } label: { Image(systemName: "plus") }.accessibilityLabel("添加申请").accessibilityIdentifier("jobs.add") }
        .sheet(isPresented: $creating) { JobEditor(job: nil) }
        .refreshable { await model.refreshJobs() }
        .task { await model.refreshJobs() }
    }
    private func metric(_ title: LocalizedStringKey, count: Int) -> some View {
        VStack(alignment: .leading, spacing: 4) { Text(count, format: .number).font(.title.bold()).foregroundStyle(Brand.teal); Text(title).font(.caption).foregroundStyle(.secondary) }
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}
struct JobDetailView: View {
    @EnvironmentObject private var model: AppModel
    let jobID: String
    @State private var editing = false
    @State private var history: [HistoryEntry] = []
    @State private var loading = false
    @State private var error: UserMessage?
    private var job: Job? { model.jobs.first { $0.id == jobID } }
    var body: some View {
        Group {
            if let job {
                List {
                DemoNotice()
                    Section {
                        HStack(spacing: 14) { CompanyMark(company: job.company); VStack(alignment: .leading, spacing: 6) { Text(job.company).font(.title2.bold()); Text(job.position).foregroundStyle(.secondary) } }
                        StatusBadge(status: job.status)
                        if let location = job.location, !location.isEmpty { Label(location, systemImage: "mappin.and.ellipse") }
                        LabeledContent("申请日期") { Text(job.dateApplied, format: .dateTime.year().month(.abbreviated).day()).accessibilityIdentifier("job.appliedDate") }
                        if let raw = job.jobUrl, let url = JobDraft.safeURL(raw) { Link(destination: url) { Label("查看岗位链接", systemImage: "arrow.up.right.square") } }
                    }
                    Section("备注") {
                        if let notes = job.notes, !notes.isEmpty { Text(verbatim: notes).textSelection(.enabled) }
                        else { Text("暂无备注") }
                    }
                    Section("状态时间线") {
                        if loading { ProgressView() }
                        if let error { ErrorBanner(message: error) { Task { await load() } } }
                        ForEach(history) { entry in
                            VStack(alignment: .leading, spacing: 8) {
                                StatusBadge(status: entry.status)
                                Text(entry.date, format: .dateTime.year().month(.abbreviated).day().hour().minute()).font(.caption).foregroundStyle(.secondary)
                                if let stage = entry.interviewStage, !stage.isEmpty { Text(stage) }
                                if let notes = entry.notes, !notes.isEmpty { Text(notes).font(.subheadline) }
                            }.padding(.vertical, 4)
                        }
                        if !loading && history.isEmpty && error == nil { Text("暂无状态记录").foregroundStyle(.secondary) }
                    }
                }
                .toolbar { Button("编辑") { editing = true }.accessibilityIdentifier("job.edit") }
                .sheet(isPresented: $editing) { JobEditor(job: job) }
                .refreshable { await load() }
            } else { ContentUnavailableView("申请已不可用", systemImage: "tray") }
        }.localizedNavigationTitle("申请详情").navigationBarTitleDisplayMode(.inline).task { await load() }
    }
    private func load() async {
        guard let job, !loading else { return }
        loading = true; error = nil
        defer { loading = false }
        do { history = try await model.history(for: job) } catch { self.error = model.message(error) }
    }
}
struct JobEditor: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.dismiss) private var dismiss
    let job: Job?
    @State private var draft: JobDraft
    @State private var saving = false
    @State private var error: UserMessage?
    init(job: Job?) { self.job = job; _draft = State(initialValue: JobDraft(job: job)) }
    var body: some View {
        NavigationStack {
            Form {
                Section("必填信息") {
                    TextField("公司", text: $draft.company).accessibilityIdentifier("editor.company")
                    TextField("职位", text: $draft.position).accessibilityIdentifier("editor.position")
                }
                Section("更多信息") {
                    TextField("地点", text: $draft.location).accessibilityIdentifier("editor.location")
                    TextField("岗位链接 · https://", text: $draft.jobUrl).keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
                    TextField("备注", text: $draft.notes, axis: .vertical).lineLimit(4...10).accessibilityIdentifier("editor.notes")
                }
                if let error { Section { ErrorBanner(message: error) } }
                Section { Text(LocalizedStringKey(job == nil ? "新申请的初始状态为“已申请”。" : "此处编辑申请信息；状态沿用已有时间线。")) .font(.footnote).foregroundStyle(.secondary) }
            }.disabled(saving)
            .localizedNavigationTitle(job == nil ? "添加申请" : "编辑申请").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("取消") { dismiss() }.disabled(saving) }
                ToolbarItem(placement: .confirmationAction) { Button(LocalizedStringKey(saving ? "保存中…" : "保存")) { Task { await save() } }.disabled(saving).accessibilityIdentifier("editor.save") }
            }.interactiveDismissDisabled(saving)
        }
    }
    private func save() async {
        if let message = draft.validationMessage { error = .text(message); return }
        saving = true; error = nil
        defer { saving = false }
        do { try await model.save(draft, id: job?.id); dismiss() } catch { self.error = model.message(error) }
    }
}
