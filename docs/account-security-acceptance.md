# 账号与邮箱安全验收

## 邮箱授权规则

- Gmail、Outlook 按钮调用同源 POST `/api/oauth/{google|outlook}/start`，服务端生成授权 URL。未登录、跨站请求或配置不完整时不创建授权流程。
- 每次生成独立的随机 `state` 和 PKCE verifier，使用 S256 challenge。数据库只保存校验所需的哈希，绑定用户、当前登录会话和邮箱提供商，有效期 10 分钟。
- verifier 放在 HttpOnly、SameSite=Lax 的 Cookie 中；HTTPS 下使用 Secure、`__Host-` 前缀和根路径，无 Domain。前端脚本无法读取。
- 回调在兑换 code 前必须原子消费有效记录，同时校验 state、Cookie、提供商、用户和登录会话。缺失、重复参数、错配、过期、重放均失败；即使数据库 TTL 尚未清理记录，也会拒绝过期流程。
- 同一会话重新连接同一提供商，会替换上一次待完成流程。旧标签页需重新发起；两种提供商可以各有一个流程。
- 用户取消授权也消费记录并清理 Cookie。兑换失败不能重用回调，需要重新点击连接。无效回调不会清掉另一个尚有效流程的 Cookie。
- 兑换使用固定提供商端点、固定回调地址、15 秒请求超时，禁止跟随重定向。校验返回的 token、scope（提供时）、邮箱地址和过期时间；错误内容不向页面透传。
- 保存前再次验证登录会话（包括密码重置导致的失效）。同一用户的邮箱绑定写入串行化，防止并发重复创建；重新连接保留已有同步游标及未返回的新 refresh token 对应的旧值。
- 新登录带随机会话标识；旧会话使用稳定标识兼容，不延长原有有效期。部署前发起且没有 state/Cookie 的旧授权链接需重新发起。

## 登录、注册限流

| 入口 | 同一 IP | 同一邮箱 | 固定窗口 |
| --- | --- | --- | --- |
| 登录 | 50 次 | 10 次 | 15 分钟 |
| 注册 | 10 次 | 3 次 | 1 小时 |

- 配额保存在 MongoDB，原子计数，跨实例共享；邮箱统一去除首尾空格并转为小写。配额键经过哈希处理。
- 请求先消耗 IP 配额；邮箱格式合法后再消耗邮箱配额，然后才查询账号或计算密码哈希。成功和失败都计数，登录成功不会清空额度，不存在的账号使用相同策略。
- 窗口按 Unix 时间固定切分，跨窗口恢复；边界两侧可能各用一轮配额，并非滑动窗口。拒绝返回 HTTP 429 和距下个窗口的 `Retry-After` 秒数，登录与注册页面显示等待提示。
- 限流数据库不可用时停止认证/注册，返回通用 503，不绕过限制。不存在账号也经过固定 bcrypt 比较路径，避免直接跳过密码检查。
- 注册请求限 4 KB，仅接收 name/email/password；名称不超过 100 字符，密码沿用至少 8 字符且最多 72 UTF-8 字节的规则。冲突创建返回通用 409，不泄露数据库错误或密码哈希。
- 邮箱连接入口另外限制每用户每 10 分钟最多发起 10 次。

## 部署配置

- 使用已有服务器环境变量 `NEXTAUTH_URL`、`NEXTAUTH_SECRET`、`MONGODB_URI`，以及 `GOOGLE_CLIENT_ID`、`GOOGLE_CLIENT_SECRET`、`OUTLOOK_CLIENT_ID`、`OUTLOOK_CLIENT_SECRET`、可选 `OUTLOOK_TENANT_ID`（默认 common）。连接按钮不再依赖 `NEXT_PUBLIC_*` 客户端 ID。
- 授权回调地址仍为公开站点地址加 `/api/oauth/google/callback`、`/api/oauth/outlook/callback`，在提供商控制台保持一致。公开地址取 `NEXTAUTH_URL`（兼容回退 `OAUTH_REDIRECT_BASE`），生产必须 HTTPS，本地允许 localhost/127.0.0.1 HTTP；不信任请求 Host 生成回调。
- Vercel 环境仅信任平台覆盖的 `x-vercel-forwarded-for`，校验 IP 格式并规范化 IPv6；忽略客户端可伪造的普通转发头。其他部署环境或缺失可信 IP 时使用共享 anonymous 配额，切换托管平台前应适配该平台的可信代理来源，不能直接信任任意请求头。密码恢复入口也使用同一 IP 读取规则。
- MongoDB 继续要求副本集/Atlas（已有业务事务要求）；新增 OAuthAttempt 集合，TTL 用于清理，过期和一次性校验不依赖 TTL 的清理时机。无需修改已有邮箱记录。

## 已执行验收

- `npm test`：248 项通过，新增 26 项账号安全测试。覆盖两种提供商的正常授权、取消、伪造/缺失/重复 state、Cookie 错配、跨用户/提供商/会话、过期、重放、并发消费、重新发起、兑换失败和保存前会话失效。
- 数据库/API 测试覆盖重连保留信息、并发绑定去重、IP/邮箱配额、大小写归一化、并发限流、窗口恢复、未知账号、数据库异常、注册大小/字段校验和重复创建。
- `npm run build` 通过；修改范围 ESLint 与 `git diff --check` 通过。
- `npm run test:ui` 全流程通过。真实 Chrome 点击 Gmail/Outlook 连接，检查 state、PKCE、HttpOnly Cookie、取消、清理及重放拒绝；真实 NextAuth 和注册请求触发 429/Retry-After，页面显示提示，受限注册不产生用户，清除测试配额后可正常登录。
- 原有编辑、日历、提醒、统计、上传、邮件同步、密码恢复与会话期限浏览器验收一并通过。
- 所有测试使用临时数据库。第三方授权跳转由浏览器拦截，token/profile 使用固定模拟响应；未使用真实邮箱进行提供商授权，也未发送真实邮件。真实第三方同意授权与提供商控制台配置仍需在对应账号下联调。

## 协议与托管参考

- [Google 服务端 OAuth 流程](https://developers.google.com/identity/protocols/oauth2/web-server)
- [Microsoft authorization code / PKCE](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow)
- [Vercel 请求头](https://vercel.com/docs/headers/request-headers)
