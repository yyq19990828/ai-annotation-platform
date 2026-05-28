---
audience: [super_admin, project_admin]
type: how-to
since: v0.5.0
status: stable
last_reviewed: 2026-05-29
---

# 用户与权限管理

通过侧边栏 **管理 → 用户与权限** 进入用户管理（`/users`）。本页同时承载用户、用户组、邀请、API Key、权限矩阵等管理入口。

## 角色概览

平台五种内置角色（`apps/web/src/constants/roles.ts`）：

| 角色 | 主要能力 |
|---|---|
| `super_admin` 超级管理员 | 全平台所有功能；唯一可注册 ML Backend、查看 `/admin/health`、处理 BUG 反馈、做系统设置 |
| `project_admin` 项目管理员 | 创建/管理项目；可见自己项目内成员，可编辑标注员 / 审核员 |
| `reviewer` 审核员 | 在项目内做质检审核；不能改 schema、不能踢人 |
| `annotator` 标注员 | 仅完成被分派的任务 |
| `viewer` 只读 | 只看不动；常用于客户演示账号 |

权限映射在 `ROLE_PERMISSIONS`（`apps/web/src/constants/permissions.ts`）。

## 谁能编辑谁

|        | super_admin | project_admin | reviewer | annotator | viewer |
|---|---|---|---|---|---|
| **super_admin 操作** | ✅ 全部 | ✅ | ✅ | ✅ | ✅ |
| **project_admin 操作** | ❌ | ❌ | ✅ | ✅ | ❌ |
| **reviewer / annotator** | ❌ | ❌ | ❌ | ❌ | ❌ |

> super_admin 与 project_admin 之间不能互降；项目管理员只能管理审核员和标注员。

## 列表与筛选

主区域是用户卡片列表：

- 顶部 4 张统计卡：总用户、在线、本周新增、被停用
- Tab：`所有用户` / `用户组` / `邀请记录`
- 搜索框按名字、用户名、邮箱模糊匹配
- 卡片右上角角色徽标用不同颜色区分（super_admin 红色、project_admin 蓝色 …）

## 邀请新用户

点击右上角 **邀请用户** 按钮打开 `InviteUserModal`：

1. 填写姓名 + 邮箱 + 默认角色
2. 选择是否生成一次性激活链接（不发邮件场景）或走 SMTP 发邀请邮件
3. 点击确认后链接落库到 `invitations` 表，用户点击链接完成注册

邀请记录可在 **邀请记录** tab 中跟踪、重发、撤销。SMTP 配置必须先在 **设置 → 系统设置** 中完成。

## 编辑用户

点击用户卡片打开 `EditUserModal`：

- 切换 **角色** （受 actor.role × target.role 矩阵限制）
- 修改 **显示名** / 邮箱
- 一键 **停用**（写入 `deactivation_requested_at`，下次登录时会走 `user.deactivation_completed` 流程）
- 一键 **解封**

::: warning 停用 ≠ 删除
平台**不支持物理删除用户**——所有标注、审核记录都通过 user_id 关联。停用会让该用户无法登录但保留所有历史轨迹。
:::

## 用户组（v0.10+）

用户组是给项目和 batch 派题用的批量选择器：

- 在 **用户组** tab 中创建组、添加成员
- 在 **项目设置 → 成员** 里可一次添加整个组
- 在 **批次分配** 里可把一个 group 整体派给某个 batch

组成员变化会即时影响新派题，已发出的 task 不会重新分配。

## API Key

每个用户都可以为自己生成 API Key（受角色权限继承）。超管可以为他人生成、撤销 API Key：

- 卡片右上角的 ⋯ 菜单 → **API Keys**
- 创建时仅返回明文一次，前端应立即复制
- 调用时通过 HTTP header `X-API-Key: <key>` 携带

详细 API 见 [认证](../../api/guides/auth#api-key)。

## 权限矩阵预览

侧边栏 **用户与权限** 顶部有 **查看权限矩阵** 链接，会展开 `PERMISSION_GROUPS × ROLE_PERMISSIONS` 表，便于核对：

- 项目管理：`project.create / project.edit / project.delete / project.batch.*`
- 数据：`dataset.upload / dataset.export`
- 模型：`ml-backend.manage / model-market.publish`
- 安全：`user.invite / user.deactivate / audit.read`

## 后端 API 与代码

- 路由 `apps/api/app/api/v1/users.py`（用户 CRUD）、`apps/api/app/api/v1/groups.py`（用户组）、`apps/api/app/api/v1/invitations.py`（邀请）
- 前端组件位于 `apps/web/src/components/users/`
