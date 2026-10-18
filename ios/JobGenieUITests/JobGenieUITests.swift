import XCTest

@MainActor
final class JobGenieUITests: XCTestCase {
    override func setUpWithError() throws { continueAfterFailure = false }
    func testDemoNavigationCreateEditAndExit() {
        let app = XCUIApplication()
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
    func testRealBackend() throws {
        guard let url = ProcessInfo.processInfo.environment["JOBGENIE_TEST_BASE_URL"] else { throw XCTSkip("Run ios/scripts/verify-backend.mjs for isolated NextAuth/Mongo integration") }
        let app = XCUIApplication()
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
        app.terminate(); app.launch()
        XCTAssertTrue(app.staticTexts["Native Acceptance"].waitForExistence(timeout: 20))
        app.staticTexts["Native Acceptance"].tap()
        XCTAssertTrue(app.staticTexts["Shanghai"].waitForExistence(timeout: 10))
        app.tabBars.buttons["日程"].tap()
        XCTAssertTrue(app.navigationBars["日程与待办"].exists)
        app.tabBars.buttons["我的"].tap()
        app.buttons["account.signout"].tap(); app.buttons["确认退出"].tap()
        XCTAssertTrue(app.buttons["login.submit"].waitForExistence(timeout: 10))
        app.terminate(); app.launch()
        XCTAssertTrue(app.buttons["login.submit"].waitForExistence(timeout: 10))
    }
}
