---
audience: [dev]
type: reference
since: v0.1.0
status: stable
last_reviewed: 2026-09-09
---

# 认证

## 登录

```http
POST /api/v1/auth/login
Content-Type: application/json

{ "email": "alice@example.com", "password": "...", "captcha_token": null }
```

成功响应：

```json
{
  "access_token": "<jwt>",
  "token_type": "bearer"
}
```

`access_token` 默认有效期 **24 小时**（`access_token_expire_minutes` 配置，默认 `60 * 24`）。登录后通过 `/api/v1/auth/me` 获取当前用户；续期使用同一个 Bearer token。

## 携带 token

```http
GET /api/v1/auth/me
Authorization: Bearer <access_token>
```

## 账号偏好与命名布局预设

`GET /api/v1/auth/me/preferences` 读取当前账号偏好，`PATCH /api/v1/auth/me/preferences` 只提交要修改的子树。工作台布局位于 `workbench.layout.workspace`：`contexts` 是可选 map，每个 key 是 `annotate|review × image|video|3d` 中的一项，只提交某个 context 时会原子替换该快照，不会删除其他 context。写入 `contexts` 必须同时携带当前 `engine`；只有下述预设专用 PATCH 可以省略它。

`namedPresets` 与 `contexts` 并列，是最多 5 条的命名布局 map。每条值在布局快照信封上增加 `name`（1–40 个字符）和 `context`，名称在账号内唯一。该 map 与 `contexts` 的合并规则不同：只要 PATCH 中出现 `namedPresets`，服务端就用它整份替换存量 map，省略某个 ID 即删除该预设。因此客户端增加、重命名或删除一条时，必须带上所有需保留的条目，但不带 `contexts`，也不需要重写 `engine`：

```http
PATCH /api/v1/auth/me/preferences
Authorization: Bearer <access_token>
Content-Type: application/json

{
  "workbench": {
    "layout": {
      "workspace": {
        "namedPresets": {
          "preset-id": {
            "name": "审核宽讨论",
            "context": "review:image",
            "schemaVersion": 5,
            "snapshot": { "layout": {}, "returns": {} }
          }
        }
      }
    }
  }
}
```

上例的 `snapshot` 仅展示字段位置，实际值必须满足 OpenAPI 中完整的 `WorkspaceSnapshot` 结构。若 GET 返回当前版本无法解析的存量预设或更新版 `engine`，旧客户端不得重写其内容或引擎标记；预设整表 PATCH 可以把同 ID、同内容的 opaque 条目原样带回，也可以省略它来删除。新建或修改为当前 schema 无法验证的条目返回 `422`，显式把更新版引擎改写为当前引擎返回 `409 layout_engine_downgrade`。

## 项目邀请与注册

管理角色通过 `POST /api/v1/users/invite` 提交 `email`、`role`、可选 `group_name` 和 `project_id`。省略项目时保留原有新账号邀请；指定项目时只允许标注员、审核员或观察者角色，已有账号的全局角色必须一致。响应中的 `invite_url` 可直接复制使用。

公开的 `GET /api/v1/auth/invitations/{token}` 校验邀请并返回目标项目摘要。新账号通过 `POST /api/v1/auth/register` 提交 `token`、`name`、`password`，账号、用户组和项目成员关系在同一事务内建立。已有账号先登录，再调用：

```http
POST /api/v1/auth/invitations/accept
Authorization: Bearer <access_token>
Content-Type: application/json

{ "token": "<invitation-token>" }
```

接口核对登录邮箱、账号启用状态、全局角色、邀请人当前管理权限及目标项目；不会静默合并账号或更改角色。项目删除、邀请过期、撤销或重复接受返回可解释的错误，失败不留下半完成的账号和项目关系。

接受响应的 `acceptance` 包含 `project_id`、`project_name`、`project_member_role`、`next_action`、`next_action_label`、`responsible_person_name` 和 `active_batch_count`。客户端据此显示开始工作或等待分派；加入项目不代表已有激活批次。

## 账号恢复

忘记密码时提交邮箱地址：

```http
POST /api/v1/auth/forgot-password
Content-Type: application/json

{ "email": "alice@example.com", "captcha_token": null }
```

接口对已注册和未注册地址都返回 `202` 及相同提示。账号查询和邮件投递在响应后执行，SMTP 等待不会延迟该响应或阻塞其他请求。已注册账号会通过系统 SMTP 设置发送一小时有效的重置链接；SMTP 未配置或发送失败时，服务端不会把 token 写入日志，管理员可在设置页发送测试邮件定位问题。未收到邮件时可重新申请或由管理员协助恢复。

用户提交邮件中的 token 设置新密码：

```http
POST /api/v1/auth/reset-password
Content-Type: application/json

{ "token": "<one-time-token>", "new_password": "..." }
```

密码为 8–128 位，并且必须包含大写字母、小写字母和数字。token 过期、消费后或账号处于停用状态时不能使用；重置成功会使该账号已有的 JWT 会话失效，用户需要使用新密码重新登录。

