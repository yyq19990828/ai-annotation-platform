---
audience: [annotator, reviewer, project_admin, super_admin]
type: reference
since: v0.6.0
status: stable
last_reviewed: 2026-05-29
---

# 设置页

侧边栏底部 **设置**（`/settings`）是所有用户都可见的个性化入口。左侧导航按角色显示 4 ~ 5 个分区：

| 分区 | 谁能看 | 主要内容 |
|---|---|---|
| 个人资料 | 所有人 | 姓名、邮箱、密码、注销账号 |
| 标注偏好 | 所有人 | 工作台默认值（标签颜色、自动保存周期等） |
| 我的反馈 | 所有人 | 自己提交的 BUG 工单与状态 |
| 通知偏好 | 所有人 | 单独静音 in-app / 邮件通知 type |
| **系统设置** | **仅 super_admin** | SMTP、限流、CAPTCHA、平台水印等全局配置 |

实现位于 `apps/web/src/pages/Settings/SettingsPage.tsx`。

## 个人资料

- **显示名 / 邮箱**：可修改；改邮箱需要重新验证（写到 `pending_email`，发确认邮件）
- **修改密码**：需要旧密码，新密码强度规则与注册一致（≥ 8 字符，含字母 + 数字）
- **请求停用账号**：写入 `deactivation_requested_at`，下次登录后流程化进入注销；在窗口期内可用「取消停用」撤销
- **当前角色**：只读，不能自助升级

::: warning 注销 ≠ 物理删除
所有历史标注、审核、评论都通过 user_id 关联，注销后这些记录仍然存在但显示为「已注销用户」。
:::

## 标注偏好（Workbench）

驱动工作台的本地存储配置（`useWorkbenchConfig`）：

- **自动保存周期**：默认 30s，可调 10 ~ 120s
- **标签颜色策略**：固定调色板 / 按类别哈希 / 与项目模板一致
- **快捷键方案**：标准 / Vim 风格（开发中）
- **缩略图缩放档位**

修改即时生效，不需要重登。

## 我的反馈

罗列当前用户通过右下角浮动按钮提交过的 BUG 工单，按时间倒序。每条显示 `display_id` + 标题 + 严重度 + 状态。

点击展开查看：

- 当前 resolution（如果超管已填）
- 所有评论时间线
- 是否可重开（仅 `fixed` / `wont_fix` 终态可重开，重开后回到 `triaged`）

对应超管侧操作详见 [BUG 反馈管理](../superadmin/bug-management)。

## 通知偏好

逐 type 切换 **in-app** + **email** 两个开关。所有已知 type 见 [通知中心](./notifications)。

::: tip 静音 = 全链路屏蔽
静音不只是关闭 WS 推送，而是 `NotificationService` 在写表前先查偏好，被静音的 type 不写表、不发 PubSub、邮件也不发。
:::

## 系统设置（super_admin 专属）

只对 super_admin 显示，对应 `app/services/system_settings_service.py` 的全局配置。常用条目：

- **SMTP 服务器**：host / port / username / password / TLS；底部「发送测试邮件」按钮验证连通
- **CAPTCHA 阈值**：连续失败次数（默认 5）、计数窗口（默认 3600s / 1 小时）
- **登录限流**：5 / min
- **存储连接器白名单**：CIDR + 域名 CSV，覆盖 `CONNECTOR_HOST_ALLOWLIST` env 默认值
- **AI 预标注全局开关**

修改后立即落 DB，无需重启 API 容器。

> 部分配置（如 `SECRET_KEY`、`DATABASE_URL`）属于启动时常量，不能在本页修改；改这些必须改 `.env` 后重启。详见 [环境变量参考](../../dev/reference/env-vars)。
