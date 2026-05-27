# Changelog

本文件记录 AI 标注平台的所有重要变更。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

历史版本详情见 [`docs/changelogs/`](docs/changelogs/)：

| 版本组 | 文件 |
|--------|------|
| 0.11.x | [docs/changelogs/0.11.x.md](docs/changelogs/0.11.x.md) |
| 0.10.x | [docs/changelogs/0.10.x.md](docs/changelogs/0.10.x.md) |
| 0.9.x | [docs/changelogs/0.9.x.md](docs/changelogs/0.9.x.md) |
| 0.8.x | [docs/changelogs/0.8.x.md](docs/changelogs/0.8.x.md) |
| 0.7.x | [docs/changelogs/0.7.x.md](docs/changelogs/0.7.x.md) |
| 0.6.x | [docs/changelogs/0.6.x.md](docs/changelogs/0.6.x.md) |
| 0.5.x | [docs/changelogs/0.5.x.md](docs/changelogs/0.5.x.md) |
| 0.4.x | [docs/changelogs/0.4.x.md](docs/changelogs/0.4.x.md) |
| 0.3.x | [docs/changelogs/0.3.x.md](docs/changelogs/0.3.x.md) |
| 0.2.x | [docs/changelogs/0.2.x.md](docs/changelogs/0.2.x.md) |
| 0.1.x | [docs/changelogs/0.1.x.md](docs/changelogs/0.1.x.md) |


---

## 最新版本

## [0.12.0] - 2026-05-27

> **开放注册邮箱验证。** 开放注册新增邮箱验证环节：验证开关按环境派生（production 默认开、dev/staging 默认关，可用 `REQUIRE_EMAIL_VERIFICATION` 显式覆盖）。开关打开时注册后须点邮件链接验证才能登录；邀请注册与管理员建号恒视为已验证。复用既有 SMTP 底座与 password-reset token 范式，未引入新依赖。

### Added

- **邮箱验证流程**: `User.email_verified_at` 字段 + `email_verification_tokens` 表（24 小时一次性 token）；新增 `POST /auth/verify-email`（消费 token）与 `POST /auth/send-verification-email`（重发，防枚举恒 202）。`register-open` 在验证开关打开时不再自动登录，返回 `email_verification_required=true` 且 `access_token=null`，并发送验证邮件；`login` 对未验证账户返回 `400 {code: "email_not_verified"}` gate。→ [plan](docs/plans/2026-05-27-v0.12.0-email-verification.md)
- **前端验证 UI**: RegisterPage 注册后切到「验证邮件已发送」态（含重发按钮 + 60s 倒计时）；新增 `/verify-email` 落地页消费 token；LoginPage 识别 `email_not_verified` 后展示「重新发送验证邮件」入口。
- **环境派生配置**: 新增 `REQUIRE_EMAIL_VERIFICATION` env（留空按环境派生），经 `settings.email_verification_required` property 统一读取。存量用户迁移时回填 `email_verified_at = created_at`，避免上线即被锁。

<!-- 0.12.x 版本变更按版本段追加到本区；开始开发 0.13 后整体移到 docs/changelogs/0.12.x.md -->
