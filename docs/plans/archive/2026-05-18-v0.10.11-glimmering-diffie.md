# v0.10.11 — CSP style-src 基建试点 + 项目复制

## Context

v0.10.x 主线（SAM3 / Image Workbench Wave β-δ / 1:N 后端 / I11 e2e + dirtyRect + I17.3）已在 v0.10.10 收尾。0.10.11 作为该 minor 系列的维护 / 治理切片，挑两件 ROADMAP §A / §B 中**互不耦合、单版本可控**的事：

1. **CSP `style-src` nonce 收紧**（ROADMAP §B 安全）—— 前置依赖是全站 ~2900 处 `style={{}}` 重构，1 个版本不可能搞完。本版只做 **管道基建 + 1 个高密度 section 试点**，证明路径可走，为后续 epic 攒经验。
2. **项目模板（"复制项目"形态）**（ROADMAP §A 项目模块）—— 当前每次新建项目都从 0 配置类别 / AI 模型 / 属性 schema。v0.7.6 之后 Wizard 已 7 步，模板复用价值高。本版落"从已有项目复制"一次性派生流；独立 Template 对象 / 模板库延后到 0.10.12+ 按客户反馈触发。

两件事代码路径不交叉（一个动 build pipeline + Projects/sections 1 个文件 + nginx，一个动 `projects.py` + Wizard），可并行实现、独立 PR。

---

## Part A · CSP style-src nonce 基建 + BatchesSection 试点

### 现状

- CSP 中间件：[apps/api/app/middleware/security_headers.py:30](apps/api/app/middleware/security_headers.py) `style-src 'self' 'unsafe-inline'`。
- script-src nonce 管道（v0.9.11 已就位，复用模型）：
  - 构建期：[apps/web/vite-plugins/csp-nonce.ts](apps/web/vite-plugins/csp-nonce.ts) 把 `nonce="__CSP_NONCE__"` 注入 `<script>` 标签 + `<meta name="csp-nonce">`。
  - 运行期：[infra/docker/nginx.conf](infra/docker/nginx.conf) 用 `sub_filter` 把 `__CSP_NONCE__` 替换为 `$request_id`。
- 全站 inline style：~2905 处。Projects/sections 群仍是 ROADMAP 指定切入点（密度高、耦合低）。
- 无 CSS modules / vanilla-extract 现成基建（Vite 6 自带 CSS modules 处理能力，开箱即用）。

### 目标

不真的从 CSP 头里移除 `'unsafe-inline'`（其他 2900+ 处还在）。本版做：

1. **CSS modules 接入约定**：建立 `*.module.css` 共存惯例 + 1 篇 contributor 文档，**不引第三方库**（vanilla-extract / panda 等推迟评估）。
2. **试点重构 `BatchesSection.tsx`（948 行）** —— ROADMAP 指定的最高密度 section。把内部 inline `style={{}}` 全部迁到同目录 `BatchesSection.module.css`。
3. **lint guard**：给 `apps/web/src/pages/Projects/sections/BatchesSection.tsx` 加 ESLint override 禁用 `react/forbid-dom-props` 中的 `style` prop，让"已迁的不要回潮"。

不动 nginx / 中间件 / vite-plugin —— 本版不引"style nonce 注入"管道（真正需要时再加；当前 `'unsafe-inline'` 还在头里，加 nonce 无效益）。

### 关键文件

| 文件 | 改动 |
|---|---|
| [apps/web/src/pages/Projects/sections/BatchesSection.tsx](apps/web/src/pages/Projects/sections/BatchesSection.tsx) | 试点：所有 `style={{...}}` → `className={styles.xxx}`。先实地 grep 该文件 inline style 数量验证密度（Explore 报 1 处与 ROADMAP 948 行密度叙述不符，**实施第一步是 grep 复核**；如确实低密度，改选 `apps/web/src/pages/Projects/sections/` 下次高密度文件，或退到 `pages/Workbench/` 群里 1 个 ~300-500 行组件）。 |
| `apps/web/src/pages/Projects/sections/BatchesSection.module.css` | 新建。 |
| [apps/web/.eslintrc.cjs](apps/web/.eslintrc.cjs)（或同级 lint 配置） | 给试点文件加 override 禁用 inline `style` prop。 |
| [docs-site/dev/how-to/](docs-site/dev/how-to/)（新增 1 篇） | "页面级 inline style → CSS modules 迁移指南"，作为后续 epic 模板。 |
| [CHANGELOG.md](CHANGELOG.md) + [docs/changelogs/](docs/changelogs/) | 记录"基建 + 试点"分组。 |

### 非目标

- 不真的改 `security_headers.py` 移除 `'unsafe-inline'`（待 sections 群整体迁完后单独 PR）。
- 不引 vanilla-extract / styled-components。
- 不批量改其他 section。

---

## Part B · 项目复制（"从已有项目复制配置"）

### 现状

- Project 模型字段（克隆候选）：[apps/api/app/schemas/project.py](apps/api/app/schemas/project.py) `ProjectCreate` / `ProjectOut` — `type_label`/`type_key`、`classes`/`classes_config`、`attribute_schema`、`ai_enabled`/`ai_model`/`ml_backend_source_id`、`label_config`、`rendering_config`（v0.10.10）、`box_threshold`/`text_threshold`/`text_output_default`、`sampling`、`maximum_annotations`、`show_overlap_first`、`iou_dedup_threshold`。
- 已有的 ML backend 克隆参考：[apps/api/app/api/v1/projects.py:324](apps/api/app/api/v1/projects.py) `_clone_backend_to_new_project()`（v0.9.7 通过 `ml_backend_source_id` 复用 backend 的模式）。
- 创建 Wizard：[apps/web/src/components/projects/CreateProjectWizard.tsx](apps/web/src/components/projects/CreateProjectWizard.tsx)（7 步：类型 / 类别 / 属性 / AI / 数据 / 成员 / 收尾）。入口 `?new=1` from `pages/Dashboard/AdminDashboard.tsx` / `DashboardPage.tsx`；ProjectGrid 行操作菜单：[apps/web/src/pages/Dashboard/ProjectGrid.tsx](apps/web/src/pages/Dashboard/ProjectGrid.tsx)。

