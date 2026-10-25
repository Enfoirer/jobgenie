# JobGenie for iPhone

原生 SwiftUI 应用，最低 iOS 17，使用现有 JobGenie 后端和数据库。代码与网页位于同一个仓库。邮箱授权新增专用后端接口，不新增第三方移动端依赖。

## 本阶段交付

- 四个独立导航页签：申请、日程、邮箱、我的。中英文界面，系统字体、深浅色和动态字号。
- 原生邮箱密码登录，保留现有服务端限流；显示网络异常、限流和会话失效提示。
- 申请列表、搜索、状态筛选、当前状态数量和详情；支持新增、编辑、删除状态历史，当前状态由服务端统一计算。
- 新建申请，以及公司、职位、地点、备注、岗位链接编辑。保存使用现有 POST/PATCH 接口，不在客户端另算当前状态；编辑结果回写列表并刷新日程。
- 统一日程接口，区分即将到来、已过时间、时间待补充；支持面试时间、笔试截止时间补充、修改、清除，从日程跳转申请详情。时间按手机时区显示，不用状态事件日期代替缺失的面试时间。
- App 内提醒列表、未读数量、已读、延后 10 分钟、取消及提前时间设置，与网页共用状态。改期、清除和删除后旧提醒失效；前台每 30 秒刷新，尚不发送后台推送。
- 邮箱立即同步、失败邮件重试、队列数量和最近同步结果；人工确认支持核对公司、职位、事件、目标申请和时间，确认或忽略后刷新申请与日程。
- Gmail / Outlook 原生授权入口，使用系统授权窗口，完成后安全回到 App；账户信息及退出。
- 无账号演示模式，示例数据明显标注，只保留在内存中，退出后重置；不会访问真实账号数据。

## 打开和运行

1. 在 Xcode 打开 `ios/JobGenie.xcodeproj`。
2. 选择 **JobGenie** scheme 和一个 iPhone 模拟器，点击 Run（⌘R）。
3. 点击“先体验演示版”，或使用网页版账号登录。

默认服务地址为 `https://jobgenie-six.vercel.app`，统一在 `Core/APIClient.swift` 配置。Debug 构建支持 `JOBGENIE_TEST_BASE_URL` 环境变量，仅接受本机 localhost/127.0.0.1 HTTP 地址，供隔离联调使用；Release 忽略此变量。未提供可任意输入服务器地址的用户入口。

本机已验证 Xcode 26.0.1 / iOS 26 模拟器。若命令行默认指向 Command Line Tools，可仅在本项目命令中指定：

```sh
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
xcodebuild -project ios/JobGenie.xcodeproj -scheme JobGenie \
  -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath /private/tmp/jobgenie-ios-build build
```

安装到自己的 iPhone 时，在 **Signing & Capabilities** 选择自己的 Team，并按需要设置唯一 Bundle Identifier。当前 `com.enfoirer.jobgenie` 是工程初始值；尚未配置开发者团队、发布签名或提交 TestFlight。

已提交完整 Xcode 工程，不需要 XcodeGen/CocoaPods。新增 Swift 文件后可使用 `python3 ios/scripts/generate-project.py` 更新工程；生成器是工程配置的来源，修改 build settings 时也应同步生成器。

## 界面语言

登录页右上角，或 **我的 → 偏好设置 → 语言**，可以选择 **跟随系统 / 简体中文 / English**。默认跟随系统，中文系统使用简体中文，英文系统使用英文；按系统首选语言列表匹配，其他语言回退英文。

选择立即生效，并保存在本机，重启和退出登录后仍保留。切换不会重新登录、清空申请、重置导航或修改公司、职位、备注等原始内容。导航、表单、状态、空页面、错误和重试提示均支持两种语言；日期格式随所选语言变化，时区仍使用手机当前时区。

应用文案统一维护于 `JobGenie/Localizable.xcstrings`。状态等动态文案按本地化键渲染，错误保留语义及参数，到显示时再翻译；业务数据按原文显示。网页版、第三方授权页面和系统键盘的语言由各自设置决定。

## 会话与网络

