---
audience: [super_admin, project_admin]
type: how-to
since: v0.5.0
status: stable
last_reviewed: 2026-06-10
---

# 用户与权限管理

通过侧边栏 **管理 → 用户与权限** 进入用户管理（`/users`）。本页同时承载用户、用户组、邀请、API Key、权限矩阵等管理入口。

## 角色概览

平台五种内置角色（`apps/web/src/constants/roles.ts`，显示名取自 `ROLE_LABELS`）：

| 角色值 | 显示名 | 主要能力 |
|---|---|---|
| `super_admin` | 超级管理员 | 全平台所有功能；唯一可查看 `/admin/health`、做系统设置、查看全平台审计日志 |
| `project_admin` | 项目管理员 | 创建/管理项目；可见自己项目内成员，可编辑标注员 / 质检员 |
| `reviewer` | 质检员 | 在项目内做质检审核；不能改 schema、不能踢人 |
| `annotator` | 标注员 | 仅完成被分派的任务 |
| `viewer` | 观察者 | 只看不动；常用于客户演示账号 |

权限映射在 `ROLE_PERMISSIONS`（`apps/web/src/constants/permissions.ts`）。

## 谁能编辑谁

`EditUserModal` 中 actor.role × target.role 矩阵如下（前端 `ASSIGNABLE_ROLES_BY_ACTOR`）：

|        | super_admin | project_admin | reviewer | annotator | viewer |
|---|---|---|---|---|---|
| **super_admin 操作** | ✅ 全部 | ✅ | ✅ | ✅ | ✅ |
| **project_admin 操作** | ❌ | ❌ | ✅ | ✅ | ❌ |
| **reviewer / annotator** | ❌ | ❌ | ❌ | ❌ | ❌ |

> super_admin 与 project_admin 之间不能互降；项目管理员只能管理质检员和标注员。

## 列表与筛选

主区域是用户卡片列表：

- 顶部 4 张统计卡：**团队成员**（活跃）/ **角色组** / **数据组** / **本周活跃**
- Tab：`成员 (N)` / `角色 (N)` / `数据组 (N)` / `邀请记录`
- 搜索框按名字、邮箱模糊匹配
- 卡片右上角角色徽标用不同颜色区分（super_admin 红色、project_admin 蓝色 …）

## 邀请新用户

点击右上角 **邀请成员** 按钮打开 `InviteUserModal`：

1. 填写**邮箱** + **角色**（无姓名字段，姓名由被邀请人注册时自填）
2. 可选填写**数据组**（直接入组，若组名不存在则自动创建）
3. 点击确认后生成一次性邀请链接（落库到 `invitations` 表），**页面仅显示一次明文链接**，平台不代发邮件
4. 链接有效期默认 7 天（由 `invitation_ttl_days` 系统设置控制）

邀请记录可在 **邀请记录** tab 中跟踪、重发、撤销。

## 编辑用户

点击用户卡片打开 `EditUserModal`（`EditUserModal` 仅支持改角色 + 调整所属数据组）：

- 切换 **角色**（受 actor.role × target.role 矩阵限制，邮箱只读不可改）
- 更改所属**数据组**
- 一键**停用**：直接将 `is_active` 置为 false，用户立即无法登录（停用即时生效，无审批流）
- 一键**解封**：重新激活停用账号

::: warning 停用 ≠ 删除
平台支持**软删除**（`DELETE /api/v1/users/{user_id}`），但该用户若仍有待处理任务则会返回 409，需先将任务转交他人。停用不删除历史数据；删除同样保留标注、审核历史（通过 `ON DELETE SET NULL` 保留外键引用）。
:::

### 管理员重置密码

超级管理员可通过 `POST /api/v1/users/{user_id}/admin-reset-password` 为他人生成临时密码，记录 `user.password_admin_reset` 审计事件。前端在用户卡片的 ⋯ 菜单中提供此入口。

## 用户组（v0.10+）

用户组是给项目和 batch 派题用的批量选择器：

- 在 **数据组** tab 中创建组、添加成员
- 邀请时可直接指定 `group_name` 将新用户加入组
- 批次分配时按组整体分派

> 注意：**项目设置 → 成员** 里添加成员是逐个添加，不支持「一次添加整个组」；批次分配也是按 group 名称筛选再选择成员，而非将整个 group 直接指定为批次负责人。

组成员变化会即时影响新派题，已发出的 task 不会重新分配。

## API Key

每个用户都可以为自己生成 API Key（受角色权限继承）。超管可以为他人生成、撤销 API Key：

- 卡片右上角的 ⋯ 菜单 → **API Keys**
- 创建时仅返回明文 token 一次，前端应立即复制；token 格式为 `ak_` 前缀 + 32 字符 URL-safe base64
- **权限 scope**：可勾选「完全访问（full-access）」一键全权，或选细分 scope（标注读/写、数据集读、预测读）限制范围；scope 自 v0.15.11 起在路由层真正强制（缺权限 → 403）
- **有效期**：创建时可选 30/90/365 天 / 永不过期 / 自定义天数；过期后认证失败
- **轮换 / 编辑**：列表行可轮换（换新明文、旧的立即失效）或编辑名称 / scope / 有效期
- 调用时通过标准 HTTP Bearer 头携带：`Authorization: Bearer ak_xxxxx`

详细 API 见 [认证](../../api/guides/auth#api-key)。

## 权限矩阵预览

侧边栏 **用户与权限** → **角色** tab 展示 `PERMISSION_GROUPS × ROLE_PERMISSIONS` 表，便于核对。实际权限名（来自 `apps/web/src/constants/permissions.ts`）：

- 项目管理：`project.create` / `project.edit` / `project.delete` / `project.transfer` / `project.export`
- 任务：`task.assign` / `task.annotate` / `task.review` / `task.approve` / `task.reject`
- 用户：`user.list` / `user.invite` / `user.edit-role` / `user.export`
- 数据：`dataset.create` / `dataset.delete` / `dataset.link`
- 安全与模型：`audit.view` / `ml-backend.manage` / `storage.manage` / `settings.edit`

## 后端 API 与代码

- 路由 `apps/api/app/api/v1/users.py`（用户 CRUD）、`apps/api/app/api/v1/groups.py`（用户组）、`apps/api/app/api/v1/invitations.py`（邀请）、`apps/api/app/api/v1/api_keys.py`（API Key）
- 前端组件位于 `apps/web/src/components/users/`