管理员无法发送邮件时，可以先在 `/settings` 的系统设置中检查 `frontend_base_url` 与 SMTP host / port / 发件人，并使用「发送测试邮件到我」定位配置问题。使用管理员生成的临时密码登录后，界面会引导用户到设置页改密。

## 停用、交接与恢复

以下接口要求超级管理员或目标用户所在项目的项目管理员。项目管理员只能处理其管理范围内的标注员和审核员；跨越管理范围、操作自己和停用最后一名超管均会被拒绝。

| 方法与路径                                       | 行为                                                     |
| ------------------------------------------------ | -------------------------------------------------------- |
| `GET /api/v1/users?status=active\|inactive\|all` | 按启用状态过滤，缺省 `active`，仍返回用户数组            |
| `GET /api/v1/users/{id}/offboarding-preview`     | 读取项目职责、批次、各状态任务、锁、API Key 和接收人选项 |
| `POST /api/v1/users/{id}/offboarding`            | 重新核对预览，交接并停用，或紧急停用后保留待交接事项     |
| `POST /api/v1/users/{id}/reactivate`             | 恢复明确可恢复的停用账号                                 |

预览返回 `preview_version`、`generated_at`、`projects`、`api_keys`、`blockers` 和 `can_commit`。每个项目通过 `roles.owner`、`roles.annotator`、`roles.reviewer` 分开描述职责和 `receiver_options`，客户端应使用这些实际选项。

```json
{
  "preview_version": "<version-from-preview>",
  "reason": "人员离职，职责已核对",
  "mode": "handoff",
  "projects": [
    {
      "project_id": "<project-uuid>",
      "annotator_receiver_id": "<annotator-uuid>"
    }
  ]
}
```

每项只提交该项目需要交接的职责，也可分别使用 `owner_receiver_id`、`reviewer_receiver_id`。`mode=emergency_suspend` 允许暂不提供接收人，响应中的 `unresolved` 列出后续事项。管理员可以为该停用账号重新获取预览，再以 `handoff` 完成交接。

确认时会重新校验接收人启用状态、角色和项目权限，并在同一数据库事务内更新用户、批次、可继续流转的任务、项目负责人、锁和审计。预览过期、接收人资格变化或相关资源正在写入时返回 `409`，客户端须刷新预览并让管理员重新确认。交接不改写已完成任务的历史归属。

`UserOut` 增加 `disabled_kind`、`disabled_at`、`disabled_by`、`disabled_reason`。`suspended` 和 `emergency_suspended` 可以恢复；`deleted`、`historical_unknown` 不能恢复。迁移前无法可靠识别停用来源的账号归入 `historical_unknown`。恢复请求可带 `{"reason":"返岗"}`；恢复不会拿回已交接职责、复活旧会话或恢复已撤销的 API Key。集成负责人应为接收账号另行创建密钥。

原有删除入口继续具有独立语义，参见[人员管理](../../user-guide/superadmin/user-management.md)。

## 管理查询与批量操作

超级管理员可以查看全局数据；项目管理员的管理接口只返回自己负责项目中的成员和自己账号。分页、统计、导出和批量操作使用同一范围规则。旧的用户、数据组和邀请数组接口保持兼容。

| 方法与路径                                                                                | 行为                                                                                          |
| ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `GET /api/v1/users/query?page=1&page_size=50&project_id=&group_id=&role=&status=&search=` | 返回 `{items,total,page,page_size,pages}`；`status` 为 `active`、`inactive` 或 `all`          |
| `GET /api/v1/users/stats`                                                                 | 接受与用户分页相同的过滤参数，返回 `total`、`online`、`weekly_active`                         |
| `GET /api/v1/users/export?format=csv\|json`                                               | 按同一过滤和权限范围导出并写入审计                                                            |
| `GET /api/v1/groups/query?page=1&page_size=50&search=`                                    | 分页返回数据组及启用成员数                                                                    |
| `GET /api/v1/invitations/query`                                                           | 支持 `status`、`scope`、`project_id`、`role`、`email`、`search`、`created_from`、`created_to` |
| `GET /api/v1/invitations/stats` / `GET /api/v1/invitations/export`                        | 使用邀请列表的同一过滤和权限范围                                                              |
| `POST /api/v1/invitations/{id}/send-email`                                                | 使用当前有效 token 发送邀请邮件；不轮换链接，SMTP 失败返回 `502` 且邀请保持有效               |

批量邀请先调用 `POST /api/v1/users/bulk-invite/preview`，确认每行的校验结果后调用 `POST /api/v1/users/bulk-invite`。批量接口为每行建立独立保存点；成功行提交，失败行返回 `retryable` 和错误信息，客户端可以只重试失败行。数据组批量替换使用 `POST /api/v1/users/groups/bulk/preview` 和 `POST /api/v1/users/groups/bulk`，`group_id=null` 表示清除数据组。

