import SwiftUI

@MainActor
final class AppModel: ObservableObject {
    @Published var user: SessionUser?
    @Published var isDemo = false
    @Published var isRestoring = true
    @Published var isSigningIn = false
    @Published var authMessage: UserMessage?
    @Published var jobs: [Job] = []
    @Published var events: [ScheduleEvent] = []
    @Published var mailboxes: [Mailbox] = []
    @Published var histories: [String: [HistoryEntry]] = [:]
    @Published private(set) var historyMutations: Set<String> = []
    @Published var jobsLoading = false
    @Published var scheduleLoading = false
    @Published var mailLoading = false
    @Published var jobsError: UserMessage?
    @Published var scheduleError: UserMessage?
    @Published var mailError: UserMessage?
    let api: APIClient
    private var generation = UUID()
    private var jobsRequest = UUID()
    private var scheduleRequest = UUID()
    private var detailRequests: [String: UUID] = [:]
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
        histories = Dictionary(uniqueKeysWithValues: jobs.map { job in
            (job.id, [HistoryEntry(id: "initial-\(job.id)", status: job.status, date: job.dateApplied, notes: "演示状态记录",
                                  scheduledTime: job.id == "demo-1" ? events[0].time : nil,
                                  deadline: job.id == "demo-2" ? events[1].time : nil)])
        })
        histories["demo-1", default: []].append(HistoryEntry(id: "unscheduled-demo-1", status: .interviewing,
                                                           date: .now.addingTimeInterval(-86400), statusApplied: false))
        rebuildDemoSchedule()
    }
    func signOut() async {
        generation = UUID()
        do { try await api.signOut(); authMessage = nil } catch { authMessage = message(error) }
        user = nil; isDemo = false; jobs = []; events = []; mailboxes = []
        histories = [:]; historyMutations = []; detailRequests = [:]
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
        let request = UUID(); jobsRequest = request
        jobsLoading = true; jobsError = nil
        defer { if current == generation && request == jobsRequest { jobsLoading = false } }
        do { let response: JobsResponse = try await api.get("api/jobs"); if current == generation && request == jobsRequest { jobs = response.jobs } }
        catch { if current == generation && request == jobsRequest { jobsError = await handle(error) } }
    }
    func refreshSchedule(force: Bool = false) async {
        guard !isDemo, user != nil, force || !scheduleLoading else { return }
        let current = generation
        let request = UUID(); scheduleRequest = request
        scheduleLoading = true; scheduleError = nil
        defer { if current == generation && request == scheduleRequest { scheduleLoading = false } }
        do {
            let response: ScheduleResponse = try await api.get("api/schedule")
            if current == generation && request == scheduleRequest { events = response.events.sorted { ($0.time ?? .distantFuture) < ($1.time ?? .distantFuture) } }
        } catch { if current == generation && request == scheduleRequest { scheduleError = await handle(error) } }
    }
    func refreshMail() async {
        guard !isDemo, user != nil, !mailLoading else { return }
        let current = generation
        mailLoading = true; mailError = nil
        defer { if current == generation { mailLoading = false } }
        do { let response: MailboxesResponse = try await api.get("api/mail/accounts"); if current == generation { mailboxes = response.accounts } }
        catch { if current == generation { mailError = await handle(error) } }
    }
    func refreshDetail(jobID: String) async throws {
        guard !isDemo else { return }
        let current = generation, request = UUID()
        detailRequests[jobID] = request
        do {
            let job: JobResponse = try await api.get("api/jobs/\(jobID)")
            let response: HistoryResponse = try await api.get("api/jobs/\(jobID)/status-history")
            guard current == generation, detailRequests[jobID] == request else { throw CancellationError() }
            applyJob(job.job)
            histories[jobID] = response.statusHistory.sorted(by: HistoryEntry.newestFirst)
        } catch {
            guard current == generation, detailRequests[jobID] == request else { throw CancellationError() }
            if error as? APIError == .unauthorized { await expire() }
            if error as? APIError == .notFound {
                jobs.removeAll { $0.id == jobID }; histories[jobID] = nil
                events.removeAll { $0.jobId == jobID }
            }
            throw error
        }
    }
    func saveHistory(_ draft: HistoryDraft, jobID: String, entryID: String? = nil) async throws {
        guard user != nil else { throw APIError.unauthorized }
        guard draft.validationMessage == nil else { throw APIError.invalidInput }
        guard !historyMutations.contains(jobID) else { throw APIError.conflict }
        let current = generation
        historyMutations.insert(jobID)
        defer { if current == generation { historyMutations.remove(jobID) } }
        do {
            if isDemo {
                guard jobs.contains(where: { $0.id == jobID }) else { throw APIError.notFound }
                let old = histories[jobID]?.first { $0.id == entryID }
                if entryID != nil && old == nil { throw APIError.notFound }
                let d = draft.normalized
                var entry = old ?? HistoryEntry(id: UUID().uuidString, status: d.status, date: d.date, createdAt: .now, statusApplied: true)
                entry.status = d.status; entry.date = d.date; entry.notes = d.notes; entry.interviewStage = d.interviewStage
                replaceHistory(entry, jobID: jobID); recomputeDemo(jobID: jobID)
            } else {
                let response = try await api.saveHistory(draft, jobID: jobID, entryID: entryID)
                guard current == generation else { throw CancellationError() }
                detailRequests[jobID] = nil
                applyJob(response.job)
                if let entry = response.statusHistory { replaceHistory(entry, jobID: jobID) }
                await refreshSchedule(force: true)
            }
        } catch {
            if current == generation && error as? APIError == .unauthorized { await expire() }
            throw error
        }
    }
    func saveSchedule(_ draft: ScheduleDraft, jobID: String, entryID: String) async throws {
        guard user != nil else { throw APIError.unauthorized }
        guard draft.isValid else { throw APIError.invalidInput }
        guard !historyMutations.contains(jobID) else { throw APIError.conflict }
        let current = generation
        historyMutations.insert(jobID)
        defer { if current == generation { historyMutations.remove(jobID) } }
        do {
            if isDemo {
                guard var entry = histories[jobID]?.first(where: { $0.id == entryID }) else { throw APIError.notFound }
                if draft.kind == .appointment { entry.scheduledTime = draft.time } else { entry.deadline = draft.time }
                replaceHistory(entry, jobID: jobID); rebuildDemoSchedule()
            } else {
                let response = try await api.saveSchedule(draft, jobID: jobID, entryID: entryID)
                guard current == generation else { throw CancellationError() }
                detailRequests[jobID] = nil
                applyJob(response.job)
                if let entry = response.statusHistory {
                    replaceHistory(entry, jobID: jobID)
                    // Apply the confirmed response even if the subsequent list refresh is offline.
                    events.removeAll { $0.historyId == entryID && $0.jobId == jobID }
                    events += ScheduleEvent.project(entry, job: response.job)
                }
                await refreshSchedule(force: true)
            }
        } catch {
            if current == generation && error as? APIError == .unauthorized { await expire() }
            throw error
        }
    }
    func deleteHistory(jobID: String, entryID: String) async throws {
        guard user != nil else { throw APIError.unauthorized }
        guard !historyMutations.contains(jobID) else { throw APIError.conflict }
        let current = generation
        historyMutations.insert(jobID)
        defer { if current == generation { historyMutations.remove(jobID) } }
        do {
            if isDemo {
                guard histories[jobID]?.contains(where: { $0.id == entryID }) == true else { throw APIError.notFound }
            } else {
                let response = try await api.deleteHistory(jobID: jobID, entryID: entryID)
                guard current == generation else { throw CancellationError() }
                detailRequests[jobID] = nil; applyJob(response.job)
            }
            histories[jobID]?.removeAll { $0.id == entryID }
            if isDemo { recomputeDemo(jobID: jobID) } else { await refreshSchedule(force: true) }
        } catch {
            if current == generation && error as? APIError == .unauthorized { await expire() }
            throw error
        }
    }
    private func applyJob(_ job: Job) {
        // An earlier list request must never overwrite a confirmed mutation.
        jobsRequest = UUID(); jobsLoading = false; jobsError = nil
        if let index = jobs.firstIndex(where: { $0.id == job.id }) { jobs[index] = job } else { jobs.insert(job, at: 0) }
    }
    private func replaceHistory(_ entry: HistoryEntry, jobID: String) {
        histories[jobID, default: []].removeAll { $0.id == entry.id }
        histories[jobID, default: []].append(entry)
        histories[jobID]?.sort(by: HistoryEntry.newestFirst)
    }
    private func recomputeDemo(jobID: String) {
        if let index = jobs.firstIndex(where: { $0.id == jobID }) {
            jobs[index].status = histories[jobID]?.sorted(by: HistoryEntry.newestFirst).first(where: \.affectsCurrentStatus)?.status ?? .applied
        }
        rebuildDemoSchedule()
    }
    private func rebuildDemoSchedule() {
        events = jobs.flatMap { job in
            (histories[job.id] ?? []).flatMap { ScheduleEvent.project($0, job: job) }
        }
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
        detailRequests[job.id] = nil
        applyJob(job)
        if isDemo && id == nil {
            histories[job.id] = [HistoryEntry(id: UUID().uuidString, status: .applied, date: job.dateApplied, createdAt: .now, statusApplied: true)]
        }
        if isDemo {
            events = events.map { event in
                guard event.jobId == job.id else { return event }
                return ScheduleEvent(historyId: event.historyId, id: event.id, jobId: job.id, company: job.company, position: job.position, kind: event.kind, time: event.time, label: event.label)
            }
        } else { await refreshSchedule() }
    }
    private func expire() async { await signOut(); authMessage = APIError.unauthorized.userMessage }
    private func handle(_ error: Error) async -> UserMessage? {
        if error as? APIError == .unauthorized { await expire(); return nil }
        if error is CancellationError { return nil }
        return message(error)
    }
    func message(_ error: Error) -> UserMessage {
        if let apiError = error as? APIError { return apiError.userMessage }
        if let urlError = error as? URLError, [.notConnectedToInternet, .timedOut, .cannotConnectToHost, .networkConnectionLost].contains(urlError.code) { return .text("网络连接失败，请检查网络后重试。") }
        return .text("暂时无法完成操作，请重试。")
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