### 目标

让管理员在 ProjectGrid 行操作菜单点"复制"，或在 Wizard step 0 选"从已有项目导入配置"，把源项目的配置字段一次性预填到新项目；**不复制 datasets / tasks / annotations / members / batches**（这些是运行时数据，复制无意义）。

### 后端

- **POST `/projects` 扩展**（不开新端点，保持 RESTful）：`ProjectCreate` 加可选 `source_project_id: int | None`。
  - 服务端流程（projects.py 创建路径）：① 若有 `source_project_id`，权限校验调用者对源项目有 view 权限（复用现有 RBAC helper）；② 用源项目字段填充未在请求中显式给出的字段（**请求字段优先，源项目兜底**，便于"复制后再改一点"）；③ ML backend 走现有 `_clone_backend_to_new_project()` 路径（把 `source_project_id` 视为 `ml_backend_source_id` 的更高语义封装）；④ datasets / tasks / batches / members **不复制**。
- **审计日志**：`project.created` 事件 metadata 加 `source_project_id` 字段（已有 audit 中间件，只加 payload key）。
- **不新建 ProjectTemplate 表 / endpoint**。延后到 0.10.12+ 触发条件：客户提"跨项目共享 / 公共模板库"明确需求。

### 前端

- **ProjectGrid 行操作菜单**加"复制"项 → `?new=1&from=<id>` 跳 Dashboard，Wizard 启动时读 `from` query param。
- **Wizard step 0/1 加"从已有项目导入"入口**：下拉框（按用户可见的项目列表，复用 `useProjects`），选中后调 `GET /projects/{id}` 把 7 步表单字段 prefill 到 FormState（与现有 `ml_backend_source_id` 预填路径一致）；用户仍走完 7 步流程，可以逐步覆盖。
- **新项目名默认 `{源项目名} (副本)`**，避免 unique 冲突。

### 关键文件

| 文件 | 改动 |
|---|---|
| [apps/api/app/schemas/project.py](apps/api/app/schemas/project.py) | `ProjectCreate.source_project_id: int \| None`. |
| [apps/api/app/api/v1/projects.py](apps/api/app/api/v1/projects.py) | POST 路径分支：fetch source + merge 字段；复用 `_clone_backend_to_new_project()`. |
| [apps/api/tests/api/v1/test_projects.py](apps/api/tests/api/v1/test_projects.py)（或同级） | 加 case：① 仅 source_project_id 创建；② source + 显式 name 覆盖；③ 无 view 权限拒绝；④ 不带 source 走原路径回归。 |
| [apps/web/src/pages/Dashboard/ProjectGrid.tsx](apps/web/src/pages/Dashboard/ProjectGrid.tsx) | DropdownMenu 加"复制"。 |
| [apps/web/src/components/projects/CreateProjectWizard.tsx](apps/web/src/components/projects/CreateProjectWizard.tsx) | 读 `from` query / 加"从已有项目导入"下拉 + prefill 逻辑。 |
| [docs-site/user-guide/for-project-admins/](docs-site/user-guide/for-project-admins/) | 加一段"复制项目配置"。 |
| [CHANGELOG.md](CHANGELOG.md) | 记录端点扩展（向后兼容，老调用者不受影响）。 |

### 非目标

- 不建 ProjectTemplate 表 / `/templates` endpoint / 模板库 UI。
- 不复制 datasets / tasks / annotations / members / batches。
- 不复制审计日志 / 历史指标。

---

## 验证

### A (CSP 试点)
- ① BatchesSection 在浏览器实际渲染无视觉回归（dev `pnpm dev`，跑 Projects > 某项目 > Batches Tab 的关键交互：创建批次 / 看板 / bulk action）。
- ② `pnpm typecheck && pnpm lint` 干净；新 ESLint override 在故意写 inline style 时报错。
- ③ 试点文件 `grep -c "style={{"` 归零。

### B (项目复制)
- ① 后端单测：4 case 全过（见上表）。
- ② e2e / 手测：A 项目（开了 AI、类别 5 个、属性 schema 3 字段、rendering_config 非默认）→ ProjectGrid 复制 → 不改任何字段提交 → 新项目除 `id`/`created_at`/`name` 外字段与 A 完全一致；datasets / tasks / batches 为空。
- ③ 权限：viewer 用户对 A 项目无 view 权限时调用接口 403。
- ④ 回归：旧调用方式（不带 `source_project_id`）创建项目行为不变。

---

## 备注

- 两件事独立 PR，建议先合 B（用户感知强、技术风险低），再合 A（基建型、需 contributor 文档配套）。
- 版本号沿用 0.10.x patch 命名约定；CHANGELOG / docs/changelogs 同步更新（项目约定 §5）。
- Plan 文件名遵循 [CLAUDE.md §6](CLAUDE.md) 日期前缀规范（实际命名以本文件 path 为准，已采用 plan workflow 生成的 slug）。
