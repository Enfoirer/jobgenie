import XCTest
@testable import JobGenie

@MainActor
final class LocalizationTests: XCTestCase {
    func testSystemLanguageResolutionAndFallback() {
        XCTAssertEqual(AppLanguage.system.resolved(preferredLanguages: ["en-GB", "zh-Hans"]), "en")
        XCTAssertEqual(AppLanguage.system.resolved(preferredLanguages: ["zh-Hant-TW", "en"]), "zh-Hans")
        XCTAssertEqual(AppLanguage.system.resolved(preferredLanguages: ["fr-FR", "zh-Hans-CN"]), "zh-Hans")
        XCTAssertEqual(AppLanguage.system.resolved(preferredLanguages: ["fr-FR"]), "en")
        XCTAssertEqual(AppLanguage.english.resolved(preferredLanguages: ["zh-Hans"]), "en")
    }
    func testPreferencePersistsAndInvalidValueUsesSystem() {
        let name = "jobgenie-language-tests-\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: name)!
        defer { defaults.removePersistentDomain(forName: name) }
        let settings = LanguageSettings(defaults: defaults, preferredLanguages: ["en"])
        XCTAssertEqual(settings.selection, .system)
        settings.selection = .simplifiedChinese
        let reloaded = LanguageSettings(defaults: defaults, preferredLanguages: ["en"])
        XCTAssertEqual(reloaded.selection, .simplifiedChinese)
        XCTAssertEqual(reloaded.locale.language.languageCode?.identifier, "zh")
        reloaded.selection = .system
        XCTAssertEqual(reloaded.locale.language.languageCode?.identifier, "en")
        defaults.set("invalid", forKey: LanguageSettings.storageKey)
        XCTAssertEqual(LanguageSettings(defaults: defaults).selection, .system)
    }
    func testDynamicMessagesTranslateAtRenderTime() {
        let en = Locale(identifier: "en"), zh = Locale(identifier: "zh-Hans")
        let message = APIError.rateLimited(121).userMessage
        XCTAssertEqual(message.localized(locale: en), "Too many attempts. Try again in 3 min.")
        XCTAssertEqual(message.localized(locale: zh), "操作过于频繁，请在 3 分钟后重试。")
        XCTAssertEqual(APIError.credentials.userMessage.localized(locale: en), "Your email or password is incorrect.")
        XCTAssertEqual(UserMessage.text("请填写公司和职位。").localized(locale: en), "Enter a company and role.")
        XCTAssertEqual(APIError.unauthorized.userMessage.localized(locale: zh), "登录已过期，请重新登录。")
    }
    func testLocalizedStatusResources() {
        let en = Locale(identifier: "en"), zh = Locale(identifier: "zh-Hans")
        for key in ApplicationStatus.allCases.map(\.title) + ScheduleBucket.allCases.map(\.title) {
            XCTAssertNotEqual(L10n.string(key, locale: en), key)
            XCTAssertEqual(L10n.string(key, locale: zh), key)
        }
        XCTAssertEqual(L10n.string("申请记录 · %lld", locale: en), "Applications · %lld")

    }
}