项目批次分派使用 `POST /api/v1/projects/{project_id}/batches/distribution-preview` 和 `POST /api/v1/projects/{project_id}/batches/distribution-apply`。预览默认只处理尚未分派的职责；将 `only_unassigned=false` 才会显示并执行覆盖已有分派的影响。预览返回逐批次映射、实际 `task_count`、每位接收人的新增待办和已有待办，以及 `preview_version`。执行必须原样携带版本；批次或任务负载已变化时返回 409，客户端应重新预览。旧的 `/distribute-batches` 调用保持兼容。

任务负载按条数计算：标注待办包括待开始、进行中和退回，审核待办只包括审核中，已通过任务不计入待办；已有待办汇总该成员在各项目中的分派。任务类型、难度和工时不在这一数字中折算。

用户角色变更前可调用 `GET /api/v1/users/{user_id}/role/preview?role=reviewer` 查看项目、批次和任务影响。平台角色对全部项目生效，已有成员身份和负责人不自动改写；项目管理员仅看到自己负责项目的详情，其他项目只返回数量和提醒。预览不向权限范围外的目标回显用户信息。

## 刷新

```http
POST /api/v1/auth/refresh
Authorization: Bearer <access_token>
```

无需 body。可以使用过期不超过 7 天的 JWT 换取新 `access_token`；已登出、代际号失效、账号停用或超过宽限期时返回 `401`。

## 登出

```http
POST /api/v1/auth/logout
Authorization: Bearer <access_token>
```

撤销当前 JWT，前端同步清除本地认证状态。

## CAPTCHA

同 IP 连续登录失败达到阈值（`login_captcha_threshold`，默认 **5 次**）后，下一次登录必须带 CAPTCHA：

```json
{
  "email": "alice@example.com",
  "password": "...",
  "captcha_token": "<turnstile-token>"
}
```

开启 Turnstile 后由前端验证组件获取 `captcha_token`。验证失败时接口返回 `captcha_required`，响应头 `X-Login-Failed-Count` 提供失败次数。

失败计数按 IP 单键 (`login_failed:{ip}`)，窗口长度由 `login_failed_window_seconds` 配置（默认 **3600 秒 / 1 小时**）。登录成功后立刻清空计数。

## API Key

适合脚本 / 自动化场景，长期凭证。token 形如 `ak_<随机串>`，仅创建瞬间返回一次明文：

```http
GET    /api/v1/me/api-keys            # 列出（不含明文，含已撤销）
POST   /api/v1/me/api-keys            # 创建（仅返回明文一次）
PATCH  /api/v1/me/api-keys/:id        # 改名 / 改 scope / 改有效期
POST   /api/v1/me/api-keys/:id/rotate # 轮换（换新明文，旧的立即失效）
DELETE /api/v1/me/api-keys/:id        # 撤销（软删，保留审计）
```

调用时作 Bearer token 发送（与 JWT 同一 header，后端按 `ak_` 前缀区分）：

```http
GET /api/v1/projects
Authorization: Bearer ak_xxxxxxxxxxxx
```

**有效期**：创建时可选 `expires_in_days`（省略 = 永不过期）；过期后认证返回 401。

**权限 scope**：

- key 的 `scopes` 在路由层经 `require_scopes` 校验；缺少所需 scope → **403**。
- 含通配 `"*"`（完全访问 / full-access）的 key 绕过 scope 校验，等同用户全权。
- 已挂强制的 scope：`annotations:read` / `annotations:write` / `datasets:read` / `predictions:read`（其余路由暂不限制）。
- ⚠️ **scope 不是只读隔离**：未挂强制的端点（含多数写操作，以及 `/ws/ml-backend-stats` 监控流）仍遵从 key 所属用户的角色——只勾读 scope 的 key 在 owner 为 super_admin / project_admin 时仍能触达 `POST /datasets`、`DELETE /projects/*` 等高危写操作。需要真正受限的程序化访问，请用低权限账号创建 key。
- JWT / 密码登录的会话不受 scope 约束（视为 full-access）。

## 错误码

| HTTP | 含义                                 |
| ---- | ------------------------------------ |
| 401  | token 缺失 / 过期 / 无效             |
| 403  | 角色权限不足                         |
| 409  | 交接预览过期、资源忙碌或状态不可恢复 |
| 422  | body 校验失败（如密码不满足规则）    |
| 429  | 限流（登录端点单独限流以防爆破）     |

## 相关

- [WebSocket token 续签](../../dev/adr/archive/0011-websocket-token-reauth)
- [安全模型](../../ops/security/)

单批次使用 `POST /api/v1/projects/{project_id}/batches/{batch_id}/assignment-preview` 预览，提交 `annotator_id`、`reviewer_id`（显式 `null` 表示清除）。确认时将同样字段和 `preview_version` 提交到 `/assignment-apply`。单批次与项目分派共用任务负载与版本校验，确认后写入分派审计。

项目分派的请求可带 `batch_ids` 限定勾选批次（最多 500 个）；不带时处理当前项目全部非归档批次。预览和执行必须传递相同选择，选中的批次被删除、归档或不属于项目时拒绝执行。
