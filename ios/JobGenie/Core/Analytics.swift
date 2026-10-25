import Foundation

struct AnalyticsRange: Equatable {
    var start: Date
    var end: Date
    var timeZone: TimeZone
    init(now: Date = .now, days: Int = 30, timeZone: TimeZone = .current) {
        self.timeZone = timeZone
        var calendar = Calendar(identifier: .gregorian); calendar.timeZone = timeZone
        end = calendar.startOfDay(for: now)
        start = calendar.date(byAdding: .day, value: 1 - days, to: end)!
    }
    func day(_ date: Date) -> String {
        let format = DateFormatter(); format.calendar = Calendar(identifier: .gregorian)
        format.locale = Locale(identifier: "en_US_POSIX"); format.timeZone = timeZone; format.dateFormat = "yyyy-MM-dd"
        return format.string(from: date)
    }
    func isValid(now: Date = .now) -> Bool {
        var calendar = Calendar(identifier: .gregorian); calendar.timeZone = timeZone
        let days = calendar.dateComponents([.day], from: calendar.startOfDay(for: start), to: calendar.startOfDay(for: end)).day ?? -1
        return days >= 0 && days < 366 && day(end) <= day(now) && day(start) >= "1970-01-01"
    }
    var query: [URLQueryItem] { [URLQueryItem(name: "start", value: day(start)), URLQueryItem(name: "end", value: day(end)), URLQueryItem(name: "timeZone", value: timeZone.identifier)] }
}
struct AnalyticsResponse: Decodable {
    struct Range: Decodable { let start: String; let end: String; let timeZone: String; let observedThrough: Date }
    struct Current: Decodable { let total: Int; let counts: [String: Int]; let asOf: Date }
    struct Rate: Decodable {
        let numerator: Int; let denominator: Int; let percent: Double?
        var fraction: Double? { guard denominator > 0 else { return nil }; return Double(numerator) / Double(denominator) }
    }
    struct Conversion: Decodable { let appliedToInterview: Rate; let interviewToOffer: Rate; let appliedToOffer: Rate }
    struct Cohort: Decodable { let total: Int; let reached: [String: Int]; let offersWithoutPriorInterview: Int; let withoutHistory: Int; let conversion: Conversion }
    let range: Range
    let currentStatus: Current
    let cohort: Cohort

    // Demo follows the server's cohort definition; it never infers an interview from an Offer.
    static func demo(jobs: [Job], histories: [String: [HistoryEntry]], range: AnalyticsRange, now: Date = .now) -> Self {
        var cal = Calendar(identifier: .gregorian); cal.timeZone = range.timeZone
        let start = cal.startOfDay(for: range.start)
        let end = min(cal.date(byAdding: .day, value: 1, to: cal.startOfDay(for: range.end))!, now.addingTimeInterval(0.001))
        let cohort = jobs.filter { $0.dateApplied >= start && $0.dateApplied < end }
        var reached = Dictionary(uniqueKeysWithValues: ApplicationStatus.allCases.map { ($0.rawValue, 0) })
        reached["applied"] = cohort.count
        var converted = 0, direct = 0, empty = 0
        for job in cohort {
            let entries = (histories[job.id] ?? []).filter { $0.date >= job.dateApplied && $0.date >= start && $0.date < end }
            let interview = entries.filter { $0.status == .interviewing }.map(\.date).min()
            let offers = entries.filter { $0.status == .offer }
            if interview != nil { reached["interviewing", default: 0] += 1 }
            if !offers.isEmpty { reached["offer", default: 0] += 1 }
            if entries.contains(where: { $0.status == .rejected }) { reached["rejected", default: 0] += 1 }
            if let interview, offers.contains(where: { $0.date >= interview }) { converted += 1 }
            else if !offers.isEmpty { direct += 1 }
            if entries.isEmpty { empty += 1 }
        }
        func rate(_ n: Int, _ d: Int) -> Rate { Rate(numerator: n, denominator: d, percent: d == 0 ? nil : Double(n) / Double(d) * 100) }
        return Self(range: Range(start: range.day(range.start), end: range.day(range.end), timeZone: range.timeZone.identifier, observedThrough: min(now, end.addingTimeInterval(-0.001))),
                    currentStatus: Current(total: jobs.count, counts: Dictionary(uniqueKeysWithValues: ApplicationStatus.allCases.map { status in (status.rawValue, jobs.filter { $0.status == status }.count) }), asOf: now),
                    cohort: Cohort(total: cohort.count, reached: reached, offersWithoutPriorInterview: direct, withoutHistory: empty,
                                   conversion: Conversion(appliedToInterview: rate(reached["interviewing"]!, cohort.count), interviewToOffer: rate(converted, reached["interviewing"]!), appliedToOffer: rate(reached["offer"]!, cohort.count))))
    }
}
extension AppModel {
    func loadAnalytics(_ range: AnalyticsRange) async throws {
        guard user != nil, range.isValid() else { throw APIError.invalidInput }
        let current = sessionGeneration, request = UUID(); analyticsRequest = request; analytics = nil
        do {
            let value: AnalyticsResponse
            if isDemo { value = .demo(jobs: jobs, histories: histories, range: range) }
            else { value = try JSONDecoder.jobGenie.decode(AnalyticsResponse.self, from: await api.send("api/stats", query: range.query)) }
            guard current == sessionGeneration, request == analyticsRequest else { throw CancellationError() }
            analytics = value
        } catch {
            guard current == sessionGeneration, request == analyticsRequest else { throw CancellationError() }
            if error as? APIError == .unauthorized { await signOut(); authMessage = APIError.unauthorized.userMessage }
            throw error
        }
    }
}
