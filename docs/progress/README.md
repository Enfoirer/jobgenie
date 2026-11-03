# 项目进展

更新日期：2026-11-03（Asia/Shanghai）。

GitHub 同步记录：2026-11-03 已将 Safari 分享（68c1235）、材料关联（a0d5882）和进展回补（b4e9781）推送至 `origin/main`，并直接核对远端 SHA。后续功能交付默认包含英文 commit、进展更新、GitHub 推送和远端核对。

[项目进展与甘特图](JobGenie项目进展.xlsx) 为仓库内的正式进展表，包含「进度甘特图」和「更新日志」。父工作区 outputs 中原有表格已同步更新。每次功能或修复完成并验收后，更新任务状态、完成度和日期，追加验收日志，并提交英文 Git commit。

任务编号保持不变，历史日志不覆盖。里程碑日表示完成日，不表示实际开发工时；登记日期表示记录或补录日。验收中的累计测试数量不可相加，生产部署与真机/TestFlight 验收分别记录。

## 2026-11-03 补录

原表登记了 JG-001 至 JG-014。本次核对 Git 提交和验收文档后补齐 8 项，共 22 项已完成的代码或设计里程碑，甘特图扩展到 2026-11-03。

| 编号 | 里程碑 | 完成日期 | 提交与证据 |
| --- | --- | --- | --- |
| JG-015 | 邮件可靠入库与失败重试 | 2026-10-17 | [1c61989](https://github.com/Enfoirer/jobgenie/commit/1c61989831a7402390d7857adac79c3c96a35812)，[可靠同步说明](../mail-sync-reliability.md) |
| JG-016 | 邮件分页续取与统一同步入口 | 2026-10-17 | [80faa60](https://github.com/Enfoirer/jobgenie/commit/80faa604561e30a69f48ea959a139f4c1b05a260)，[同步说明](../mail-sync-reliability.md) |
| JG-017 | Vercel 部署阻断修复 | 2026-10-17 | [cf0ea70](https://github.com/Enfoirer/jobgenie/commit/cf0ea70440766d88e3fb7e76353dd9cac4c09c4e) |
| JG-018 | AI 字段提取、申请匹配与人工确认 | 2026-10-17 | [f9ab75f](https://github.com/Enfoirer/jobgenie/commit/f9ab75fd91ea3c62a211b1b7223fd25f6c9018f0)，[验收](../email-matching-acceptance.md) |
| JG-019 | 英文 iPhone Figma 原型归档 | 2026-10-29 | [8fe3124](https://github.com/Enfoirer/jobgenie/commit/8fe312457ed508c82fe21ca997d0ce8361b46eb8)，[设计记录](../design/ios/CHANGELOG.md) |
| JG-020 | 网页与 iOS 批量操作 | 2026-10-30 | [2dd2906](https://github.com/Enfoirer/jobgenie/commit/2dd290615f234dd389123f0a28988296a8d4bb9a)，[验收](../bulk-actions-acceptance.md) |
| JG-021 | Safari 分享岗位与离线草稿 | 2026-11-01 | [68c1235](https://github.com/Enfoirer/jobgenie/commit/68c1235ae789d19011d2c3352cf96d3dd70d4b81)，[验收](../ios-share-acceptance.md) |
| JG-022 | 网页与 iOS 申请材料关联及版本快照 | 2026-11-03 | [a0d5882](https://github.com/Enfoirer/jobgenie/commit/a0d5882b14f1b56d9b31f61e8476f77e44c8e437)，[验收](../application-documents-acceptance.md) |

同时追加了两条后续记录：JG-020 于 2026-10-30 的 Vercel 部署和线上只读检查通过；JG-014 当时附件未关联申请的边界，已由 JG-022 补齐。

## 当前验收边界

- JG-022：272 项后端测试、80 项 iOS 单元测试通过，2 项环境相关测试跳过；相关真实接口、浏览器和 iPhone UI 验收通过。材料关联后端尚待生产部署。
- JG-021：Safari 分享扩展和隔离后端完整流程已验收；真机/TestFlight 仍需开发者 Team、App Group 与签名配置。
- iOS 后台 APNs 推送尚未接入；真实邮箱供应商同意流程、第三方文件提供商及真机验收的既有边界继续保留。
- 本次进展回补未重新运行项目测试，引用对应功能完成时已记录的结果。表格已检查任务数量、历史留存、甘特日期/状态联动及公式错误。