- 通过现有 NextAuth v4 REST 协议获取 CSRF token，再提交登录；保留后端的 IP/邮箱限流、固定登录期限及密码重置失效逻辑。没有新增绕过校验的移动端登录入口。
- URLSession 使用独立的内存 Cookie 存储，不共享 Safari 登录，不缓存接口响应，不跟随 HTTP 重定向，也不记录密码或会话内容。
- “记住我”仅把本站的会话 Cookie（含分片）写入 Keychain，使用 `WhenUnlockedThisDeviceOnly`。不保存密码、CSRF token 或邮箱提供商 token。恢复时校验域名、路径、Secure 标记和有效期，再由服务器确认会话有效。
- 不勾选时凭证只保留在本次进程中，最长仍受后端 12 小时限制；勾选时最多 30 天，不因使用 App 延长。
- 前台恢复会重新验证会话；401 清理当前用户与已加载的私有数据。退出会清除本机 Cookie/Keychain，取消旧请求并更换网络会话，防止旧请求结果恢复已退出用户的数据。
- 退出仅退出本机，不声称撤销其他设备或复制出去的 JWT；沿用现有后端会话模型。离线时也会执行本地清理。
- 注册、找回密码暂时打开网页版，浏览器需独立登录。App 不把会话凭证拼接到网页链接中。
- 邮箱绑定使用系统 `ASWebAuthenticationSession`、随机 state、S256 PKCE 和一次性服务端记录。回跳只携带 state，服务端校验同一用户、会话及 verifier 后才换取提供商 token 并保存邮箱。详见 [邮箱验收](../docs/ios-mail-acceptance.md)。

## 代码结构

```text
JobGenie/
  JobGenieApp.swift       App 生命周期、登录门禁、四个导航栈
  Core/
    APIClient.swift      NextAuth/API 协议、请求和错误处理
    SessionVault.swift   Keychain 和 Cookie 恢复边界
    Models.swift         与服务器字段对应的数据模型
    AppModel.swift       页面状态、数据刷新、演示数据
    Mail.swift           同步结果、人工确认模型与接口
    MailAuthorization.swift 系统邮箱授权与回跳校验
    Reminders.swift      提醒模型、设置与操作接口
    Analytics.swift      日期范围、统计模型和演示统计
    Attachments.swift    附件上传下载、文件限制与预览缓存
  Features/              原生 SwiftUI 页面和组件
JobGenieTests/           模型、接口、存储边界与状态测试
JobGenieUITests/         模拟器交互及真实本地后端验收
scripts/                 工程生成和隔离联调脚本
```

## 验收命令

从仓库根目录运行：

```sh
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
xcrun simctl list devices available
export IOS_SIMULATOR_ID='<上一步的 iPhone UUID>'
xcodebuild -project ios/JobGenie.xcodeproj -scheme JobGenie \
  -destination "platform=iOS Simulator,id=$IOS_SIMULATOR_ID" \
  -derivedDataPath /private/tmp/jobgenie-ios-build \
  -parallel-testing-enabled NO test
```

普通测试覆盖接口解码、日期边界、表单校验、Cookie 域名/过期/分片、401/429、HTML 响应拒绝、会话失效清理、邮箱授权、提醒和演示页面交互。`testRealBackend`、`testWebHistoryRefresh`、`testRealMailBackend`、`testRealRemindersBackend`、`testWebReminderRescheduleAndNativeClear`、`testRealResourcesUI` 和核心测试 `ResourceTests/testRealResourcesAPI` 在普通运行中显式跳过，须执行下述隔离集成命令：

```sh
MONGODB_URI=mongodb://127.0.0.1:27017/jobgenie-build-only \
  NEXTAUTH_SECRET=local-build-only NEXT_TELEMETRY_DISABLED=1 npm run build
IOS_SIMULATOR_ID="$IOS_SIMULATOR_ID" node ios/scripts/verify-backend.mjs
# 仅复跑提醒及网页互通（仍创建独立临时后端）：
IOS_SIMULATOR_ID="$IOS_SIMULATOR_ID" node ios/scripts/verify-backend.mjs --reminders-only
# 仅复跑统计与附件：
IOS_SIMULATOR_ID="$IOS_SIMULATOR_ID" node ios/scripts/verify-backend.mjs --resources-only
```

脚本创建临时 MongoDB 副本集、临时用户及本地 Next.js 服务，将仅本次测试的 localhost 地址传给 Debug App。验证真实登录、历史和日程编辑、网页互通、重启持久化、失败邮件重试、人工确认与忽略、同步部分失败提示和权限隔离。数据库断言确认邮件只生成一条申请历史。测试不会连接生产数据库或真实邮箱服务。日志和 xcresult 保存在脚本输出的临时目录。

