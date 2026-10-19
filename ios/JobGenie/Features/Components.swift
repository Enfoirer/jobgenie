import SwiftUI

enum Brand {
    static let teal = Color(red: 0.05, green: 0.44, blue: 0.39)
    static let background = Color(uiColor: .systemGroupedBackground)
}
extension ApplicationStatus {
    var color: Color { switch self { case .applied: .blue; case .interviewing: .orange; case .offer: Brand.teal; case .rejected: .secondary } }
}
struct StatusBadge: View {
    let status: ApplicationStatus
    var body: some View {
        Label(LocalizedStringKey(status.title), systemImage: status.symbol).font(.caption.weight(.medium)).foregroundStyle(status.color)
            .padding(.horizontal, 9).padding(.vertical, 6).background(status.color.opacity(0.1), in: Capsule())
    }
}
struct ErrorBanner: View {
    @Environment(\.locale) private var locale
    let message: UserMessage
    var retry: (() -> Void)? = nil
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label(message.localized(locale: locale), systemImage: "exclamationmark.circle").font(.subheadline).foregroundStyle(.red)
            if let retry { Button("重试", action: retry).font(.subheadline.bold()) }
        }.accessibilityElement(children: .contain)
    }
}
struct CompanyMark: View {
    let company: String
    var body: some View {
        Text(String(company.prefix(1)).uppercased()).font(.title3.bold()).foregroundStyle(Brand.teal)
            .frame(width: 46, height: 46).background(Brand.teal.opacity(0.1), in: RoundedRectangle(cornerRadius: 14))
            .accessibilityHidden(true)
    }
}

struct DemoNotice: View {
    @EnvironmentObject private var model: AppModel
    var body: some View {
        if model.isDemo {
            Section {
                Label("演示模式 · 示例数据，退出后重置", systemImage: "sparkles")
                    .font(.caption).foregroundStyle(Brand.teal)
            }
        }
    }
}
