import XCTest

@MainActor
final class JobGenieUITests: XCTestCase {
    override func setUpWithError() throws { continueAfterFailure = false }
    private func reveal(_ element: XCUIElement, in app: XCUIApplication) {
        for _ in 0..<5 { if element.exists && element.isHittable { return }; app.swipeUp() }
        XCTAssertTrue(element.exists && element.isHittable, app.debugDescription)
    }
    private func assertCurrentStatus(_ title: String, in app: XCUIApplication) {
        for _ in 0..<4 { app.swipeDown() }
        let status = app.staticTexts["job.currentStatus"]
        XCTAssertTrue(status.waitForExistence(timeout: 10), app.debugDescription)
        XCTAssertEqual(status.label, title)
    }
    private func exerciseHistory(_ app: XCUIApplication) {
        let add = app.buttons["history.add"]
        reveal(add, in: app); add.tap()
        app.buttons["historyEditor.status"].tap(); app.buttons["面试 / 笔试"].tap()
        app.textFields["historyEditor.stage"].tap(); app.textFields["historyEditor.stage"].typeText("Assessment")
        let notes = app.descendants(matching: .any).matching(identifier: "historyEditor.notes").firstMatch
        notes.tap(); notes.typeText("Native interview")
        app.buttons["historyEditor.save"].tap()
        XCTAssertTrue(app.buttons["historyEditor.save"].waitForNonExistence(timeout: 15))
        assertCurrentStatus("面试中", in: app)
        reveal(add, in: app); add.tap()
        app.buttons["historyEditor.status"].tap(); app.buttons["已获 Offer"].tap()
        notes.tap(); notes.typeText("Temporary offer")
        app.buttons["historyEditor.save"].tap()
        XCTAssertTrue(app.buttons["historyEditor.save"].waitForNonExistence(timeout: 15))
        assertCurrentStatus("已获 Offer", in: app)
        let edit = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "history.edit.")).firstMatch
        reveal(edit, in: app); edit.tap()
        app.buttons["historyEditor.status"].tap(); app.buttons["未通过"].tap()
        app.buttons["historyEditor.save"].tap()
        XCTAssertTrue(app.buttons["historyEditor.save"].waitForNonExistence(timeout: 15))
        assertCurrentStatus("未通过", in: app)
        let remove = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "history.delete.")).firstMatch
        reveal(remove, in: app); remove.tap(); app.alerts.buttons["取消"].tap()
        XCTAssertTrue(app.staticTexts["Temporary offer"].exists)
        remove.tap(); app.alerts.buttons["确认删除"].tap()
        XCTAssertTrue(app.staticTexts["Temporary offer"].waitForNonExistence(timeout: 15))
        assertCurrentStatus("面试中", in: app)
        reveal(edit, in: app)
        let screenshot = XCTAttachment(screenshot: app.screenshot()); screenshot.name = "Native status history"; screenshot.lifetime = .keepAlways; self.add(screenshot)
    }
    func testDemoHistoryCRUDAndEnglishEditor() {
        let app = XCUIApplication()
        app.launchArguments = ["-AppleLanguages", "(zh-Hans)", "-AppleLocale", "zh_CN", "-jobgenie.language", "system"]
        app.launchEnvironment["JOBGENIE_TEST_BASE_URL"] = "http://127.0.0.1:39998"
        app.launch(); XCTAssertTrue(app.buttons["login.demo"].waitForExistence(timeout: 10)); app.buttons["login.demo"].tap()
        app.buttons["job.demo-2"].tap()
        exerciseHistory(app)
        app.tabBars.buttons["我的"].tap(); app.buttons["language.picker"].tap(); app.buttons["English"].tap()
        app.tabBars.buttons["Applications"].tap()
        reveal(app.buttons["history.add"], in: app); app.buttons["history.add"].tap()
        XCTAssertTrue(app.navigationBars["Add status entry"].exists)
        XCTAssertTrue(app.staticTexts["Status event time"].exists)
        app.buttons["Cancel"].tap()
        app.tabBars.buttons["Account"].tap(); app.buttons["account.signout"].tap(); app.buttons["Confirm sign out"].tap()
    }
    func testDemoNavigationCreateEditAndExit() {
        let app = XCUIApplication()
        app.launchArguments = ["-AppleLanguages", "(zh-Hans)", "-AppleLocale", "zh_CN", "-jobgenie.language", "system"]
        app.launchEnvironment["JOBGENIE_TEST_BASE_URL"] = "http://127.0.0.1:39998"
        app.launch()
        XCTAssertTrue(app.buttons["login.demo"].waitForExistence(timeout: 10))
        app.buttons["login.demo"].tap()
        XCTAssertTrue(app.buttons["jobs.add"].waitForExistence(timeout: 5))
        let home = XCTAttachment(screenshot: app.screenshot()); home.name = "Applications"; home.lifetime = .keepAlways; add(home)
        app.buttons["jobs.add"].tap()
        app.buttons["editor.save"].tap()
        XCTAssertTrue(app.staticTexts["请填写公司和职位。"].exists)
        app.textFields["editor.company"].tap(); app.textFields["editor.company"].typeText("Demo Acme")
        app.textFields["editor.position"].tap(); app.textFields["editor.position"].typeText("iOS Engineer")
        app.buttons["editor.save"].tap()
        XCTAssertTrue(app.staticTexts["Demo Acme"].waitForExistence(timeout: 5))
        app.staticTexts["Demo Acme"].tap()
        app.buttons["job.edit"].tap()
        let location = app.textFields["editor.location"]
        location.tap(); location.typeText("Shanghai")
        app.buttons["editor.save"].tap()
        XCTAssertTrue(app.staticTexts["Shanghai"].waitForExistence(timeout: 5))
        app.tabBars.buttons["日程"].tap()
        XCTAssertTrue(app.staticTexts["Northstar"].waitForExistence(timeout: 5))
        app.buttons["schedule.filter"].tap(); app.buttons["时间待补充"].tap()
        XCTAssertTrue(app.staticTexts["尚未安排时间"].exists)
        let calendar = XCTAttachment(screenshot: app.screenshot()); calendar.name = "Schedule"; calendar.lifetime = .keepAlways; add(calendar)
        app.tabBars.buttons["邮箱"].tap()
        XCTAssertTrue(app.staticTexts["demo@example.com"].exists)
        app.tabBars.buttons["我的"].tap()
        app.buttons["account.signout"].tap(); app.buttons["确认退出"].tap()
        XCTAssertTrue(app.buttons["login.demo"].waitForExistence(timeout: 5))
    }
    func testLanguageSwitchingAndPersistence() {
        let app = XCUIApplication()
        app.launchEnvironment["JOBGENIE_TEST_BASE_URL"] = "http://127.0.0.1:39997"
        app.launchArguments = ["-AppleLanguages", "(zh-Hans)", "-AppleLocale", "zh_CN", "-jobgenie.language", "system"]
        app.launch()
        XCTAssertTrue(app.buttons["language.picker"].waitForExistence(timeout: 10))
        let email = app.textFields["login.email"]
        email.tap(); email.typeText("keep@example.test")
        app.secureTextFields["login.password"].tap(); app.secureTextFields["login.password"].typeText("local-invalid-password")
        app.buttons["login.submit"].tap()
        XCTAssertTrue(app.staticTexts["网络连接失败，请检查网络后重试。"].waitForExistence(timeout: 10))
        app.buttons["language.picker"].tap(); app.buttons["English"].tap()
        XCTAssertTrue(app.buttons["Explore the demo"].waitForExistence(timeout: 5))
        XCTAssertEqual(email.value as? String, "keep@example.test")
        XCTAssertTrue(app.staticTexts["Connection failed. Check your network and try again."].exists)
        app.swipeUp()
        app.buttons["login.demo"].tap()
        XCTAssertTrue(app.navigationBars["My applications"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Applications · 4"].exists)
        app.buttons["jobs.add"].tap(); app.buttons["editor.save"].tap()
        XCTAssertTrue(app.staticTexts["Enter a company and role."].exists)
        app.buttons["Cancel"].tap()
        app.buttons["job.demo-1"].tap()
        XCTAssertTrue(app.navigationBars["Application details"].exists)
        XCTAssertFalse(app.staticTexts["job.appliedDate"].label.contains("月"))
        XCTAssertTrue(app.staticTexts["iOS 工程师"].exists)
        XCTAssertTrue(app.staticTexts["准备项目介绍，以及一次最有挑战的技术决策。"].exists)
        app.tabBars.buttons["Schedule"].tap()
        XCTAssertTrue(app.navigationBars["Schedule & to-do"].exists)
        app.buttons["schedule.filter"].tap(); app.buttons["Needs a time"].tap()
        XCTAssertTrue(app.staticTexts["Time not scheduled"].exists)
        app.tabBars.buttons["Email"].tap()
        XCTAssertTrue(app.staticTexts["Connected mailboxes"].exists)
        app.tabBars.buttons["Account"].tap()
        app.buttons["language.picker"].tap(); app.buttons["简体中文"].tap()
        XCTAssertTrue(app.tabBars.buttons["日程"].exists)
        app.tabBars.buttons["申请"].tap()
        let switched = XCTAttachment(screenshot: app.screenshot()); switched.name = "Switched detail"; switched.lifetime = .keepAlways; add(switched)
        XCTAssertTrue(app.navigationBars["申请详情"].exists, app.debugDescription)
        XCTAssertTrue(app.staticTexts["job.appliedDate"].label.contains("月"))
        app.tabBars.buttons["我的"].tap()
        app.buttons["language.picker"].tap(); app.buttons["English"].tap()
        let screenshot = XCTAttachment(screenshot: app.screenshot()); screenshot.name = "English language setting"; screenshot.lifetime = .keepAlways; add(screenshot)
        app.terminate()
        // Drop the test's initial preference override: verify the saved choice.
        app.launchArguments = ["-AppleLanguages", "(zh-Hans)", "-AppleLocale", "zh_CN"]
        app.launch()
        XCTAssertTrue(app.buttons["Explore the demo"].waitForExistence(timeout: 10))
        app.buttons["language.picker"].tap(); app.buttons["Follow system"].tap()
        XCTAssertTrue(app.buttons["先体验演示版"].exists)
        app.terminate()
        app.launchArguments = ["-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        app.launch()
        XCTAssertTrue(app.buttons["Explore the demo"].waitForExistence(timeout: 10))
    }
    func testRealBackend() throws {
        guard let url = ProcessInfo.processInfo.environment["JOBGENIE_TEST_BASE_URL"] else { throw XCTSkip("Run ios/scripts/verify-backend.mjs for isolated NextAuth/Mongo integration") }
        let app = XCUIApplication()
        app.launchArguments = ["-AppleLanguages", "(zh-Hans)", "-AppleLocale", "zh_CN", "-jobgenie.language", "system"]
        app.launchEnvironment["JOBGENIE_TEST_BASE_URL"] = url
        app.launch()
        XCTAssertTrue(app.textFields["login.email"].waitForExistence(timeout: 15))
        app.textFields["login.email"].tap(); app.textFields["login.email"].typeText("ios-acceptance@example.test")
        app.secureTextFields["login.password"].tap(); app.secureTextFields["login.password"].typeText("ios-local-test-password")
        app.buttons["login.submit"].tap()
        XCTAssertTrue(app.buttons["jobs.add"].waitForExistence(timeout: 25))
        XCTAssertFalse(app.staticTexts["Private Other User"].exists)
        app.buttons["jobs.add"].tap()
        app.textFields["editor.company"].tap(); app.textFields["editor.company"].typeText("Native Acceptance")
        app.textFields["editor.position"].tap(); app.textFields["editor.position"].typeText("iOS Engineer")
        app.buttons["editor.save"].tap()
        XCTAssertTrue(app.staticTexts["Native Acceptance"].waitForExistence(timeout: 15))
        app.staticTexts["Native Acceptance"].tap(); app.buttons["job.edit"].tap()
        app.textFields["editor.location"].tap(); app.textFields["editor.location"].typeText("Shanghai")
        app.buttons["editor.save"].tap()
        XCTAssertTrue(app.staticTexts["Shanghai"].waitForExistence(timeout: 15))
        exerciseHistory(app)
        app.terminate(); app.launch()
        XCTAssertTrue(app.staticTexts["Native Acceptance"].waitForExistence(timeout: 20))
        app.staticTexts["Native Acceptance"].tap()
        XCTAssertTrue(app.staticTexts["Shanghai"].waitForExistence(timeout: 10))
        assertCurrentStatus("面试中", in: app)
        reveal(app.staticTexts["Native interview"], in: app)
        XCTAssertTrue(app.staticTexts["Native interview"].exists)
        app.tabBars.buttons["日程"].tap()
        XCTAssertTrue(app.navigationBars["日程与待办"].exists)
        app.tabBars.buttons["我的"].tap()
        app.buttons["account.signout"].tap(); app.buttons["确认退出"].tap()
        XCTAssertTrue(app.buttons["login.submit"].waitForExistence(timeout: 10))
        app.terminate(); app.launch()
        XCTAssertTrue(app.buttons["login.submit"].waitForExistence(timeout: 10))
    }
    func testWebHistoryRefresh() throws {
        guard let url = ProcessInfo.processInfo.environment["JOBGENIE_TEST_BASE_URL"] else { throw XCTSkip("Run the isolated backend acceptance") }
        let app = XCUIApplication()
        app.launchArguments = ["-AppleLanguages", "(zh-Hans)", "-AppleLocale", "zh_CN", "-jobgenie.language", "system"]
        app.launchEnvironment["JOBGENIE_TEST_BASE_URL"] = url
        app.launch()
        XCTAssertTrue(app.textFields["login.email"].waitForExistence(timeout: 15))
        app.textFields["login.email"].tap(); app.textFields["login.email"].typeText("ios-acceptance@example.test")
        app.secureTextFields["login.password"].tap(); app.secureTextFields["login.password"].typeText("ios-local-test-password")
        app.buttons["login.submit"].tap()
        XCTAssertTrue(app.staticTexts["Native Acceptance"].waitForExistence(timeout: 20))
        app.staticTexts["Native Acceptance"].tap()
        assertCurrentStatus("已获 Offer", in: app)
        reveal(app.staticTexts["Web updated history"], in: app)
        XCTAssertTrue(app.staticTexts["Web updated history"].exists)
        app.tabBars.buttons["我的"].tap(); app.buttons["account.signout"].tap(); app.buttons["确认退出"].tap()
        XCTAssertTrue(app.buttons["login.submit"].waitForExistence(timeout: 10))
    }
}
