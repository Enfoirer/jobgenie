# iOS 分享岗位

日期：2026-11-01。

## 使用方式

1. 在 Safari 打开岗位页面，点「分享」，选择 JobGenie。首次可在「更多」中启用。
2. 自动填入 http/https 链接；公司、职位可在分享面板补充，也可稍后补充。
3. 点「保存草稿」，然后打开 JobGenie。
4. 登录真实账号，在「申请 → 分享的岗位 → 补充并创建申请」核对当前账号、公司、职位和链接，再保存。
5. 保存成功后草稿删除，申请通过现有 API 写入数据库，网页刷新后可见。初始状态与普通手动新建一致，为已申请。

分享扩展不自动启动主 App，也不访问登录凭证或直接写入账号。草稿保存在设备的 App Group 容器，支持离线及重启。演示模式可查看草稿，但不能导入；未登录时先保存草稿，登录后再主动确认归属。

## 数据和边界

- 接收单个网页 URL 或含一个明确网页链接的文本；拒绝文件、JavaScript、带用户名密码的链接和多个不同链接。
- 不自动抓取网页，不把页面标题猜成公司或职位；公司与职位在最终创建前必须填写。
- 同一链接、公司、职位的重复分享复用待处理草稿；最多 50 个草稿。创建前提示已有相同链接的申请，允许用户决定是否为另一次投递。
- 每条草稿单独原子写入文件；读取时校验文件大小、内容和 ID。损坏文件不会导致正常草稿丢失。
- 取消创建或创建失败不会删除草稿；成功后清理失败会提示手动删除。草稿不含令牌或账号数据，也不会随账号切换自动提交。
- 新建 API 沿用现有行为；网络中断后若无法确定服务器是否保存，应刷新申请列表检查，避免再次创建。

## 工程与签名

新增 `JobGenieShare` Share Extension，Bundle ID `com.enfoirer.jobgenie.JobGenieShare`，由主 App 嵌入。

主 App 和扩展均配置 `group.com.enfoirer.jobgenie` App Group。真机/TestFlight 发布前，需要在 Apple Developer 中注册此 Group，并为两个 App ID 开启该 Group；两个 Target 选择同一开发者 Team，更新签名描述文件。缺少 Group 时保存会报错，不会假装保存成功。

`ios/scripts/generate-project.py` 已包含扩展 Target、共享源码、资源、依赖、嵌入和 entitlement，重新生成项目不会丢失这些配置。

## 验证命令

- iOS 单元测试：`ShareTests` 覆盖 URL 校验、文本提取、持久化/重开、重复保存、删除、容量和损坏文件，以及主 App 真实共享容器。
- `IOS_SIMULATOR_ID=<device> IOS_DERIVED_DATA=/tmp/jobgenie-share-build node ios/scripts/verify-backend.mjs --share-only`：Safari → 分享扩展 → 共享容器 → 登录 → 预填创建 → 重启 → 隔离数据库验证。

真机签名与 TestFlight 分发需要开发者账号；此功能不涉及网页后端变更。

## 本次验收结果

- iOS 单元测试：78 项通过，1 项既有真实资源服务测试按运行条件跳过；新增分享测试 5 项全部通过。
- Safari 端到端验收：通过。使用 iPhone 17 模拟器、真实 NextAuth/Next.js 和隔离 MongoDB，验证扩展展示、URL/公司/职位预填、创建后草稿移除、重启持久化及退出。
- 数据库核对：测试用户仅新增 1 条申请、1 条初始历史；岗位链接和公司/职位完全一致，另一用户的数据未改变。
- iPhone Release 构建（`CODE_SIGNING_ALLOWED=NO`）：通过；尚未做开发者签名或 TestFlight 发布。
- 项目生成器重复运行结果一致；`git diff --check` 通过。
