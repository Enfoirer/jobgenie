import SwiftUI

struct ScheduleView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.scenePhase) private var scenePhase
    @State private var editor: ScheduleEditorTarget?
    @State private var bucket: ScheduleBucket = .upcoming
    var body: some View {
        TimelineView(.periodic(from: .now, by: 60)) { context in
            let filtered = model.events.filter { $0.bucket(at: context.date) == bucket }
            List {
                DemoNotice()
                Section {
                    Text("为下一步留出时间").font(.title2.bold()).padding(.vertical, 6)
                    Picker("日程分类", selection: $bucket) { ForEach(ScheduleBucket.allCases) { Text(LocalizedStringKey($0.title)).tag($0) } }
                        .pickerStyle(.menu).accessibilityIdentifier("schedule.filter")
                    Text("时间按 iPhone 当前时区显示。已过时间不代表任务已完成。") .font(.footnote).foregroundStyle(.secondary)
                }
                if let error = model.scheduleError { Section { ErrorBanner(message: error) { Task { await model.refreshSchedule() } } } }
                Section(LocalizedStringKey(bucket.title)) {
                    if model.scheduleLoading && model.events.isEmpty { ProgressView("正在加载日程…") }
                    else if filtered.isEmpty { ContentUnavailableView("暂无此类日程", systemImage: "calendar.badge.checkmark", description: Text("网页端更新的面试和笔试时间会显示在这里。")) }
                    ForEach(filtered) { event in
                        VStack(alignment: .leading, spacing: 10) {
                            NavigationLink { JobDetailView(jobID: event.jobId) } label: {
                                Label("查看申请详情", systemImage: "arrow.up.right")
                            }.accessibilityIdentifier("schedule.detail.\(event.id)")
                            Label(LocalizedStringKey(event.title), systemImage: event.kind == "deadline" ? "hourglass" : "video").font(.caption.bold()).foregroundStyle(Brand.teal)
                            Text(event.company).font(.headline)
                            Text(event.position).font(.subheadline).foregroundStyle(.secondary)
                            if let time = event.time { Text(time, format: .dateTime.year().month(.abbreviated).day().hour().minute()).font(.subheadline.weight(.medium)) }
                            else { Text("尚未安排时间").font(.subheadline).foregroundStyle(.orange) }
                            if let entryID = event.historyId, let kind = ScheduleKind(rawValue: event.kind) {
                                Button(LocalizedStringKey(kind.editTitle)) {
                                    editor = ScheduleEditorTarget(jobID: event.jobId, entryID: entryID, kind: kind, time: event.time)
                                }.buttonStyle(.borderless).disabled(model.historyMutations.contains(event.jobId))
                                    .accessibilityIdentifier("schedule.edit.\(event.id)")
                            }
                        }.padding(.vertical, 6)
                    }
                }
            }
        }.localizedNavigationTitle("日程与待办")
        .sheet(item: $editor) { ScheduleEditor(target: $0) }
        .onChange(of: scenePhase) { _, phase in if phase == .active { Task { await model.refreshSchedule() } } }
        .refreshable { await model.refreshSchedule() }.task { await model.refreshSchedule() }
    }
}
