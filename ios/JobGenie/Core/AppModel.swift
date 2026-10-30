import SwiftUI

@MainActor
final class AppModel: ObservableObject {
    @Published var user: SessionUser?
    @Published var isDemo = false
    @Published var isRestoring = true
    @Published var isSigningIn = false
    @Published var authMessage: UserMessage?
    @Published var jobs: [Job] = []
    @Published private(set) var bulkBusy = false
    @Published var events: [ScheduleEvent] = []
    @Published var mailboxes: [Mailbox] = []
    @Published var pendingMail: [PendingMail] = []
    @Published private(set) var mailBusy = false
    @Published var mailNotice: UserMessage?
    @Published var reminders: [ReminderItem] = []
    @Published var reminderSettings: ReminderSettings?
    @Published private(set) var remindersLoading = false
    @Published private(set) var remindersBusy = false
    @Published var remindersError: UserMessage?
    @Published var remindersNotice: UserMessage?
    private var remindersStarted = false
    private var reminderRequest = UUID()
    private var reminderServerTime = Date.now
    private var reminderUptime = ProcessInfo.processInfo.systemUptime
    private var demoReminderTimes: [String: Date] = [:]
    private var demoReminderRevisions: [String: Int] = [:]
    private var demoReminderStates: [String: (ReminderStatus, Date?)] = [:]
    var reminderNow: Date { reminderServerTime.addingTimeInterval(max(0, ProcessInfo.processInfo.systemUptime - reminderUptime)) }
    var visibleReminders: [ReminderItem] { reminders.filter { $0.time > reminderNow } }
    var reminderUnreadCount: Int { visibleReminders.filter { $0.status == .unread }.count }
    private var mailRequest = UUID()
    @Published var histories: [String: [HistoryEntry]] = [:]
    @Published private(set) var historyMutations: Set<String> = []
    @Published var jobsLoading = false
    @Published var scheduleLoading = false
    @Published var mailLoading = false
    @Published var jobsError: UserMessage?
    @Published var scheduleError: UserMessage?
    @Published var mailError: UserMessage?
    @Published var analytics: AnalyticsResponse?
    @Published var attachments: [Attachment] = []
    @Published var attachmentNotice: UserMessage?
    @Published var attachmentBusy = false
    var analyticsRequest = UUID()
    var attachmentsRequest = UUID()
    let attachmentCache = AttachmentCache()
    var demoAttachmentData: [String: Data] = [:]
    let api: APIClient
    private var generation = UUID()
    var sessionGeneration: UUID { generation }
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
        do { user = try await api.signIn(email: email, password: password, remember: remember); generation = UUID(); resetResources(); resetReminders() }
        catch { authMessage = message(error) }
    }
    func useDemo() {
        do { try api.clearLocalSession() }
        catch { authMessage = message(error); return }
        generation = UUID(); resetResources(); resetReminders(); isDemo = true; authMessage = nil
        user = SessionUser(id: "demo", name: "探索者", email: "demo@example.com")
        jobs = DemoData.jobs; events = DemoData.events; mailboxes = DemoData.mailboxes
        histories = Dictionary(uniqueKeysWithValues: jobs.map { job in
            (job.id, [HistoryEntry(id: "initial-\(job.id)", status: job.status, date: job.dateApplied, notes: "演示状态记录",
                                  scheduledTime: job.id == "demo-1" ? events[0].time : nil,
                                  deadline: job.id == "demo-2" ? events[1].time : nil)])
        })
        histories["demo-1", default: []].append(HistoryEntry(id: "unscheduled-demo-1", status: .interviewing,
                                                           date: .now.addingTimeInterval(-86400), statusApplied: false))
        pendingMail = [PendingMail(id: "demo-review", subject: "Northstar interview invitation", from: "recruiting@example.com", snippet: "Please confirm your interview time.", company: "Northstar", position: "iOS 工程师", eventType: "interview", confidence: 0.85, targetJobId: "demo-1")]
        mailboxes[0].backlog = MailBacklog(pending: 0, processing: 0, failed: 1, pendingReview: 1)
        mailboxes[0].failures = [MailFailure(id: "demo-failure", subject: "Demo email", attempts: 1)]
        rebuildDemoSchedule()
    }
    func signOut() async {
        generation = UUID()
        resetResources()
        resetReminders()
        do { try await api.signOut(); authMessage = nil } catch { authMessage = message(error) }
        user = nil; isDemo = false; bulkBusy = false; jobs = []; events = []; mailboxes = []
        histories = [:]; historyMutations = []; detailRequests = [:]
        pendingMail = []; mailBusy = false; mailNotice = nil; mailRequest = UUID()
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
        do { let response = try await api.allJobs(); if current == generation && request == jobsRequest { jobs = response.jobs } }
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
        if current == generation && remindersStarted { await refreshReminders(force: true) }
    }
    private func resetReminders() {
        reminderRequest = UUID(); remindersStarted = false
        reminders = []; reminderSettings = nil; remindersLoading = false; remindersBusy = false
        remindersError = nil; remindersNotice = nil
        demoReminderTimes = [:]; demoReminderRevisions = [:]; demoReminderStates = [:]
    }
    func refreshReminders(force: Bool = false) async {
        guard user != nil, force || (!remindersLoading && !remindersBusy) else { return }
        remindersStarted = true
        if isDemo { rebuildDemoReminders(); return }
        let current = generation, request = UUID(); reminderRequest = request
        remindersLoading = true; remindersError = nil
        defer { if current == generation && request == reminderRequest { remindersLoading = false } }
        do {
            let response: RemindersResponse = try await api.get("api/reminders")
            guard current == generation && request == reminderRequest else { return }
            guard response.settings.isValid else { throw APIError.invalidResponse }
            reminderServerTime = response.serverTime; reminderUptime = ProcessInfo.processInfo.systemUptime
            reminders = response.reminders.sorted { $0.time == $1.time ? $0.id < $1.id : $0.time < $1.time }
            reminderSettings = response.settings
        } catch { if current == generation && request == reminderRequest { remindersError = await handle(error) } }
    }
    private func invalidateReminders(jobID: String? = nil, historyID: String? = nil) {
        reminderRequest = UUID(); remindersLoading = false
        reminders.removeAll { (jobID != nil && $0.jobId == jobID) || (historyID != nil && $0.historyId == historyID) }
    }
    func actOnReminder(_ item: ReminderItem, action: ReminderAction) async throws {
        guard user != nil else { throw APIError.unauthorized }
        guard !remindersBusy else { throw APIError.conflict }
        let current = generation
        remindersBusy = true; remindersNotice = nil; remindersError = nil
        reminderRequest = UUID(); remindersLoading = false
        defer { if current == generation { remindersBusy = false } }
        do {
            if isDemo {
                rebuildDemoReminders()
                guard let live = reminders.first(where: { $0.id == item.id }) else { throw APIError.conflict }
                if action == .snooze {
                    guard live.status == .unread || live.status == .snoozed else { throw APIError.conflict }
                    guard live.time > Date.now.addingTimeInterval(600) else { throw APIError.invalidInput }
                    if live.status != .snoozed { demoReminderStates[live.id] = (.snoozed, .now.addingTimeInterval(600)) }
                } else if live.status != .cancelled {
                    demoReminderStates[live.id] = (action == .cancel ? .cancelled : .read, nil)
                }
                rebuildDemoReminders()
            } else {
                try await api.actOnReminder(item, action: action)
                guard current == generation else { throw CancellationError() }
                // A successful idempotent response may refer to an already cancelled
                // item. Remove the stale copy; only GET supplies the canonical state.
                reminderRequest = UUID(); remindersLoading = false
                reminders.removeAll { $0.id == item.id }
                remindersNotice = .text("操作已保存，正在刷新提醒。")
                await refreshReminders(force: true)
                guard current == generation else { throw CancellationError() }
                remindersNotice = remindersError == nil ? nil : .text("操作已保存，提醒列表暂未刷新，请重试刷新。")
            }
        } catch {
            if current == generation {
                if error as? APIError == .unauthorized { await expire() }
                else if error as? APIError == .conflict || error as? APIError == .notFound {
                    invalidateReminders(historyID: item.historyId)
                    await refreshReminders(force: true)
                }
            }
            throw error
        }
    }
    func saveReminderSettings(_ settings: ReminderSettings) async throws {
        guard user != nil else { throw APIError.unauthorized }
        guard !remindersBusy else { throw APIError.conflict }
        guard settings.isValid else { throw APIError.invalidInput }
        let current = generation
        remindersBusy = true; remindersNotice = nil
        reminderRequest = UUID(); remindersLoading = false
        defer { if current == generation { remindersBusy = false } }
        do {
            let confirmed = isDemo ? settings : try await api.saveReminderSettings(settings)
            guard current == generation else { throw CancellationError() }
            reminderSettings = confirmed
            reminders = []
            await refreshReminders(force: true)
            guard current == generation else { throw CancellationError() }
            if remindersError != nil { remindersNotice = .text("设置已保存，提醒列表暂未刷新，请重试刷新。") }
        } catch {
            if current == generation && error as? APIError == .unauthorized { await expire() }
            throw error
        }
    }
    private func rebuildDemoReminders(now: Date = .now) {
        guard isDemo else { return }
        let settings = reminderSettings ?? ReminderSettings(); reminderSettings = settings
        reminderServerTime = now; reminderUptime = ProcessInfo.processInfo.systemUptime
        // Archiving hides reminders without changing the occurrence identity.
        let archivedEvents = jobs.filter { $0.archivedAt != nil }.flatMap { job in
            var active = job; active.archivedAt = nil
            return (histories[job.id] ?? []).flatMap { ScheduleEvent.project($0, job: active) }
        }
        let currentTimes = Dictionary(uniqueKeysWithValues: (events + archivedEvents).compactMap { event in event.time.map { (event.id, $0) } })
        for id in Set(demoReminderTimes.keys).union(currentTimes.keys) where demoReminderTimes[id] != currentTimes[id] {
            if demoReminderTimes[id] != nil || demoReminderRevisions[id] != nil { demoReminderRevisions[id, default: 0] += 1 }
            else { demoReminderRevisions[id] = 0 }
        }
        demoReminderTimes = currentTimes
        reminders = events.compactMap { event in
            guard settings.enabled, let time = event.time, let historyID = event.historyId,
                  let job = jobs.first(where: { $0.id == event.jobId }), job.status != .offer, job.status != .rejected,
                  now >= time.addingTimeInterval(-Double(settings.leadMinutes) * 60), now < time else { return nil }
            let revision = demoReminderRevisions[event.id, default: 0], id = "\(event.id):\(revision)"
            let saved = demoReminderStates[id]
            let status: ReminderStatus = saved?.0 == .snoozed && (saved?.1 ?? .distantPast) <= now ? .unread : saved?.0 ?? .unread
            return ReminderItem(id: id, historyId: historyID, jobId: event.jobId, kind: event.kind, revision: revision,
                                company: event.company, position: event.position, label: event.label, time: time,
                                dueAt: time.addingTimeInterval(-Double(settings.leadMinutes) * 60), status: status,
                                snoozedUntil: status == .snoozed ? saved?.1 : nil, canSnooze: now.addingTimeInterval(600) < time)
        }.sorted { $0.time < $1.time }
    }
    func refreshMail(force: Bool = false) async {
        guard !isDemo, user != nil, force || !mailLoading else { return }
        let current = generation, request = UUID(); mailRequest = request
        mailLoading = true; mailError = nil
        defer { if current == generation && request == mailRequest { mailLoading = false } }
        do {
            async let accounts: MailboxesResponse = api.get("api/mail/status")
            async let pending: PendingResponse = api.get("api/pending")
            let result = try await (accounts, pending)
            guard current == generation, request == mailRequest else { return }
            mailboxes = result.0.accounts; pendingMail = result.1.items
        } catch { if current == generation && request == mailRequest { mailError = await handle(error) } }
    }
    func runMail(accountID: String, retry: Bool) async {
        guard !mailBusy, user != nil else { return }
        let current = generation
        mailBusy = true; mailNotice = nil; mailError = nil
        defer { if current == generation { mailBusy = false } }
        do {
            if isDemo {
                if let i = mailboxes.firstIndex(where: { $0.id == accountID }) {
                    mailboxes[i].lastSync = MailRun(totalFetched: retry ? 0 : 3, processed: 1, failed: 0, pendingReview: 1, errorCount: 0, hasMore: false, finishedAt: .now)
                    mailboxes[i].backlog = MailBacklog(pending: 0, processing: 0, failed: 0, pendingReview: pendingMail.count)
                    mailboxes[i].failures = []
                }
            } else {
                let result = try await api.syncMail(accountID: accountID, retry: retry)
                guard current == generation else { return }
                mailNotice = .text(result.accounts.contains { $0.errorCount > 0 } ? "同步已结束，部分环节失败，请查看结果。" : "同步已完成，请查看结果。")
                mailRequest = UUID(); mailLoading = false
                for summary in result.accounts {
                    if let index = mailboxes.firstIndex(where: { $0.id == summary.accountId }) {
                        mailboxes[index].lastSync = MailRun(totalFetched: summary.totalFetched, processed: summary.processed,
                            failed: summary.failed, pendingReview: summary.pendingReview, errorCount: summary.errorCount, finishedAt: .now)
                    }
                }
                await refreshMail(force: true)
                guard current == generation else { return }
                jobsRequest = UUID(); jobsLoading = false
                await refreshJobs()
                guard current == generation else { return }
                await refreshSchedule(force: true)
            }
        } catch {
            if current == generation {
                mailError = await handle(error)
                if user != nil { mailNotice = .text("请求未能确认完成，请先刷新结果；已入库邮件不会重复创建申请。") }
            }
        }
    }
    func reviewMail(_ item: PendingMail, draft: MailReviewDraft, ignore: Bool) async throws {
        guard user != nil else { throw APIError.unauthorized }
        guard !mailBusy else { throw APIError.conflict }
        guard ignore || draft.isValid else { throw APIError.invalidInput }
        let current = generation
        mailBusy = true; mailNotice = nil
        defer { if current == generation { mailBusy = false } }
        do {
            if isDemo {
                guard pendingMail.contains(where: { $0.id == item.id }) else { throw APIError.conflict }
                if !ignore {
                    let jobID: String
                    if draft.target == "new" {
                        var job = JobDraft(); job.company = draft.company; job.position = draft.position
                        try await save(job, id: nil); jobID = jobs[0].id
                    } else { jobID = draft.target }
                    var entry = HistoryDraft(status: MailEventType(rawValue: draft.eventType)!.status)
                    entry.notes = item.subject ?? ""; entry.interviewStage = draft.eventType == "oa" ? "Online Assessment" : ""
                    try await saveHistory(entry, jobID: jobID)
                    if let entryID = histories[jobID]?.first?.id {
                        try await saveSchedule(ScheduleDraft(kind: .appointment, time: draft.interviewTime), jobID: jobID, entryID: entryID)
                        try await saveSchedule(ScheduleDraft(kind: .deadline, time: draft.deadline), jobID: jobID, entryID: entryID)
                    }
                }
                pendingMail.removeAll { $0.id == item.id }
                for index in mailboxes.indices { mailboxes[index].backlog?.pendingReview = pendingMail.count }
            } else {
                let result = try await api.reviewMail(id: item.id, draft: draft, ignore: ignore)
                guard current == generation else { throw CancellationError() }
                mailRequest = UUID(); mailLoading = false
                pendingMail.removeAll { $0.id == item.id }
                if result.statusApplied == false { mailNotice = .text("已确认并保留历史；较旧邮件未覆盖当前申请状态。") }
                jobsRequest = UUID(); jobsLoading = false
                await refreshJobs()
                guard current == generation else { throw CancellationError() }
                if let id = result.jobId { try? await refreshDetail(jobID: id) }
                guard current == generation else { throw CancellationError() }
                await refreshSchedule(force: true)
                guard current == generation else { throw CancellationError() }
                await refreshMail(force: true)
            }
        } catch {
            if current == generation && error as? APIError == .unauthorized { await expire() }
            throw error
        }
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
                invalidateReminders(jobID: jobID)
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
                invalidateReminders(jobID: jobID)
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
                invalidateReminders(historyID: entryID)
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
            invalidateReminders(historyID: entryID)
            if isDemo { recomputeDemo(jobID: jobID) } else { await refreshSchedule(force: true) }
        } catch {
            if current == generation && error as? APIError == .unauthorized { await expire() }
            throw error
        }
    }
    private func applyJob(_ job: Job) {
        if job.archivedAt != nil || job.status == .offer || job.status == .rejected { invalidateReminders(jobID: job.id) }
        for index in reminders.indices where reminders[index].jobId == job.id {
            reminders[index].company = job.company; reminders[index].position = job.position
        }
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
        rebuildDemoReminders()
    }
    func save(_ draft: JobDraft, id: String?) async throws {
        let current = generation
        let job: Job
        if isDemo {
            let d = draft.normalized
            let old = jobs.first { $0.id == id }
            job = Job(id: id ?? UUID().uuidString, company: d.company, position: d.position, location: d.location, notes: d.notes, jobUrl: d.jobUrl,
                      status: old?.status ?? .applied, dateApplied: old?.dateApplied ?? .now, archivedAt: old?.archivedAt)
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
            rebuildDemoReminders()
        } else { await refreshSchedule() }
    }
    func performBulk(ids: Set<String>, action: String, status: ApplicationStatus? = nil, pending: Bool = false) async throws -> BulkResponse {
        guard user != nil else { throw APIError.unauthorized }
        guard !bulkBusy, !mailBusy, historyMutations.isEmpty else { throw APIError.conflict }
        guard !ids.isEmpty, ids.count <= 50,
              (pending ? ["accept", "ignore"] : ["archive", "restore", "status"]).contains(action),
              action != "status" || status != nil else { throw APIError.invalidInput }
        let current = generation
        bulkBusy = true
        defer { if current == generation { bulkBusy = false } }
        do {
            let response: BulkResponse
            if isDemo {
                var results: [BulkItemResult] = []
                for id in ids.sorted() {
                    do {
                        if pending {
                            guard let item = pendingMail.first(where: { $0.id == id }) else { throw APIError.conflict }
                            try await reviewMail(item, draft: MailReviewDraft(item), ignore: action == "ignore")
                            results.append(BulkItemResult(id: id, success: true))
                        } else {
                            guard let index = jobs.firstIndex(where: { $0.id == id }) else { throw APIError.conflict }
                            if action == "status", let status, jobs[index].status != status {
                                if let latest = histories[id]?.filter(\.affectsCurrentStatus).sorted(by: HistoryEntry.newestFirst).first,
                                   latest.date > .now { throw APIError.conflict }
                                try await saveHistory(HistoryDraft(status: status), jobID: id)
                            } else if action != "status" {
                                jobs[index].archivedAt = action == "archive" ? (jobs[index].archivedAt ?? .now) : nil
                            }
                            results.append(BulkItemResult(id: id, success: true, job: jobs.first { $0.id == id }))
                        }
                    } catch { results.append(BulkItemResult(id: id, success: false, status: 409)) }
                    guard current == generation else { throw CancellationError() }
                }
                rebuildDemoSchedule()
                response = BulkResponse(results: results)
            } else {
                if pending { mailBusy = true }
                defer { if current == generation && pending { mailBusy = false } }
                response = try await api.bulk(ids: ids, action: action, status: status, pending: pending)
                guard current == generation else { throw CancellationError() }
                for result in response.results where result.success {
                    if let job = result.job { applyJob(job); histories[job.id] = nil; detailRequests[job.id] = nil }
                    if let id = result.jobId { histories[id] = nil; detailRequests[id] = nil }
                }
                if pending {
                    let completed = Set(response.results.filter(\.success).map(\.id))
                    pendingMail.removeAll { completed.contains($0.id) }
                    mailRequest = UUID(); mailLoading = false
                    jobsRequest = UUID(); jobsLoading = false
                    await refreshJobs()
                    guard current == generation else { throw CancellationError() }
                    await refreshMail(force: true)
                }
                guard current == generation else { throw CancellationError() }
                await refreshSchedule(force: true)
            }
            guard current == generation else { throw CancellationError() }
            analytics = nil
            return response
        } catch {
            if current == generation && error as? APIError == .unauthorized { await expire() }
            throw error
        }
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
        ScheduleEvent(id: "event-1", jobId: "demo-1", company: "Northstar", position: "iOS 工程师", kind: "appointment", time: .now.addingTimeInterval(1800), label: "Interview"),
        ScheduleEvent(id: "event-2", jobId: "demo-2", company: "Linear Labs", position: "产品工程师", kind: "deadline", time: .now.addingTimeInterval(-86400), label: "Assessment deadline"),
        ScheduleEvent(id: "event-3", jobId: "demo-1", company: "Northstar", position: "iOS 工程师", kind: "appointment", time: nil, label: "Interview"),
    ] }
    static let mailboxes = [Mailbox(id: "demo-mail", provider: "gmail", emailAddress: "demo@example.com")]
}
