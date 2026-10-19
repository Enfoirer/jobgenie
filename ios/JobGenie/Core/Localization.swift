import SwiftUI

enum AppLanguage: String, CaseIterable, Identifiable {
    case system, simplifiedChinese = "zh-Hans", english = "en"
    var id: String { rawValue }
    func resolved(preferredLanguages: [String] = Locale.preferredLanguages) -> String {
        if self != .system { return rawValue }
        for language in preferredLanguages {
            if language.lowercased().hasPrefix("zh") { return "zh-Hans" }
            if language.lowercased().hasPrefix("en") { return "en" }
        }
        return "en"
    }
}
@MainActor
final class LanguageSettings: ObservableObject {
    static let storageKey = "jobgenie.language"
    private let defaults: UserDefaults
    @Published var selection: AppLanguage {
        didSet { defaults.set(selection.rawValue, forKey: Self.storageKey) }
    }
    @Published private var systemLanguages: [String]
    init(defaults: UserDefaults = .standard, preferredLanguages: [String] = Locale.preferredLanguages) {
        self.defaults = defaults
        selection = AppLanguage(rawValue: defaults.string(forKey: Self.storageKey) ?? "") ?? .system
        systemLanguages = preferredLanguages
    }
    var locale: Locale { Locale(identifier: selection.resolved(preferredLanguages: systemLanguages)) }
    func refreshSystemLanguages() { systemLanguages = Locale.preferredLanguages }
}

enum L10n {
    static func string(_ key: String, locale: Locale) -> String {
        let code = locale.language.languageCode?.identifier == "zh" ? "zh-Hans" : "en"
        guard let path = Bundle.main.path(forResource: code, ofType: "lproj"), let bundle = Bundle(path: path) else { return key }
        return bundle.localizedString(forKey: key, value: key, table: "Localizable")
    }
}
// Keep messages semantic until rendering, so an already-visible error changes
// language immediately. These keys never contain user-entered job information.
enum UserMessage: Equatable {
    case text(String)
    case rateLimited(minutes: Int)
    func localized(locale: Locale) -> String {
        switch self {
        case .text(let key): return L10n.string(key, locale: locale)
        case .rateLimited(let minutes):
            return String(format: L10n.string("操作过于频繁，请在 %lld 分钟后重试。", locale: locale), locale: locale, Int64(minutes))
        }
    }
}
struct LanguagePicker: View {
    @EnvironmentObject private var language: LanguageSettings
    var body: some View {
        Picker(selection: $language.selection) {
            Text("跟随系统").tag(AppLanguage.system)
            Text(verbatim: "简体中文").tag(AppLanguage.simplifiedChinese)
            Text(verbatim: "English").tag(AppLanguage.english)
        } label: { Label("语言", systemImage: "globe") }
        .pickerStyle(.menu)
        .accessibilityIdentifier("language.picker")
    }
}

// UIKit-backed navigation bars can retain a previously resolved title when
// only SwiftUI's locale changes. Pass the resolved text so the value changes
// without replacing the NavigationStack or its in-progress screens.
private struct LocalizedNavigationTitle: ViewModifier {
    @Environment(\.locale) private var locale
    let key: String
    func body(content: Content) -> some View {
        content.navigationTitle(Text(verbatim: L10n.string(key, locale: locale)))
    }
}
extension View {
    func localizedNavigationTitle(_ key: String) -> some View { modifier(LocalizedNavigationTitle(key: key)) }
}
