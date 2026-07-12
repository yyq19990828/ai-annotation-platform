# ADR-0016：文档 IA 重构 — Diátaxis 框架 + audience 元数据

**状态**：已接受
**日期**：2026-05-09
**决策者**：平台团队

---

## 背景

`docs-site/` 经过 0.1–0.9.x 多版本迭代，逐渐积累了以下问题：

1. `dev/` sidebar 一屏无法完整显示（6 大类 30+ 项）
2. `user-guide/` 按功能模块（workbench / projects / review / superadmin）平铺，标注员打开看到超管内容
3. 无角色（audience）元数据，搜索结果无法过滤
4. 协议 / 规范 / 架构文档 reference + explanation 混杂
5. 部署相关内容散落在 `dev/` 而非运维入口

---

## 决策

### 1. 采用 Diátaxis 四象限作为文档类型模型

> 来源：https://diataxis.fr/

每篇文档只属于一个象限：

| 类型 (`type`) | 目的 | 示例 |
|---|---|---|
| `tutorial` | 学习，引导做一件完整的事 | 第一个贡献、新项目端到端 |
| `how-to` | 任务，解决具体问题 | 新增 API 端点、部署指南 |
| `reference` | 查阅，准确描述事物 | 环境变量、协议规范 |
| `explanation` | 理解，解释为什么 | 架构地图、数据流 |

### 2. user-guide 从「功能模块」改为「按角色」分层

旧结构（按功能）：`workbench/` → `projects/` → `review/` → `superadmin/`

新结构（按角色）：
- `for-annotators/`（原 `workbench/`）
- `for-project-admins/`（原 `projects/`）
- `for-reviewers/`（原 `review/`）
- `for-superadmins/`（原 `superadmin/`）
- `workflows/`（跨角色场景）
- `reference/`（格式、导出）

旧 URL 保留 client-side redirect shim 保持向后兼容。

> **后续修订（2026-05-23）**：目录命名从角色标签（`for-*`）改回功能标签 —
> `for-annotators/`→`workbench/`、`for-project-admins/`→`projects/`、`for-reviewers/`→`review/`、`for-superadmins/`→`superadmin/`。
> 本 ADR 的核心价值（按受众分区、标注员不见超管内容）通过 sidebar 分组保留；
> 仅目录名回归功能语义。重命名后清理了角色目录与原功能目录的所有 redirect shim（双轨残留），
> 不再保留 `for-*` shim。

> **后续修订（2026-07-12）**：网站逻辑导航与物理目录明确解耦。Sidebar 按角色和任务组织，
> 正文仍按稳定产品归属保存；例如「AI 辅助」可以同时链接 `workbench/`、`projects/`、
> `datasets/`、`workflows/` 与 `superadmin/` 的 canonical 页面，不复制或搬迁正文。只有当维护责任、
> 文档类型或生命周期边界变化时才调整物理路径；源文件搬迁通过 VitePress rewrites 保持公开 URL。

### 3. dev/ 按 Diátaxis 重排，独立 ops/ 板块

```
dev/
├── tutorials/   ← 原 local-dev.md + 新增 first-contribution.md
├── concepts/    ← 原 architecture/（重命名，强调"理解"而非"查阅"）
├── how-to/      ← 不变
├── reference/   ← 原 conventions / protocols，新增 env-vars.md
└── troubleshooting/  ← 不变

ops/
├── deploy/      ← 原 dev/deploy.md
├── observability/ ← 原 dev/monitoring.md
├── security/    ← 原 dev/security.md
└── runbooks/    ← 新增（Celery / ML Backend / PG）
```

### 4. frontmatter 元数据 schema

每篇文档强制包含以下字段：

```yaml
audience: [annotator | reviewer | project_admin | super_admin | dev | ops]
type: tutorial | how-to | reference | explanation
since: vX.Y.Z
status: draft | stable | deprecated
last_reviewed: YYYY-MM-DD
```

CI 校验脚本：`docs-site/scripts/check-doc-frontmatter.mjs`（退出码 1 阻断构建）
陈旧度检查：`docs-site/scripts/check-doc-freshness.mjs`（warning，不阻断）

### 5. 首页从「功能展示」改为「读者旅程入口」

6 张卡片分别对应：标注员 / 项目管理员 / 审核员 / 部署 / 贡献代码 / API 集成。

### 6. 明确可发布内容与生成边界

- `docs-site/user-guide/`、`dev/`、`api/`、`ops/` 是主要可发布内容域。
- `docs-site/maintainers/**` 与 `docs-site/dev/examples/**` 就近保存维护材料与可执行示例，但通过 `srcExclude` 排除在站点渲染、搜索与 sitemap 之外。
- ADR、Changelog 与 Roadmap 分别以 `docs/adr/**`、`CHANGELOG.md` + `docs/changelogs/**`、`ROADMAP.md` + `ROADMAP/**` 为真值，构建期镜像不直接编辑或提交。
- `ROADMAP/archive/**` 表达源文件生命周期，生成器继续输出稳定的 `/roadmap/archived-*` URL。
- 公开 OpenAPI 只保留 `apps/api/openapi.snapshot.json` 一份受版本控制的契约，构建前复制到 `public/openapi.json`。
- Pages 和文档验证的触发路径必须覆盖所有镜像真值源，避免源文件已更新但站点未重建。

---

## 替代方案

| 方案 | 排除原因 |
|---|---|
| 切换到 Astro Starlight | 迁移成本高，VitePress 生态足够，另行评估 |
| 只改 sidebar 不动目录 | 旧目录名（workbench / architecture）与 Diátaxis 术语不一致，长期认知负担 |
| 不加 frontmatter | 搜索结果无法按角色过滤；文档陈旧度无法量化 |
| 中英双语化 | 成本极高，本次不做，等专门版本 |

---

## 影响

### 正面

- 新贡献者有清晰的入口（tutorials/first-contribution.md）
- 标注员不会看到超管/开发内容
- 部署人员有独立的 ops/ 入口，不需要穿越 dev/
- frontmatter 为未来搜索过滤、陈旧度自动化奠定基础

### 风险与缓解

| 风险 | 缓解 |
|---|---|
| 旧 URL 在外部书签失效 | 源文件搬迁优先使用 VitePress rewrites 保留原 URL；真正下线的页面才使用有 `sitemap: false` 的 redirect shim |
| frontmatter 维护负担 | CI 脚本自动检查，`--fix` 可插入空骨架 |
| generate-hotkeys.mjs 输出路径变化 | 已同步更新输出路径为 `for-annotators/` |

---

## 参考

- [Diátaxis 框架](https://diataxis.fr/)
- [ROADMAP/archive/2026-05-09-docs-ia-redesign.md](/roadmap/archived-2026-05-09-docs-ia-redesign)
- Label Studio、CVAT、Encord、Roboflow 文档 IA 对比（见 Roadmap 文档 §1.3）
