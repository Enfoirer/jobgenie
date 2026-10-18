# 文件上传与下载加固

## 上传规则

新上传支持 PDF、DOCX、PNG、JPG/JPEG，每次一个文件，最大 4 MiB（界面简写为 4 MB）。不再接受旧 DOC、DOCM、HTML、SVG、脚本或一般 ZIP。旧 DOC 可另存 PDF/DOCX 后上传；已保存的旧文件不会被删除。

前后端共用扩展名、文件名、大小和声明 MIME 校验。服务端另外进行文件签名检查：PDF 头部/结束标识、PNG 头部/IHDR/结束标识、JPEG 首尾标识。空 MIME 或 application/octet-stream 的浏览器上传仍必须通过内容校验。具体 MIME 与扩展名冲突则拒绝。

DOCX 使用固定版本 yauzl 3.4.0 校验 ZIP 容器：检查 Word 必要部件及格式标识，拒绝宏、ActiveX、嵌入对象、加密项、重复/非法路径和符号链接。逐个读取解压流，最多 512 项、单项最多 16 MiB、总解压最多 32 MiB；必需 XML 最多 8 MiB，不解析 DTD/外部实体。不将解压内容写入磁盘。

这些是格式身份和容器边界校验，不是完整 PDF/图片解析、杀毒扫描或文档内容净化。具有合法文件签名的复杂恶意文档不能靠白名单完全识别。因此所有文件都继续使用强制附件下载，不将内容在应用域名下渲染。

上传接口先鉴权和来源校验，再读取请求。除 Content-Length 预检外，读取过程中还累计实际字节；请求体上限是 4 MiB + 64 KiB（multipart 开销），不能通过省略或伪造长度绕过。只允许一个 file 字段；文本字段、额外字段、重复文件、空文件和非法文件名均拒绝。

4 MiB 文件上限为 [Vercel 的 4.5 MB 请求/响应限制](https://vercel.com/docs/functions/limitations#request-body-size) 留出 multipart 开销。原有 10 MB 页面文案已同步修正。历史大文件仍受部署平台响应限制，本次没有迁移到对象存储。

## 下载和存储

- 保留原 File 模型与 MongoDB files 集合；共享模型替代三个接口中重复的 Schema。
- 文件正文默认不参与查询，只在下载时显式选取。列表响应不含文件内容和用户 ID。
- 列表、下载、删除均按当前 userId 查询。其他用户的文件、错误 ID、不存在 ID 统一返回 404；未登录返回 401。
- 下载和删除正确等待 Next.js 异步路由 params。删除使用带所有权条件的单次原子操作。
- 所有文件（包含历史 HTML/SVG/旧 DOC）响应 `Content-Type: application/octet-stream` 和 `Content-Disposition: attachment`，忽略原来可伪造的 MIME。
- 返回 `X-Content-Type-Options: nosniff`、`Cache-Control: private, no-store`、`Content-Security-Policy: sandbox; default-src 'none'; frame-ancestors 'none'`、`X-Frame-Options: DENY` 和 `Cross-Origin-Resource-Policy: same-origin`。
- 下载名使用 ASCII fallback 和 UTF-8 filename*，保留中文文件名；路径、控制字符、双向字符和保留符号不会进入响应头。
- 原始供应商/数据库错误不向客户端返回，移除上传流程中的用户地址、文件名和文件列表调试日志。

## 页面

上传选择器声明白名单并移除误导性的多选；拖入多个文件会明确提示，不再只保存第一个。类型、内容、大小的拒绝原因会展示给用户；失败后可重新选择同一个文件。

移除内容预览。文件列表提供 Details、Download 和 Delete；详情仅展示元数据，使用共享无障碍弹窗，不加载 iframe、object、embed 或图片内容。增加列表刷新及加载失败后的重试入口。

## 验收

- `npm test`：全部 222 项通过，新增 20 项文件相关测试，包括格式身份、MIME 冲突、扩展名伪装、空/超大文件、非法文件名、ZIP 炸弹边界、DOCX 宏/加密/路径、multipart 边界、鉴权顺序、所有权、响应头、中文文件名和旧内容安全下载。
- `npm run build` 与相关 ESLint 检查通过。本机已有 Next 15.3.1，锁文件固定的生产版本仍是 15.5.28；Vercel 按锁文件构建。
- `npm run test:ui` 使用临时 MongoDB 和独立 Chrome：实际上传 PDF/DOCX、拒绝伪装 HTML、大小反馈、元数据弹窗、刷新持久化、中文附件下载、旧 HTML 直接导航触发下载且不执行、越权及删除、390px 页面布局；同时回归已有编辑、日程、提醒、统计和登录功能。
- 浏览器下载文件存放临时目录并在验收结束清理，不读取或修改生产用户文件。

实现参考 [OWASP File Upload Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html) 的多层校验原则，以及 [yauzl 官方接口说明](https://github.com/thejoshwolfe/yauzl)。
