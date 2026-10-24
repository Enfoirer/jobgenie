import SwiftUI

struct RemindersView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.locale) private var locale
    @State private var filter: ReminderFilter = .unread
    @State private var cancelling: ReminderItem?
    @State private var showingSettings = false
    @State private var actionError: UserMessage?
    var body: some View {
        TimelineView(.periodic(from: .now, by: 10)) { _ in
            List {
                DemoNotice()
                Section {
                    LabeledContent("未读提醒", value: model.reminderSettings == nil ? "—" : model.reminderUnreadCount.formatted())
                        .accessibilityIdentifier("reminders.unreadCount")
                    Picker("提醒分类", selection: $filter) {
                        ForEach(ReminderFilter.allCases) { Text(LocalizedStringKey($0.title)).tag($0) }
                    }.accessibilityIdentifier("reminders.filter")
                    Text("提醒在日程开始或截止时失效；已处理列表仅保留当前提醒窗口内的记录。")
                        .font(.footnote).foregroundStyle(.secondary)
                    Text("App 在前台时自动刷新提醒，后台推送尚未开启。")
                        .font(.footnote).foregroundStyle(.secondary)
                }
                if let error = model.remindersError {
                    Section {
                        ErrorBanner(message: error) { Task { await model.refreshReminders(force: true) } }
                        Text("当前显示上次已取得的数据，请刷新后再核对。") .font(.footnote)
                    }
                }
                if let actionError { Section { ErrorBanner(message: actionError) } }
                if let notice = model.remindersNotice { Section { Text(notice.localized(locale: locale)) } }
                if model.remindersLoading && model.reminderSettings == nil { ProgressView("正在加载提醒…") }
                if model.reminderSettings?.enabled == false { Text("提醒已关闭，可在提醒设置中开启。") }
                Section(LocalizedStringKey(filter.title)) {
                    let items = model.visibleReminders.filter { filter.includes($0.status) }
                    if items.isEmpty && model.reminderSettings != nil && model.remindersError == nil {
                        Text("暂无此类提醒").accessibilityIdentifier("reminders.empty")
                    }
                    ForEach(items) { item in
                        VStack(alignment: .leading, spacing: 10) {
                            NavigationLink { JobDetailView(jobID: item.jobId) } label: {
                                VStack(alignment: .leading) {
                                    Text(verbatim: item.company).font(.headline)
                                    Text(verbatim: item.position).font(.subheadline)
                                }
                            }.accessibilityIdentifier("reminder.detail.\(item.id)")
                            Label(LocalizedStringKey(item.title), systemImage: item.kind == "deadline" ? "hourglass" : "video")
                                .font(.subheadline)
                            Text(item.time, format: .dateTime.year().month().day().hour().minute())
                            Text(LocalizedStringKey(item.statusTitle)).font(.caption).foregroundStyle(.secondary)
                            if let time = item.snoozedUntil {
                                LabeledContent("再次提醒时间") { Text(time, format: .dateTime.hour().minute()) }
                            }
                            if item.status == .unread || item.status == .snoozed {
                                HStack {
                                    Button("标为已读") { Task { await act(item, .read) } }
                                        .accessibilityIdentifier("reminder.read.\(item.id)")
                                    Spacer()
                                    Button("延后 10 分钟") { Task { await act(item, .snooze) } }
                                        .disabled(item.status == .snoozed || !item.canSnooze || item.time <= model.reminderNow.addingTimeInterval(600))
                                        .accessibilityIdentifier("reminder.snooze.\(item.id)")
                                }.buttonStyle(.borderless)
                            }
                            if item.status != .cancelled {
                                Button("取消本次提醒", role: .destructive) { cancelling = item }
                                    .buttonStyle(.borderless).accessibilityIdentifier("reminder.cancel.\(item.id)")
                            }
                        }.padding(.vertical, 5).disabled(model.remindersBusy)
                    }
                }
            }
        }
        .localizedNavigationTitle("提醒")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button("提醒设置") { showingSettings = true }.disabled(model.reminderSettings == nil || model.remindersBusy)
                    .accessibilityIdentifier("reminders.settings")
            }
        }
        .sheet(isPresented: $showingSettings) {
            if let settings = model.reminderSettings { ReminderSettingsView(settings: settings) }
        }
        .confirmationDialog("取消本次提醒？日程和申请记录会保留。", isPresented: Binding(get: { cancelling != nil }, set: { if !$0 { cancelling = nil } }), titleVisibility: .visible) {
            Button("确认取消提醒", role: .destructive) { if let item = cancelling { Task { await act(item, .cancel) }; cancelling = nil } }
        }
        .refreshable { await model.refreshReminders(force: true) }
        .task { await model.refreshReminders() }
    }
    private func act(_ item: ReminderItem, _ action: ReminderAction) async {
        actionError = nil
        do { try await model.actOnReminder(item, action: action) }
        catch is CancellationError { }
        catch { actionError = model.message(error) }
    }
}

struct ReminderSettingsView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.dismiss) private var dismiss
    @State private var draft: ReminderSettings
    @State private var saving = false
    @State private var error: UserMessage?
    init(settings: ReminderSettings) { _draft = State(initialValue: settings) }
    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Toggle("开启提醒", isOn: $draft.enabled).accessibilityIdentifier("reminders.enabled")
                    Picker("提前时间", selection: $draft.leadMinutes) {
                        ForEach(ReminderSettings.leadTimes, id: \.self) { Text(LocalizedStringKey(ReminderSettings.title($0))).tag($0) }
                    }.accessibilityIdentifier("reminders.lead")
                    Text("设置与网页版共用。修改提前时间或重新开启，不会重置已读和取消记录。") .font(.footnote).foregroundStyle(.secondary)
                    Text("延后固定为 10 分钟；距离日程不足 10 分钟时不能延后。") .font(.footnote).foregroundStyle(.secondary)
                }
                if let error { ErrorBanner(message: error) }
            }.disabled(saving)
            .localizedNavigationTitle("提醒设置")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("取消") { dismiss() }.disabled(saving) }
                ToolbarItem(placement: .confirmationAction) {
                    Button("保存") {
                        Task {
                            saving = true; error = nil
                            defer { saving = false }
                            do { try await model.saveReminderSettings(draft); dismiss() }
                            catch is CancellationError { }
                            catch { self.error = model.message(error) }
                        }
                    }.disabled(saving || model.remindersBusy).accessibilityIdentifier("reminders.saveSettings")
                }
            }
        }
    }
}
