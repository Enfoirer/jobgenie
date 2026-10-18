import SwiftUI

@MainActor
final class AppModel: ObservableObject {
    @Published var user: SessionUser?
    @Published var isDemo = false
    @Published var isRestoring = true
    @Published var isSigningIn = false
    @Published var authMessage: String?
    @Published var jobs: [Job] = []
    @Published var events: [ScheduleEvent] = []
    @Published var mailboxes: [Mailbox] = []
    @Published var jobsLoading = false
    @Published var scheduleLoading = false
    @Published var mailLoading = false
    @Published var jobsError: String?
    @Published var scheduleError: String?
    @Published var mailError: String?
    let api: APIClient
    private var generation = UUID()
    init(api: APIClient = APIClient(baseURL: APIClient.configuredURL())) { self.api = api }

    func restore() async {
        defer { isRestoring = false }
        do { user = try await api.restore() }
        catch { authMessage = message(error) }
    }
    func signIn(email: String, password: String, remember: Bool) async {
        guard !isSigningIn else { return }
        isSigningIn = true; authMessage = nil
        defer { isSigningIn = false }
        do { user = try await api.signIn(email: email, password: password, remember: remember); generation = UUID() }
        catch { authMessage = message(error) }
    }
    func useDemo() {
        do { try api.clearLocalSession() }
        catch { authMessage = message(error); return }
        generation = UUID(); isDemo = true; authMessage = nil
        user = SessionUser(id: "demo", name: "探索者", email: "demo@example.com")
        jobs = DemoData.jobs; events = DemoData.events; mailboxes = DemoData.mailboxes
    }
    func signOut() async {
        generation = UUID()
        do { try await api.signOut(); authMessage = nil } catch { authMessage = message(error) }
        user = nil; isDemo = false; jobs = []; events = []; mailboxes = []
        jobsError = nil; scheduleError = nil; mailError = nil
        jobsLoading = false; scheduleLoading = false; mailLoading = false
    }
    func revalidate() async {
        guard user != nil, !isDemo else { return }
        let current = generation
        do { let checked = try await api.currentUser(); if current == generation { user = checked } }
        catch APIError.unauthorized { if current == generation { await expire() } }
        catch { /* Keep the current screen on transient offline errors; refresh offers retry. */ }
    }
    func refreshJobs() async {
        guard !isDemo, user != nil, !jobsLoading else { return }
        let current = generation
        jobsLoading = true; jobsError = nil
        defer { if current == generation { jobsLoading = false } }
        do { let response: JobsResponse = try await api.get("api/jobs"); if current == generation { jobs = response.jobs } }
        catch { if current == generation { jobsError = await handle(error) } }
    }
    func refreshSchedule() async {
        guard !isDemo, user != nil, !scheduleLoading else { return }
        let current = generation
        scheduleLoading = true; scheduleError = nil
        defer { if current == generation { scheduleLoading = false } }
        do {
            let response: ScheduleResponse = try await api.get("api/schedule")
            if current == generation { events = response.events.sorted { ($0.time ?? .distantFuture) < ($1.time ?? .distantFuture) } }
        } catch { if current == generation { scheduleError = await handle(error) } }
    }
    func refreshMail() async {
        guard !isDemo, user != nil, !mailLoading else { return }
        let current = generation
        mailLoading = true; mailError = nil
        defer { if current == generation { mailLoading = false } }
        do { let response: MailboxesResponse = try await api.get("api/mail/accounts"); if current == generation { mailboxes = response.accounts } }
        catch { if current == generation { mailError = await handle(error) } }
    }
    func history(for job: Job) async throws -> [HistoryEntry] {
        if isDemo { return [HistoryEntry(id: "demo-history", status: job.status, date: job.dateApplied, notes: "演示状态记录", interviewStage: nil)] }
        do { let response: HistoryResponse = try await api.get("api/jobs/\(job.id)/status-history"); return response.statusHistory.reversed() }
        catch { if error as? APIError == .unauthorized { await expire() }; throw error }
    }
    func save(_ draft: JobDraft, id: String?) async throws {
        let current = generation
        let job: Job
        if isDemo {
            let d = draft.normalized
            let old = jobs.first { $0.id == id }
            job = Job(id: id ?? UUID().uuidString, company: d.company, position: d.position, location: d.location, notes: d.notes, jobUrl: d.jobUrl,
                      status: old?.status ?? .applied, dateApplied: old?.dateApplied ?? .now)
        } else {
            do { job = try await api.save(draft, id: id) }
            catch { if error as? APIError == .unauthorized { await expire() }; throw error }
        }
        guard generation == current else { throw CancellationError() }
        if let index = jobs.firstIndex(where: { $0.id == job.id }) { jobs[index] = job } else { jobs.insert(job, at: 0) }
        if isDemo {
            events = events.map { event in
                guard event.jobId == job.id else { return event }
                return ScheduleEvent(id: event.id, jobId: job.id, company: job.company, position: job.position, kind: event.kind, time: event.time, label: event.label)
            }
        } else { await refreshSchedule() }
    }
    private func expire() async { await signOut(); authMessage = APIError.unauthorized.localizedDescription }
    private func handle(_ error: Error) async -> String? {
        if error as? APIError == .unauthorized { await expire(); return nil }
        if error is CancellationError { return nil }
        return message(error)
    }
    func message(_ error: Error) -> String {
        if let apiError = error as? APIError { return apiError.localizedDescription }
        if let urlError = error as? URLError, [.notConnectedToInternet, .timedOut, .cannotConnectToHost, .networkConnectionLost].contains(urlError.code) { return "网络连接失败，请检查网络后重试。" }
        return "暂时无法完成操作，请重试。"
    }
}

enum DemoData {
    static var jobs: [Job] { [
        Job(id: "demo-1", company: "Northstar", position: "iOS 工程师", location: "上海 · 混合办公", notes: "准备项目介绍，以及一次最有挑战的技术决策。", jobUrl: "https://example.com/careers", status: .interviewing, dateApplied: .now.addingTimeInterval(-7 * 86400)),
        Job(id: "demo-2", company: "Linear Labs", position: "产品工程师", location: "远程", notes: "关注产品体验和工程质量。", status: .applied, dateApplied: .now.addingTimeInterval(-2 * 86400)),
        Job(id: "demo-3", company: "Orbit Studio", position: "软件工程师", location: "杭州", status: .offer, dateApplied: .now.addingTimeInterval(-14 * 86400)),
        Job(id: "demo-4", company: "Maple", position: "前端工程师", location: "北京", status: .rejected, dateApplied: .now.addingTimeInterval(-20 * 86400)),
    ] }
    static var events: [ScheduleEvent] { [
        ScheduleEvent(id: "event-1", jobId: "demo-1", company: "Northstar", position: "iOS 工程师", kind: "appointment", time: .now.addingTimeInterval(86400), label: "Interview"),
        ScheduleEvent(id: "event-2", jobId: "demo-2", company: "Linear Labs", position: "产品工程师", kind: "deadline", time: .now.addingTimeInterval(-86400), label: "Assessment deadline"),
        ScheduleEvent(id: "event-3", jobId: "demo-1", company: "Northstar", position: "iOS 工程师", kind: "appointment", time: nil, label: "Interview"),
    ] }
    static let mailboxes = [Mailbox(id: "demo-mail", provider: "gmail", emailAddress: "demo@example.com")]
}
