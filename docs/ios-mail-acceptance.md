# iOS 邮箱操作与授权验收

本次实现邮箱立即同步、失败重试、结果展示、人工确认，以及 Gmail / Outlook 原生授权入口。与网页版共用邮件处理和申请历史规则。

## 使用与行为

- 在“邮箱”页逐个邮箱立即同步或重试已入库的失败邮件。显示拉取、处理成功、失败、转入人工确认、错误数量及最近失败邮件。队列统计暂不可用时显示提示，不当作零。
- 同步部分失败保留已确认结果，并指出拉取或处理阶段；刷新失败保留上次结果。仍有分页数据时提示再次同步继续。
- “处理成功”包括跳过无关邮件和送入人工确认，不等于新增申请数。App 不另写邮件处理规则，复用 `/api/mail` 与 `/api/mail/status`。
- 人工确认展示邮件来源和纯文本摘要，核对公司、职位、事件、目标申请和面试/截止时间。必须明确选择已有申请或新建申请；未知事件需要重新选择。确认通过 `/api/pending/:id` 写入，旧邮件保留历史但不能覆盖较新的当前状态。忽略需要二次确认。
- 确认后刷新申请列表、详情、日程和邮箱队列。请求失败保留待确认项与草稿；401 清理用户数据。退出登录后旧请求不得恢复数据。
- 演示模式支持同步结果、重试、确认和忽略，但不连接真实邮箱。新增文案支持简体中文和英文。

## 原生授权协议

1. App 生成随机 verifier 和 S256 challenge，使用本站登录会话 POST `/api/oauth/{google,outlook}/native/start`。
2. 后端保存有效期 10 分钟的尝试记录，绑定用户、会话哈希、提供商和 challenge。返回随机 state 及提供商授权地址，每用户每 10 分钟最多发起 10 次。
3. App 校验提供商域名、HTTPS、state 和 challenge，再用临时 `ASWebAuthenticationSession` 打开授权窗口。
4. 提供商回到现有 `/api/oauth/{google,outlook}/callback`。原生 state 使用独立处理器，一次性接收 code 并 303 跳转至 `com.enfoirer.jobgenie://oauth/mail?state=...`。浏览器回调不绑定邮箱；不把 code、token 或本站 Cookie 放进 App 回跳链接。
5. App 严格校验回跳 scheme、host、path、唯一 state，然后带原始 verifier POST `native/finish`。后端核对用户、会话、challenge、提供商、过期时间并原子消费记录，换取 token 后再次检查会话，再保存邮箱。
6. 授权前取消通过 `native/cancel` 删除尝试记录。提交 finish 后结果不明时提示刷新邮箱列表；不能因请求被取消就断言邮箱未绑定。离开页面取消系统授权，退出登录后不继续完成其他会话的绑定。

提供商沿用现有服务器端 Client ID / Secret 和 HTTPS callback 配置，不需要把 secret 放进 App，也不需要把自定义 App scheme 登记成提供商 redirect URI。新版 App 的绑定入口依赖新增六个 POST 路由部署上线。自定义 URL scheme 是 App 与服务端协议的一部分，修改时须同步两端及测试。

## 自动验收

2026-10-24 已完成以下验收，iOS 使用隔离的 iPhone 17 / iPhone 16e（iOS 26）模拟器：

| 验收 | 结果 |
| --- | --- |
| 服务端完整测试 | 258 项通过，含 10 项原生授权测试 |
| iOS 核心测试 | 43 项通过，含 12 项邮箱模型、同步、人工确认与授权协调测试 |
| 演示与语言 UI | 5 个不同测试分批通过，含邮箱确认/忽略、中英文、日程和历史回归 |
| 真实隔离后端 UI | 3 项通过，涵盖历史、网页互通、邮箱完整操作，并通过脚本数据库断言 |
| 构建与静态检查 | Web 生产构建、Debug、未签名 iPhone arm64 Release、改动 JS 的 ESLint、工程/plist 校验通过 |

共 51 个不同 iOS 测试通过。中断前已通过的历史及申请演示回归保留原结果；后续补跑剩余界面、全部核心及邮箱测试。最后补充的授权提交后取消提示已有专项测试通过。

界面截图：[人工确认](../ios/docs/iphone-mail-review.png)。

隔离后端脚本使用临时 MongoDB、NextAuth 用户与 Next.js 服务。邮件样例没有真实 refresh token，模拟拉取失败在本地结束；失败重试读取已入库样例，Strict 模式转入人工确认。断言重试次数增加、确认后仅一条历史、忽略项不再待处理、重启后申请仍在、其他用户邮箱不可见。

服务端授权测试使用模拟提供商交换，覆盖两个提供商、PKCE、错误会话/用户/verifier、过期、重复与并发 finish、拒绝、取消、限流和交换期间会话失效。iOS 测试用注入的浏览器闭包验证协调流程；生产代码始终使用系统授权窗口，没有测试环境链接绕过。

复跑方式见 [iOS README](../ios/README.md)。Release 构建使用 `CODE_SIGNING_ALLOWED=NO`，仅证明编译通过。

## 尚待实测

真实 Gmail / Outlook 账号的登录、同意、拒绝、返回 App、重新授权和后续真实邮件拉取尚未验收。需部署后由账号所有者在系统授权窗口完成同意。也尚未完成真机签名安装、TestFlight 或 APNs 推送；本次不把这些列为已通过。

协议参考：[Apple ASWebAuthenticationSession](https://developer.apple.com/documentation/authenticationservices/aswebauthenticationsession/)、[OAuth 2.0 for Native Apps](https://www.rfc-editor.org/rfc/rfc8252.html)。
