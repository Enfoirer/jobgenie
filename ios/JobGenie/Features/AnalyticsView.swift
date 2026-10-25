import SwiftUI

struct AnalyticsView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.scenePhase) private var scenePhase
    @State private var range = AnalyticsRange()
    @State private var loading = false
    @State private var error: UserMessage?
    var body: some View {
        List {
            DemoNotice()
            Section("统计日期") {
                DatePicker("开始日期", selection: $range.start, in: ...Date.now, displayedComponents: .date).accessibilityIdentifier("analytics.start")
                DatePicker("结束日期", selection: $range.end, in: ...Date.now, displayedComponents: .date).accessibilityIdentifier("analytics.end")
                Text("最多选择 366 天，按手机时区统计。") .font(.footnote).foregroundStyle(.secondary)
                Text(verbatim: range.timeZone.identifier).font(.caption)
                Button("应用日期范围") { Task { await load() } }.disabled(loading || !range.isValid()).accessibilityIdentifier("analytics.apply")
            }
            if loading { ProgressView("正在加载统计…") }
            if let error { ErrorBanner(message: error) { Task { await load() } } }
            if let stats = model.analytics {
                Section("当前状态分布") {
                    Text("全部申请的当前状态，不受所选日期范围影响。") .font(.footnote).foregroundStyle(.secondary)
                    LabeledContent("全部申请", value: stats.currentStatus.total.formatted()).accessibilityIdentifier("analytics.total")
                    ForEach(ApplicationStatus.allCases) { status in
                        VStack(alignment: .leading) {
                            LabeledContent(LocalizedStringKey(status.title), value: (stats.currentStatus.counts[status.rawValue] ?? 0).formatted())
                            ProgressView(value: Double(stats.currentStatus.counts[status.rawValue] ?? 0), total: Double(max(1, stats.currentStatus.total))).accessibilityHidden(true)
                        }
                    }
                    LabeledContent("更新时间") { Text(stats.currentStatus.asOf, format: .dateTime.month().day().hour().minute()) }.font(.caption)
                }
                Section("阶段转化率") {
                    Text("仅统计所选日期内提交的申请，并观察截至该范围结束时已发生的历史。没有面试记录的 Offer 不计入面试转 Offer。") .font(.footnote).foregroundStyle(.secondary)
                    Text(verbatim: "\(stats.range.start) — \(stats.range.end) · \(stats.range.timeZone)").font(.caption).accessibilityIdentifier("analytics.range")
                    LabeledContent("范围内申请", value: stats.cohort.total.formatted())
                    rate("申请 → 面试", stats.cohort.conversion.appliedToInterview, id: "analytics.interview")
                    rate("面试 → Offer", stats.cohort.conversion.interviewToOffer, id: "analytics.offer")
                    rate("申请 → Offer", stats.cohort.conversion.appliedToOffer, id: "analytics.direct")
                    LabeledContent("无先前面试记录的 Offer", value: stats.cohort.offersWithoutPriorInterview.formatted())
                    LabeledContent("范围内无有效历史的申请", value: stats.cohort.withoutHistory.formatted())
                    Text("— 表示没有可计算的分母，不代表 0%。") .font(.footnote).foregroundStyle(.secondary)
                }
            }
        }.localizedNavigationTitle("统计分析")
            .task { await load() }
            .refreshable { await load() }
            .onChange(of: scenePhase) { _, phase in if phase == .active { Task { await load() } } }
    }
    private func rate(_ title: LocalizedStringKey, _ rate: AnalyticsResponse.Rate, id: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            LabeledContent(title, value: rate.fraction.map { $0.formatted(.percent.precision(.fractionLength(1))) } ?? "—")
            Text(verbatim: "\(rate.numerator) / \(rate.denominator)").font(.caption).foregroundStyle(.secondary)
        }.accessibilityIdentifier(id)
    }
    private func load() async {
        guard !loading else { return }; loading = true; error = nil
        defer { loading = false }
        range.timeZone = .current
        do { try await model.loadAnalytics(range) }
        catch is CancellationError { }
        catch { self.error = model.message(error) }
    }
}
