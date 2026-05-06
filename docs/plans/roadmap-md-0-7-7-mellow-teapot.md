# v0.7.7 Plan: 开放注册 + 默认 Viewer 角色

## Context

当前平台注册方式为**纯邀请制**（admin 生成 token → 用户通过链接注册）。v0.7.7 需增加**开放注册**路径，让任何人可以自助注册，默认分配最低权限 `viewer` 角色（零写权限）。

**现状确认：**
- 超管/项目管理员变更角色 → **已完全实现**（`PATCH /users/{user_id}/role`，前端 `EditUserModal`）
- 5 种角色已定义：super_admin / project_admin / reviewer / annotator / viewer
- viewer 拥有 0 个写权限，只能查看 → 作为开放注册默认角色安全

**安全评估：默认 viewer 是否安全？**
- 是。viewer 在权限矩阵中拥有 0 个操作权限（无法创建/编辑/删除任何资源）
- 加上 rate limit（3次/分钟）+ 密码强度校验 + env 开关默认关闭，风险极低
- 最坏情况：有人批量注册 viewer 账号 → 只能看，不能改；管理员可一键 deactivate

---

## 实现方案

### Phase 1: 后端

#### 1.1 新增配置项
**File:** `apps/api/app/config.py` (line 64 附近，invitation_ttl_days 后)

```python
# v0.7.7 · 开放注册开关（默认关闭，需显式 env 开启）
allow_open_registration: bool = False
```

#### 1.2 新增 Schema
**File:** `apps/api/app/schemas/invitation.py` (追加)

```python
class OpenRegisterRequest(BaseModel):
    email: str = Field(min_length=3, max_length=255)
    name: str = Field(min_length=1, max_length=100)
    password: str = Field(min_length=8, max_length=128)
    # 复用现有 email 校验 + password strength 校验
```

#### 1.3 新增两个端点
**File:** `apps/api/app/api/v1/auth.py`

| 端点 | 方法 | 认证 | 限流 | 说明 |
|------|------|------|------|------|
| `/auth/registration-status` | GET | 无 | 无 | 前端判断是否显示注册入口 |
| `/auth/register-open` | POST | 无 | 3/min | 开放注册主端点 |

`register-open` 逻辑：
1. 检查 `settings.allow_open_registration` → 否则 403
2. 检查 email 唯一性 → 否则 409
3. 创建 User（role=viewer, is_active=True）
4. 写 audit log（detail.method = "open_registration"）
5. 签发 JWT 返回

#### 1.4 SystemSettings 暴露配置
**File:** `apps/api/app/schemas/me.py` — `SystemSettingsOut` 加 `allow_open_registration: bool`
**File:** system_settings 路由 — 传入该字段

#### 1.5 版本号
**File:** `apps/api/app/main.py` — version 改为 `"0.7.7"`

---

### Phase 2: 前端

#### 2.1 API 层
**File:** `apps/web/src/api/invitations.ts` (或 auth 相关文件)

新增：
- `getRegistrationStatus()` → `GET /auth/registration-status`
- `openRegister(payload)` → `POST /auth/register-open`

#### 2.2 Hooks
**File:** `apps/web/src/hooks/useInvitation.ts`

新增：
- `useRegistrationStatus()` — useQuery，staleTime 5min
- `useOpenRegister()` — useMutation

#### 2.3 RegisterPage 双模式
**File:** `apps/web/src/pages/Register/RegisterPage.tsx`

当前 line 25-27：`if (!token)` → 显示 ErrorPanel。

改为：
- 无 token + 开放注册关闭 → ErrorPanel（原行为）
- 无 token + 开放注册开启 → 显示自助注册表单（email + name + password + confirm）
- 有 token → 保持原邀请流程不变

自助表单复用页面已有组件：`CenteredCard`, `Brand`, `Field`, `Pill`, `ErrorBanner`, style 对象。

#### 2.4 LoginPage 加注册入口
**File:** `apps/web/src/pages/Login/LoginPage.tsx`

条件渲染：当 `open_registration_enabled=true` 时，显示 "没有账号？立即注册" Link → `/register`

#### 2.5 SettingsPage 展示
**File:** `apps/web/src/pages/Settings/SettingsPage.tsx`

在系统信息区增加一行只读展示："开放注册：已启用/已关闭"

#### 2.6 类型更新
**File:** `apps/web/src/api/settings.ts` — `SystemSettingsResponse` 加 `allow_open_registration: boolean`

---

### Phase 3: 测试

**File:** `apps/api/tests/test_open_registration.py` (新建)

| 用例 | 断言 |
|------|------|
| 开关关闭时 POST register-open → 403 | status 403 |
| 正常注册 → 201 + viewer 角色 + JWT | user.role == "viewer" |
| 重复 email → 409 | detail 含"已被注册" |
| 弱密码 → 422 | validation error |
| GET registration-status 返回开关值 | open_registration_enabled == True/False |

---

### 不需要的改动（显式排除）

- **无 DB migration**：User.role 列已支持 "viewer" 值，无需新表/新列
- **不改邀请流程**：`invitation.py` / `InvitationService` 完全不动
- **不加 email 验证**：viewer 零权限，v0.7.7 不需要；未来升级角色时可加
- **不加 admin 审批队列**：is_active=True 立即可用；理由同上

---

### 关键文件清单

| 文件 | 改动类型 |
|------|----------|
| `apps/api/app/config.py` | 加 1 行配置 |
| `apps/api/app/api/v1/auth.py` | 加 2 个端点（~50 行） |
| `apps/api/app/schemas/invitation.py` | 加 1 个 schema class |
| `apps/api/app/schemas/me.py` | 加 1 个字段 |
| `apps/api/app/main.py` | version bump |
| `apps/web/src/api/invitations.ts` | 加 2 个 API 函数 |
| `apps/web/src/hooks/useInvitation.ts` | 加 2 个 hooks |
| `apps/web/src/pages/Register/RegisterPage.tsx` | 双模式改造 |
| `apps/web/src/pages/Login/LoginPage.tsx` | 条件注册链接 |
| `apps/web/src/pages/Settings/SettingsPage.tsx` | 只读展示 |
| `apps/web/src/api/settings.ts` | 类型补充 |
| `apps/api/tests/test_open_registration.py` | 新测试文件 |

---

### 验证步骤

1. `.env` 中设 `ALLOW_OPEN_REGISTRATION=true`，重启后端
2. 访问 `/register`（无 token）→ 应显示自助注册表单
3. 填写 email/name/password 注册 → 成功跳转 dashboard
4. 数据库确认新用户 role = "viewer"
5. 用该账号尝试创建项目/标注 → 应被权限拒绝
6. 超管在 UsersPage 将该用户提升为 annotator → 验证角色变更正常
7. `.env` 中设 `ALLOW_OPEN_REGISTRATION=false`，重启 → `/register` 无 token 时显示错误面板
8. 运行 `uv run pytest apps/api/tests/test_open_registration.py -v` 全绿
