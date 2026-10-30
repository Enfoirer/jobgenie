import Foundation

struct BulkItemResult: Decodable, Identifiable {
    let id: String
    let success: Bool
    var job: Job? = nil
    var status: Int? = nil
    var error: String? = nil
    var jobId: String? = nil
    var statusApplied: Bool? = nil
}
struct BulkResponse: Decodable {
    let total: Int
    let succeeded: Int
    let failed: Int
    let results: [BulkItemResult]
    init(results: [BulkItemResult]) {
        self.results = results; total = results.count
        succeeded = results.filter(\.success).count; failed = total - succeeded
    }
    func validate(ids: Set<String>, pending: Bool) throws {
        guard total == ids.count, results.count == ids.count, Set(results.map(\.id)) == ids,
              succeeded == results.filter(\.success).count, failed == total - succeeded,
              pending || results.allSatisfy({ !$0.success || $0.job?.id == $0.id }) else { throw APIError.invalidResponse }
    }
}
extension APIClient {
    func allJobs() async throws -> JobsResponse {
        let data = try await send("api/jobs", query: [URLQueryItem(name: "includeArchived", value: "true")])
        return try JSONDecoder.jobGenie.decode(JobsResponse.self, from: data)
    }
    func bulk(ids: Set<String>, action: String, status: ApplicationStatus?, pending: Bool) async throws -> BulkResponse {
        struct Body: Encodable { let ids: [String]; let action: String; let status: ApplicationStatus? }
        let data = try await send(pending ? "api/pending/bulk" : "api/jobs/bulk", method: "POST",
                                  body: JSONEncoder().encode(Body(ids: ids.sorted(), action: action, status: status)))
        let response = try JSONDecoder.jobGenie.decode(BulkResponse.self, from: data)
        try response.validate(ids: ids, pending: pending)
        return response
    }
}