2026-10-19 已完成：

- iPhone 17、iPhone 16e（iOS 26）模拟器：31 项核心/本地化/历史/日程测试、4 项演示及语言 UI 测试、2 项真实后端与网页互通 UI 测试，合计 37 个不同测试分批执行通过。普通运行中跳过的两项集成测试由独立脚本补跑。
- 语言验收覆盖即时切换、已填写邮箱与原始业务文字保留、已有错误提示翻译、日期格式、详情导航标题刷新、重启后记住选择，以及中英文系统语言匹配。未通过重建导航栈实现刷新。
- 真正的 NextAuth 登录、申请创建/编辑、重启后的 Keychain 会话恢复、退出后的会话清理和 MongoDB 持久化断言通过。
- 历史新增/编辑/删除、最新历史删除后的状态回退、网页/App 双向一致性和权限隔离通过；64 项现有服务端历史、日程和提醒回归通过。
- 日程补充、改期、清除、跳转详情和中英文交互通过；真实联调验证 App 设置时间重启保留，网页改期/清除被 App 读取，App 再清除后数据库及当前状态保持一致。
- Debug 模拟器构建及未签名的 iPhone arm64 Release 构建通过，工程与 plist 检查通过。Release 编译通过不等于真机安装或签名验收。
- 已检查模拟器截图：[申请页](docs/iphone-applications.png)、[日程页](docs/iphone-schedule.png)、[日程编辑](docs/iphone-schedule-editor.png)、[英文语言设置](docs/iphone-language-english.png)。

2026-10-24 邮箱增量验收：43 项核心测试、5 项演示/语言 UI、3 项真实隔离后端 UI，共 51 个不同测试分批通过；258 项服务端测试和 Web / Debug / 未签名 iPhone Release 构建通过。真实账号授权同意和真实邮件拉取尚待实测。细节见 [邮箱操作与授权验收](../docs/ios-mail-acceptance.md)，界面见 [人工确认截图](docs/iphone-mail-review.png)。

2026-10-25 提醒增量验收：55 项核心测试、6 项演示/语言 UI、5 项真实隔离后端 UI，共 66 个不同测试分批通过；258 项服务端测试、Debug 和未签名 iPhone Release 构建通过。已验证网页/App 双向互通、重启持久化、改期和清除后失效、旧版本拒绝及账号隔离。详见 [提醒验收](../docs/ios-reminders-acceptance.md) 和 [界面截图](docs/iphone-reminders.png)。APNs 尚未接入。

统计与附件已接入“我的 → 数据与文件”，沿用网页统计口径和账号级附件库，支持上传、原生预览和存储到“文件”。规则与验收见 [统计与附件文档](../docs/ios-statistics-attachments-acceptance.md)。

## 后续阶段

1. 部署邮箱原生授权后端接口后，使用真实 Gmail / Outlook 账号验收系统授权、拒绝、取消和重连。自动测试使用隔离邮件与模拟提供商响应。
2. APNs 后台推送；后台推送需要开发者配置、设备绑定、后端发送与去重配套。App 内提醒已实现，验收见 [提醒文档](../docs/ios-reminders-acceptance.md)，现阶段 App 不发送后台推送。
3. 原生注册与账号删除、隐私政策、正式图标、开发者签名、真机验证和 TestFlight。

目前为开发版本，尚未达到上架版本；没有离线业务数据库，也不在本地排队重试写操作。真实第三方邮箱授权、推送、签名和实机表现尚未验收。

状态历史功能的规则、错误恢复和隔离联调方法见 [iOS 历史管理验收](../docs/ios-history-acceptance.md)。历史编辑中的“状态发生时间”用于排序；预约和截止时间通过独立入口编辑，验收见 [iOS 日程编辑](../docs/ios-schedule-acceptance.md)。

参考：[Apple SwiftUI 导航](https://developer.apple.com/documentation/swiftui/understanding-the-navigation-stack)、[NextAuth REST API](https://next-auth.js.org/getting-started/rest-api)、[Apple 临时网络会话](https://developer.apple.com/documentation/foundation/urlsessionconfiguration/ephemeral)、[Keychain 访问级别](https://developer.apple.com/documentation/security/ksecattraccessiblewhenunlockedthisdeviceonly)。
