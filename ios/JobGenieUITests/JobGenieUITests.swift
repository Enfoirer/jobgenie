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
    private func setSchedule(_ app: XCUIApplication, kind: String) {
        let button = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "history.schedule.\(kind).")).firstMatch
        reveal(button, in: app); button.tap()
        let toggle = app.switches["scheduleEditor.enabled"]
        XCTAssertTrue(toggle.waitForExistence(timeout: 5))
        if toggle.value as? String == "0" { toggle.coordinate(withNormalizedOffset: CGVector(dx: 0.93, dy: 0.5)).tap() }
        XCTAssertTrue(app.datePickers["scheduleEditor.time"].exists)
        app.buttons["scheduleEditor.save"].tap()
        XCTAssertTrue(app.buttons["scheduleEditor.save"].waitForNonExistence(timeout: 15))
    }
    func testDemoBulkArchiveRestoreAndMailReview() {
        let app = XCUIApplication()
        app.launchArguments = ["-AppleLanguages", "(en)", "-AppleLocale", "en_US", "-jobgenie.language", "en"]
        app.launchEnvironment["JOBGENIE_TEST_BASE_URL"] = "http://127.0.0.1:39998"
        app.launch(); XCTAssertTrue(app.buttons["login.demo"].waitForExistence(timeout: 10)); app.buttons["login.demo"].tap()
        func toggle(_ identifier: String) {
            let control = app.switches[identifier]; reveal(control, in: app)
            control.coordinate(withNormalizedOffset: CGVector(dx: 0.93, dy: 0.5)).tap()
        }
        toggle("jobs.bulkMode")
        reveal(app.buttons["bulk.selectAll"], in: app); app.buttons["bulk.selectAll"].tap()
        app.buttons["bulk.apply"].tap(); XCTAssertTrue(app.buttons.matching(identifier: "bulk.confirm").firstMatch.waitForExistence(timeout: 5)); app.buttons.matching(identifier: "bulk.confirm").firstMatch.tap()
        XCTAssertTrue(app.staticTexts["bulk.result"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["bulk.result"].label.contains("4 succeeded"))
        for _ in 0..<3 { app.swipeDown() }
        toggle("jobs.archived")
        reveal(app.buttons["bulk.selectAll"], in: app); app.buttons["bulk.selectAll"].tap()
        app.buttons["bulk.apply"].tap(); XCTAssertTrue(app.buttons.matching(identifier: "bulk.confirm").firstMatch.waitForExistence(timeout: 5)); app.buttons.matching(identifier: "bulk.confirm").firstMatch.tap()
        XCTAssertTrue(app.staticTexts["bulk.result"].label.contains("4 succeeded"))
        app.tabBars.buttons["Email"].tap(); app.buttons["mail.pending"].tap()
        toggle("mail.bulkMode"); app.buttons["bulk.selectAll"].tap()
        app.buttons["bulk.apply"].tap(); XCTAssertTrue(app.buttons.matching(identifier: "bulk.confirm").firstMatch.waitForExistence(timeout: 5)); app.buttons.matching(identifier: "bulk.confirm").firstMatch.tap()
        XCTAssertTrue(app.staticTexts["bulk.result"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["bulk.result"].label.contains("1 succeeded"))
        let screenshot = XCTAttachment(screenshot: app.screenshot()); screenshot.name = "Bulk email review"; screenshot.lifetime = .keepAlways; add(screenshot)
        app.tabBars.buttons["Account"].tap(); reveal(app.buttons["account.signout"], in: app)
        app.buttons["account.signout"].tap(); app.buttons["Confirm sign out"].tap()
    }
    func testDemoScheduleEditClearAndNavigation() {
        let app = XCUIApplication()
        app.launchArguments = ["-AppleLanguages", "(zh-Hans)", "-AppleLocale", "zh_CN", "-jobgenie.language", "system"]
        app.launchEnvironment["JOBGENIE_TEST_BASE_URL"] = "http://127.0.0.1:39998"
        app.launch(); XCTAssertTrue(app.buttons["login.demo"].waitForExistence(timeout: 10)); app.buttons["login.demo"].tap()
        app.tabBars.buttons["日程"].tap()
        let edit = app.buttons["schedule.edit.initial-demo-1:appointment"]
        XCTAssertTrue(edit.waitForExistence(timeout: 5)); edit.tap()
        app.buttons["scheduleEditor.clear"].tap(); app.buttons["scheduleEditor.save"].tap()
        XCTAssertTrue(app.buttons["scheduleEditor.save"].waitForNonExistence(timeout: 10))
        XCTAssertFalse(edit.exists)
        app.buttons["schedule.filter"].tap(); app.buttons["时间待补充"].tap()
        XCTAssertTrue(edit.waitForExistence(timeout: 5)); edit.tap()
        app.switches["scheduleEditor.enabled"].coordinate(withNormalizedOffset: CGVector(dx: 0.93, dy: 0.5)).tap()
        XCTAssertTrue(app.datePickers["scheduleEditor.time"].waitForExistence(timeout: 5))
        let screenshot = XCTAttachment(screenshot: app.screenshot()); screenshot.name = "Schedule editor"; screenshot.lifetime = .keepAlways; add(screenshot)
        app.buttons["scheduleEditor.save"].tap()
        XCTAssertTrue(app.buttons["scheduleEditor.save"].waitForNonExistence(timeout: 10))
        app.buttons["schedule.filter"].tap(); app.buttons["即将到来"].tap()
        app.buttons["schedule.detail.initial-demo-1:appointment"].tap()
        XCTAssertTrue(app.navigationBars["申请详情"].waitForExistence(timeout: 5))
        assertCurrentStatus("面试中", in: app)
        setSchedule(app, kind: "deadline")
        let deadline = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "history.schedule.deadline.")).firstMatch
        reveal(deadline, in: app); deadline.tap(); app.buttons["scheduleEditor.clear"].tap()
        app.buttons["取消"].tap()
        deadline.tap(); XCTAssertTrue(app.buttons["scheduleEditor.clear"].exists)
        app.buttons["scheduleEditor.clear"].tap(); app.buttons["scheduleEditor.save"].tap()
        XCTAssertTrue(app.buttons["scheduleEditor.save"].waitForNonExistence(timeout: 10))
        app.tabBars.buttons["我的"].tap(); app.buttons["language.picker"].tap(); app.buttons["English"].tap()
        app.tabBars.buttons["Schedule"].tap()
        reveal(deadline, in: app); deadline.tap()
        XCTAssertTrue(app.navigationBars["Edit assessment deadline"].exists)
        app.buttons["Cancel"].tap()
        app.tabBars.buttons["Account"].tap(); reveal(app.buttons["account.signout"], in: app); app.buttons["account.signout"].tap(); app.buttons["Confirm sign out"].tap()
    }
    func testDemoMailSyncReviewIgnoreAndEnglish() {
        let app = XCUIApplication()
        app.launchArguments = ["-AppleLanguages", "(zh-Hans)", "-AppleLocale", "zh_CN", "-jobgenie.language", "system"]
        app.launchEnvironment["JOBGENIE_TEST_BASE_URL"] = "http://127.0.0.1:39998"
        app.launch(); XCTAssertTrue(app.buttons["login.demo"].waitForExistence(timeout: 10)); app.buttons["login.demo"].tap()
        app.tabBars.buttons["邮箱"].tap()
        let retry = app.buttons["mail.retry.demo-mail"]
        reveal(retry, in: app); retry.tap()
        XCTAssertTrue(app.staticTexts["最近同步结果"].waitForExistence(timeout: 5)); XCTAssertFalse(retry.isEnabled)
        app.buttons["mail.sync.demo-mail"].tap()
        for _ in 0..<3 { app.swipeDown() }
        app.buttons["mail.pending"].tap(); app.buttons["mail.review.demo-review"].tap()
        let accept = app.buttons["review.accept"]
        reveal(accept, in: app)
        let screenshot = XCTAttachment(screenshot: app.screenshot()); screenshot.name = "Mail review"; screenshot.lifetime = .keepAlways; add(screenshot)
        accept.tap(); XCTAssertTrue(app.staticTexts["没有待确认邮件"].waitForExistence(timeout: 10))
        app.tabBars.buttons["我的"].tap(); reveal(app.buttons["account.signout"], in: app); app.buttons["account.signout"].tap(); app.buttons["确认退出"].tap()
        app.buttons["login.demo"].tap(); app.tabBars.buttons["邮箱"].tap()
        app.buttons["mail.pending"].tap(); app.buttons["mail.review.demo-review"].tap()
        let ignore = app.buttons["review.ignore"]
        reveal(ignore, in: app); ignore.tap(); app.buttons["确认忽略"].tap()
        XCTAssertTrue(app.staticTexts["没有待确认邮件"].waitForExistence(timeout: 10))
        app.tabBars.buttons["我的"].tap(); app.buttons["language.picker"].tap(); app.buttons["English"].tap()
        app.tabBars.buttons["Email"].tap()
        XCTAssertTrue(app.navigationBars["Pending review"].exists)
        app.navigationBars.buttons.firstMatch.tap()
        let connect = app.buttons["mail.connect.google"]
        reveal(connect, in: app); XCTAssertEqual(connect.label, "Connect Gmail"); XCTAssertFalse(connect.isEnabled)
        app.tabBars.buttons["Account"].tap(); reveal(app.buttons["account.signout"], in: app); app.buttons["account.signout"].tap(); app.buttons["Confirm sign out"].tap()
    }
    func testDemoRemindersReadSnoozeCancelSettingsAndEnglish() {
        let app = XCUIApplication()
        app.launchArguments = ["-AppleLanguages", "(zh-Hans)", "-AppleLocale", "zh_CN", "-jobgenie.language", "system"]
        app.launchEnvironment["JOBGENIE_TEST_BASE_URL"] = "http://127.0.0.1:39998"
        app.launch(); XCTAssertTrue(app.buttons["login.demo"].waitForExistence(timeout: 10)); app.buttons["login.demo"].tap()
        app.tabBars.buttons["日程"].tap(); app.buttons["reminders.open"].tap()
        let read = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "reminder.read.")).firstMatch
        XCTAssertTrue(read.waitForExistence(timeout: 10)); reveal(read, in: app); read.tap()
        XCTAssertTrue(app.staticTexts["reminders.empty"].waitForExistence(timeout: 5))
        app.buttons["reminders.filter"].tap(); app.buttons["已处理"].tap()
        XCTAssertTrue(app.staticTexts["已读"].exists)
        app.tabBars.buttons["我的"].tap(); reveal(app.buttons["account.signout"], in: app); app.buttons["account.signout"].tap(); app.buttons["确认退出"].tap()
        app.buttons["login.demo"].tap(); app.tabBars.buttons["日程"].tap(); app.buttons["reminders.open"].tap()
        let snooze = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "reminder.snooze.")).firstMatch
        reveal(snooze, in: app); snooze.tap()
        app.buttons["reminders.filter"].tap(); app.buttons["已延后"].tap()
        XCTAssertTrue(app.staticTexts["再次提醒时间"].exists)
        let cancel = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "reminder.cancel.")).firstMatch
        reveal(cancel, in: app); cancel.tap(); app.buttons["确认取消提醒"].tap()
        app.buttons["reminders.filter"].tap(); app.buttons["已处理"].tap()
        XCTAssertTrue(app.staticTexts["已取消提醒"].waitForExistence(timeout: 5))
        app.buttons["reminders.settings"].tap()
        app.buttons["reminders.lead"].tap(); app.buttons["提前 24 小时"].tap()
        app.buttons["reminders.saveSettings"].tap()
        XCTAssertTrue(app.buttons["reminders.saveSettings"].waitForNonExistence(timeout: 10))
        let screenshot = XCTAttachment(screenshot: app.screenshot()); screenshot.name = "Reminders"; screenshot.lifetime = .keepAlways; add(screenshot)
        app.tabBars.buttons["我的"].tap(); app.buttons["language.picker"].tap(); app.buttons["English"].tap()
        app.tabBars.buttons["Schedule"].tap(); XCTAssertTrue(app.navigationBars["Reminders"].exists)
        XCTAssertTrue(app.staticTexts["Reminder cancelled"].exists)
        app.tabBars.buttons["Account"].tap(); reveal(app.buttons["account.signout"], in: app); app.buttons["account.signout"].tap(); app.buttons["Confirm sign out"].tap()
    }
    private func reminderLogin() throws -> XCUIApplication {
        guard let url = ProcessInfo.processInfo.environment["JOBGENIE_TEST_BASE_URL"] else { throw XCTSkip("Run isolated backend acceptance") }
        let app = XCUIApplication()
        app.launchArguments = ["-AppleLanguages", "(zh-Hans)", "-AppleLocale", "zh_CN", "-jobgenie.language", "system"]
        app.launchEnvironment["JOBGENIE_TEST_BASE_URL"] = url
        app.launch(); XCTAssertTrue(app.textFields["login.email"].waitForExistence(timeout: 15))
        app.textFields["login.email"].tap(); app.textFields["login.email"].typeText("ios-acceptance@example.test")
        app.secureTextFields["login.password"].tap(); app.secureTextFields["login.password"].typeText("ios-local-test-password")
        app.buttons["login.submit"].tap(); XCTAssertTrue(app.buttons["jobs.add"].waitForExistence(timeout: 20))
        app.tabBars.buttons["日程"].tap(); app.buttons["reminders.open"].tap()
        return app
    }
    func testDemoAnalyticsAttachmentsAndEnglish() {
        let app = XCUIApplication()
        app.launchArguments = ["-AppleLanguages", "(zh-Hans)", "-AppleLocale", "zh_CN", "-jobgenie.language", "system"]
        app.launchEnvironment["JOBGENIE_TEST_BASE_URL"] = "http://127.0.0.1:39998"
        app.launch(); XCTAssertTrue(app.buttons["login.demo"].waitForExistence(timeout: 15)); app.buttons["login.demo"].tap()
        app.tabBars.buttons["我的"].tap(); app.buttons["analytics.open"].tap()
        XCTAssertTrue(app.staticTexts["当前状态分布"].waitForExistence(timeout: 10))
        app.swipeUp(); XCTAssertTrue(app.staticTexts["阶段转化率"].exists)
        let shot = XCTAttachment(screenshot: app.screenshot()); shot.name = "iphone-analytics"; shot.lifetime = .keepAlways; add(shot)
        app.navigationBars.buttons.firstMatch.tap(); app.buttons["attachments.open"].tap()
        XCTAssertTrue(app.staticTexts["attachments.empty"].waitForExistence(timeout: 10))
        app.buttons["attachments.upload"].tap()
        XCTAssertTrue(app.buttons["取消"].waitForExistence(timeout: 10)); app.buttons["取消"].tap()
        XCTAssertTrue(app.buttons["attachments.upload"].exists)
        app.navigationBars.buttons.firstMatch.tap(); app.buttons["language.picker"].tap(); app.buttons["English"].tap()
        app.buttons["analytics.open"].tap(); XCTAssertTrue(app.navigationBars["Analytics"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["Current status distribution"].exists)
        app.navigationBars.buttons.firstMatch.tap(); app.buttons["attachments.open"].tap()
        XCTAssertTrue(app.navigationBars["Attachments"].waitForExistence(timeout: 10)); XCTAssertTrue(app.buttons["Upload attachment"].exists)
        app.navigationBars.buttons.firstMatch.tap(); reveal(app.buttons["account.signout"], in: app); app.buttons["account.signout"].tap(); app.buttons["Confirm sign out"].tap()
    }
    func testRealResourcesUI() throws {
        guard let url = ProcessInfo.processInfo.environment["JOBGENIE_TEST_BASE_URL"] else { throw XCTSkip("Run isolated resources acceptance") }
        let app = XCUIApplication()
        app.launchArguments = ["-AppleLanguages", "(zh-Hans)", "-AppleLocale", "zh_CN", "-jobgenie.language", "system"]
        app.launchEnvironment["JOBGENIE_TEST_BASE_URL"] = url
        app.launch(); XCTAssertTrue(app.textFields["login.email"].waitForExistence(timeout: 15))
        app.textFields["login.email"].tap(); app.textFields["login.email"].typeText("ios-acceptance@example.test")
        app.secureTextFields["login.password"].tap(); app.secureTextFields["login.password"].typeText("ios-local-test-password")
        app.buttons["login.submit"].tap(); XCTAssertTrue(app.buttons["jobs.add"].waitForExistence(timeout: 20))
        app.tabBars.buttons["我的"].tap(); app.buttons["analytics.open"].tap()
        XCTAssertTrue(app.staticTexts["当前状态分布"].waitForExistence(timeout: 15))
        app.swipeUp(); XCTAssertTrue(app.staticTexts["阶段转化率"].exists)
        app.navigationBars.buttons.firstMatch.tap(); app.buttons["attachments.open"].tap()
        XCTAssertTrue(app.staticTexts["native-resume.pdf"].waitForExistence(timeout: 15))
        XCTAssertFalse(app.staticTexts["private.pdf"].exists)
        let view = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "attachment.view.")).firstMatch
        view.tap(); XCTAssertTrue(app.navigationBars["native-resume"].waitForExistence(timeout: 10) || app.buttons["完成"].exists)
        app.buttons["QLOverlayDoneButtonAccessibilityIdentifier"].tap()
        let download = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "attachment.download.")).firstMatch
        XCTAssertTrue(download.waitForExistence(timeout: 10)); download.tap()
        XCTAssertTrue(app.buttons["保存"].waitForExistence(timeout: 10)); app.buttons["保存"].tap()
        if app.buttons["替换"].waitForExistence(timeout: 2) { app.buttons["替换"].tap() }
        XCTAssertTrue(app.buttons["保存"].waitForNonExistence(timeout: 10))
        app.buttons["attachments.upload"].tap()
        let savedFile = app.cells.matching(NSPredicate(format: "label CONTAINS %@", "native-resume")).firstMatch
        XCTAssertTrue(savedFile.waitForExistence(timeout: 15), app.debugDescription); savedFile.tap()
        XCTAssertTrue(app.staticTexts["附件已上传。"].waitForExistence(timeout: 15), app.debugDescription)
        let shot = XCTAttachment(screenshot: app.screenshot()); shot.name = "iphone-attachments"; shot.lifetime = .keepAlways; add(shot)
        app.terminate(); app.launch(); XCTAssertTrue(app.buttons["jobs.add"].waitForExistence(timeout: 15))
        app.tabBars.buttons["我的"].tap(); app.buttons["attachments.open"].tap()
        XCTAssertTrue(app.staticTexts["native-resume.pdf"].waitForExistence(timeout: 15))
        app.navigationBars.buttons.firstMatch.tap(); reveal(app.buttons["account.signout"], in: app); app.buttons["account.signout"].tap(); app.buttons["确认退出"].tap()
    }
    func testRealRemindersBackend() throws {
        let app = try reminderLogin()
        let appointment = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@ AND identifier CONTAINS %@", "reminder.read.", ":appointment:")).firstMatch
        XCTAssertTrue(appointment.waitForExistence(timeout: 15)); reveal(appointment, in: app); appointment.tap()
        XCTAssertTrue(appointment.waitForNonExistence(timeout: 15))
        let snooze = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "reminder.snooze.")).firstMatch
        reveal(snooze, in: app); snooze.tap()
        XCTAssertTrue(app.staticTexts["reminders.empty"].waitForExistence(timeout: 15))
        app.buttons["reminders.filter"].tap(); app.buttons["已延后"].tap()
        XCTAssertTrue(app.staticTexts["再次提醒时间"].exists)
        app.terminate(); app.launch()
        XCTAssertTrue(app.buttons["jobs.add"].waitForExistence(timeout: 20))
        app.tabBars.buttons["日程"].tap(); app.buttons["reminders.open"].tap()
        app.buttons["reminders.filter"].tap(); app.buttons["已延后"].tap()
        let cancel = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "reminder.cancel.")).firstMatch
        XCTAssertTrue(cancel.waitForExistence(timeout: 15)); reveal(cancel, in: app); cancel.tap(); app.buttons["确认取消提醒"].tap()
        XCTAssertTrue(app.staticTexts["reminders.empty"].waitForExistence(timeout: 15))
        app.buttons["reminders.settings"].tap()
        app.buttons["reminders.lead"].tap(); app.buttons["提前 24 小时"].tap()
        app.buttons["reminders.saveSettings"].tap()
        XCTAssertTrue(app.buttons["reminders.saveSettings"].waitForNonExistence(timeout: 15))
        app.buttons["reminders.filter"].tap(); app.buttons["已处理"].tap()
        XCTAssertTrue(app.staticTexts["已读"].waitForExistence(timeout: 10)); XCTAssertTrue(app.staticTexts["已取消提醒"].exists)
        XCTAssertFalse(app.staticTexts["Private Other User"].exists)
        app.tabBars.buttons["我的"].tap(); reveal(app.buttons["account.signout"], in: app); app.buttons["account.signout"].tap(); app.buttons["确认退出"].tap()
    }
    func testWebReminderRescheduleAndNativeClear() throws {
        let app = try reminderLogin()
        let read = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@ AND identifier CONTAINS %@", "reminder.read.", ":appointment:1")).firstMatch
        XCTAssertTrue(read.waitForExistence(timeout: 15))
        XCTAssertFalse(app.staticTexts["Private Other User"].exists)
        let detail = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "reminder.detail.")).firstMatch
        reveal(detail, in: app); detail.tap()
        XCTAssertTrue(app.navigationBars["申请详情"].waitForExistence(timeout: 10))
        let edit = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "history.schedule.appointment.")).firstMatch
        reveal(edit, in: app); edit.tap(); app.buttons["scheduleEditor.clear"].tap(); app.buttons["scheduleEditor.save"].tap()
        XCTAssertTrue(app.buttons["scheduleEditor.save"].waitForNonExistence(timeout: 15))
        app.navigationBars.buttons.firstMatch.tap()
        XCTAssertTrue(app.staticTexts["reminders.empty"].waitForExistence(timeout: 15))
        app.tabBars.buttons["我的"].tap(); reveal(app.buttons["account.signout"], in: app); app.buttons["account.signout"].tap(); app.buttons["确认退出"].tap()
    }
    func testRealMailBackend() throws {
        guard let url = ProcessInfo.processInfo.environment["JOBGENIE_TEST_BASE_URL"] else { throw XCTSkip("Run isolated backend acceptance") }
        let app = XCUIApplication()
        app.launchArguments = ["-AppleLanguages", "(zh-Hans)", "-AppleLocale", "zh_CN", "-jobgenie.language", "system"]
        app.launchEnvironment["JOBGENIE_TEST_BASE_URL"] = url
        app.launch(); XCTAssertTrue(app.textFields["login.email"].waitForExistence(timeout: 15))
        app.textFields["login.email"].tap(); app.textFields["login.email"].typeText("ios-acceptance@example.test")
        app.secureTextFields["login.password"].tap(); app.secureTextFields["login.password"].typeText("ios-local-test-password")
        app.buttons["login.submit"].tap(); XCTAssertTrue(app.buttons["jobs.add"].waitForExistence(timeout: 20))
        app.tabBars.buttons["邮箱"].tap()
        XCTAssertTrue(app.staticTexts["native-mail@example.test"].waitForExistence(timeout: 15))
        XCTAssertFalse(app.staticTexts["foreign-mail@example.test"].exists)
        let retry = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "mail.retry.")).firstMatch
        reveal(retry, in: app); retry.tap()
        XCTAssertTrue(app.staticTexts["最近同步结果"].waitForExistence(timeout: 20))
        XCTAssertFalse(retry.isEnabled)
        let sync = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "mail.sync.")).firstMatch
        reveal(sync, in: app); sync.tap()
        XCTAssertTrue(app.staticTexts["同步已结束，部分环节失败，请查看结果。"].waitForExistence(timeout: 20))
        for _ in 0..<3 { app.swipeDown() }
        app.buttons["mail.pending"].tap()
        XCTAssertTrue(app.staticTexts["Application received at Native Mail Co"].waitForExistence(timeout: 10))
        app.staticTexts["Application received at Native Mail Co"].tap()
        let target = app.buttons["review.target"]
        reveal(target, in: app); target.tap(); app.buttons["新建申请"].tap()
        let accept = app.buttons["review.accept"]
        reveal(accept, in: app); accept.tap()
        XCTAssertTrue(app.staticTexts["Application received at Native Mail Co"].waitForNonExistence(timeout: 20))
        app.staticTexts["Ignore this fixture"].tap()
        let ignore = app.buttons["review.ignore"]
        reveal(ignore, in: app); ignore.tap(); app.buttons["确认忽略"].tap()
        XCTAssertTrue(app.staticTexts["没有待确认邮件"].waitForExistence(timeout: 15))
        app.terminate(); app.launch()
        XCTAssertTrue(app.staticTexts["Native Mail Co"].waitForExistence(timeout: 20))
        app.tabBars.buttons["邮箱"].tap(); app.buttons["mail.pending"].tap()
        XCTAssertTrue(app.staticTexts["没有待确认邮件"].waitForExistence(timeout: 15))
        app.tabBars.buttons["我的"].tap(); reveal(app.buttons["account.signout"], in: app); app.buttons["account.signout"].tap(); app.buttons["确认退出"].tap()
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
        app.tabBars.buttons["Account"].tap(); reveal(app.buttons["account.signout"], in: app); app.buttons["account.signout"].tap(); app.buttons["Confirm sign out"].tap()
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
        reveal(app.buttons["account.signout"], in: app); app.buttons["account.signout"].tap(); app.buttons["确认退出"].tap()
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
        setSchedule(app, kind: "appointment")
        setSchedule(app, kind: "deadline")
        app.terminate(); app.launch()
        XCTAssertTrue(app.staticTexts["Native Acceptance"].waitForExistence(timeout: 20))
        app.staticTexts["Native Acceptance"].tap()
        XCTAssertTrue(app.staticTexts["Shanghai"].waitForExistence(timeout: 10))
        assertCurrentStatus("面试中", in: app)
        reveal(app.staticTexts["Native interview"], in: app)
        XCTAssertTrue(app.staticTexts["Native interview"].exists)
        app.tabBars.buttons["日程"].tap()
        XCTAssertTrue(app.navigationBars["日程与待办"].exists)
        XCTAssertEqual(app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "schedule.edit.")).count, 2)
        app.tabBars.buttons["我的"].tap()
        reveal(app.buttons["account.signout"], in: app); app.buttons["account.signout"].tap(); app.buttons["确认退出"].tap()
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
        app.tabBars.buttons["日程"].tap()
        XCTAssertTrue(app.staticTexts["Native Acceptance"].waitForExistence(timeout: 10))
        XCTAssertEqual(app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "schedule.edit.")).count, 1)
        let edit = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "schedule.edit.")).firstMatch
        edit.tap(); app.buttons["scheduleEditor.clear"].tap(); app.buttons["scheduleEditor.save"].tap()
        XCTAssertTrue(app.buttons["scheduleEditor.save"].waitForNonExistence(timeout: 15))
        XCTAssertTrue(app.staticTexts["暂无此类日程"].waitForExistence(timeout: 10))
        app.tabBars.buttons["我的"].tap(); reveal(app.buttons["account.signout"], in: app); app.buttons["account.signout"].tap(); app.buttons["确认退出"].tap()
        XCTAssertTrue(app.buttons["login.submit"].waitForExistence(timeout: 10))
    }
}
