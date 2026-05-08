# 2026-05-08-docs-deep-optimization

> 根据 CLAUDE.md §6 命名规范，建议正式落地时复制为 `2026-05-08-docs-deep-optimization.md`。

## Context

项目骨架已稳定（v0.9.10），`docs-site/` VitePress 三栏（user-guide / dev / api）+ 13 份 ADR + 12 份调研 + 自动化脚本（mirror-adr / sync-openapi / generate-hotkeys）已经具备扎实底座。**但近一个月 v0.9.x 高频迭代（49 个 commit / 36 小时内 30+ 提交）产生了大量未沉淀的知识：**

- 多个高价值踩坑（Celery 不热重载、容器内 localhost 不可达、Schema 适配器格式错配、TRUNCATE 误清开发数据、`.env` 容器层级溢出、React TDZ）只存在于 commit message
- v0.9.7–v0.9.10 新功能（AI 预标注 wizard、SAM 工具、ML 模型市场、超管视图）缺用户教程
- API 仅有 overview 一页，无按资源域的叙述指南
- 70+ 份 `docs/plans/` 会话档未回流到正式文档
- CHANGELOG 缺 v0.9.10、缺 0.8.x/0.9.x 拆分文件
- 无文档维护闭环（PR 模板/链接校验/Plans 归档约定均缺失）

**目标：** 把"项目骨架完善 → 文档同步滞后"的现状，转为"文档与代码并行演进、由机制保障实时性"的工作流。

---

## 总体思路

四个并行轨道 + 维护闭环。**只新增/扩展内容，不重构现有 VitePress 结构。**

```
轨道 A: 故障排查手册（新增 dev/troubleshooting/）
轨道 B: API 叙述文档扩充（扩展 docs-site/api/）
轨道 C: 架构图与数据流（扩展 dev/architecture/）
轨道 D: 用户手册三层角色补全（扩展 user-guide/）
机制层: PR 模板 + CI 校验 + 脚本生成 + Plans 归档约定
```

---

## 轨道 A：故障排查 / 踩坑手册（最高优先级）

**新增目录：** `docs-site/dev/troubleshooting/`

| 文件 | 来源 commit | 内容要点 |
|---|---|---|
| `index.md` | — | 故障排查导航 + 速查表（症状 → 文档锚点） |
| `docker-rebuild-vs-restart.md` | `4bf5bf6` + CLAUDE.md §7 | Celery 无热重载、何时 `restart` vs `build`、验证脚本 |
| `container-networking.md` | `d41236b`, `0a99cc6` | 为何 ML Backend 不能填 `localhost`，应使用 `172.17.0.1` 或 service DNS；URL validator 规则 |
| `schema-adapter-pitfalls.md` | `0a99cc6` | LabelStudio 标准格式 vs 内部 schema、3 层 COALESCE 回退、predictions 读路径丢失案例 |
| `dev-data-preservation.md` | `c3e0d94`, `3ab5ff0` | 为何 e2e/screenshots 切换 TRUNCATE → 定向 DELETE；fixture 数据保护原则 |
| `react-tdz-trap.md` | `8949455` | useState 初始化器引用未声明变量的 TDZ 案例 |
| `env-and-config-paths.md` | `0a99cc6` | 容器内 `parents[3]` 溢出、`.env` 缺失优雅降级 |
| `ci-flaky-services.md` | `b63b192`, `51a84b1`, `45da7db` | bitnami/minio 弃用、e2e MinIO 服务定义、IPv6 解析失败 |

**模板（每篇遵循统一结构）：**
```markdown
## 症状
## 复现
## 根因
## 修复 / 规避
## 相关 commit / ADR
```

**关键文件：**
- `docs-site/.vitepress/config.ts` — 在 dev sidebar 注入 troubleshooting 分组
- `docs-site/dev/troubleshooting/*.md` — 8 篇新文件

---

## 轨道 B：API 叙述文档扩充

**扩展：** `docs-site/api/`（保留现有 OpenAPI 嵌入页，新增按资源域指南）

新增子目录与页面：
- `api/guides/auth.md` — 登录、token、API key、CAPTCHA 升级
- `api/guides/projects.md` — 创建/配置/成员/标签集
- `api/guides/tasks-and-annotations.md` — task 锁、annotation 提交、版本
- `api/guides/predictions.md` — prediction_jobs 表、schema 格式、LabelStudio 适配
- `api/guides/ml-backend.md` — 注册流程、URL validator、健康检查、回写约定
- `api/guides/websocket.md` — 链接到现有 `dev/ws-protocol.md`，补 API 视角调用样例
- `api/guides/export.md` — 导出格式、增量导出、对象存储 URL

**复用现有：**
- `apps/api/openapi.snapshot.json` — 仍是契约源
- `docs-site/scripts/sync-openapi.mjs` — 不动
- `docs-site/dev/architecture/api-schema-boundary.md` — 在 API 指南顶部交叉引用

---

## 轨道 C：架构图与数据流（Mermaid）

**扩展：** `docs-site/dev/architecture/`（已存在 6 篇）

新增/补图：
- `overview.md`（已存在，补 Mermaid 拓扑图：Web ↔ API ↔ Postgres/Redis/MinIO/Celery ↔ ML Backends）
- `data-flow.md`（已存在，补三张时序图：标注提交、AI 预标注、WebSocket 协作）
- `ai-models.md`（已存在，补 SAM 文本/框混合模式 + grounded-sam2-backend 缓存层级图）
- 新增 `prediction-pipeline.md` — `prediction_jobs` 状态机（v0.9.8 新表）
- 新增 `deployment-topology.md` — 单机 / 多机 / GPU 隔离三种部署形态

**约束：** 全部使用 Mermaid（VitePress 已支持），不引入图片，便于 diff 与维护。

---

## 轨道 D：用户手册三层角色补全

**扩展：** `docs-site/user-guide/`（保留现有结构，按角色分层）

新增目录：
```
user-guide/
├── annotator/        # 标注员（迁移现有 workbench/* 内容入口）
│   └── ...（保持现状，补 SAM-S 工具与 Ctrl+Enter 等 v0.9.x 新交互）
├── admin/            # 项目管理员（新建）
│   ├── project-config.md
│   ├── batch-import.md
│   ├── ai-pre-annotate-wizard.md   # v0.9.5–v0.9.7
│   ├── review-and-quality.md
│   └── export.md
└── superadmin/       # 超级管理员（新建）
    ├── ml-backend-registry.md       # v0.9.3–v0.9.8
    ├── model-market.md              # v0.9.3 模型市场合并
    ├── failed-predictions.md
    ├── audit-logs.md                # v0.9.9 B-2~8
    └── system-monitoring.md
```

**信息源：** 主要从 git commit detail（v0.9.x 系列）+ 现有 page 组件 props 反推 UX 流程。

---

## 维护机制（关键 — 让文档自动跟上代码）

### M1. PR 模板 + 文档影响清单

**新增：** `.github/PULL_REQUEST_TEMPLATE.md`

```markdown
## 变更说明
<!-- 一句话描述 -->

## 文档影响清单（CLAUDE.md §5）
- [ ] 不涉及文档（仅内部重构 / 测试）
- [ ] 新增/修改 API → 已更新 `docs-site/api/guides/` 与 `openapi.snapshot.json`
- [ ] 新增/修改功能 → 已更新 `docs-site/user-guide/{annotator|admin|superadmin}/`
- [ ] 架构变更 → 已更新 `docs-site/dev/architecture/`，必要时新增 ADR
- [ ] 环境变量变更 → 已更新 `.env.example` 与 `DEV.md`
- [ ] 引入新踩坑 → 已新增 `docs-site/dev/troubleshooting/*.md`
- [ ] CHANGELOG.md 已更新（含版本号与日期）
```

### M2. CI 自动校验

**扩展：** `.github/workflows/docs.yml`（已存在）

新增 step：
- **链接校验**：lychee（外链 + 站内 anchor），失败即阻断
- **OpenAPI lint**：`redocly lint apps/api/openapi.snapshot.json`
- **ADR 编号唯一性 + 状态字段校验**：扩展 `docs-site/scripts/check-doc-snippets.mjs`
- **CHANGELOG 与最新 tag 一致性**：脚本检查 `CHANGELOG.md` 顶部版本号 ≥ `git describe --tags`

### M3. 脚本化生成（扩展现有 `docs-site/scripts/`）

| 脚本 | 用途 |
|---|---|
| `generate-api-index.mjs`（新增） | 扫描 `apps/api/app/api/v1/` 路由文件，生成 `api/guides/_routes.generated.md` 索引 |
| `generate-changelog-draft.mjs`（新增） | 从 `git log $(last_tag)..HEAD` 按 conventional commit 类型分组，输出 CHANGELOG 草稿 |
| `extract-completed-plans.mjs`（新增） | 扫描 `docs/plans/*.md`，输出已完成 plan 的索引页 `docs-site/dev/plans-index.md` |
| `mirror-adr.mjs`（已存在） | 不动 |
| `sync-openapi.mjs`（已存在） | 不动 |
| `generate-hotkeys.mjs`（已存在） | 扩展为同时生成标注员/管理员两套快捷键参考 |

### M4. Plans 归档约定

**新增：** `docs/plans/README.md`

```markdown
# Plans 归档约定

每个 plan 文件代表一次开发会话。完成后必须：
1. 在文件末尾追加 `## Outcome` 段，列出已落地变更与对应正式文档路径
2. 影响用户/开发者的内容必须同步到：
   - `docs-site/user-guide/` 或 `docs-site/dev/`
   - `CHANGELOG.md`（如发版）
3. plan 本身仅作历史索引，不作为知识载体
4. CI 会扫描超过 30 天未补 `## Outcome` 的 plan 并 warning
```

---

## 立即补的存量缺口

1. **CHANGELOG.md 补 v0.9.10 条目**（commit `4915da9`：B-10~13 + AI confidence pipeline）
2. **拆分 `docs/changelogs/0.8.x.md` 与 `0.9.x.md`**，主 CHANGELOG 改为索引
3. **`docs/adr/0014-prediction-jobs-table.md`** — v0.9.8 新表的架构决策
4. **`docs/adr/0015-ml-backend-url-validation.md`** — 容器网络约束的决策记录

---

## 关键文件清单

**新增：**
- `docs-site/dev/troubleshooting/index.md` + 8 篇踩坑文档
- `docs-site/api/guides/*.md`（7 篇）
- `docs-site/dev/architecture/prediction-pipeline.md`、`deployment-topology.md`
- `docs-site/user-guide/admin/*.md`（5 篇）、`superadmin/*.md`（5 篇）
- `docs-site/scripts/generate-api-index.mjs`、`generate-changelog-draft.mjs`、`extract-completed-plans.mjs`
- `.github/PULL_REQUEST_TEMPLATE.md`
- `docs/plans/README.md`
- `docs/adr/0014-*.md`、`0015-*.md`
- `docs/changelogs/0.8.x.md`、`0.9.x.md`

**修改：**
- `docs-site/.vitepress/config.ts` — 注入新 sidebar 分组
- `docs-site/dev/architecture/{overview,data-flow,ai-models}.md` — 补 Mermaid
- `docs-site/scripts/generate-hotkeys.mjs` — 双角色支持
- `.github/workflows/docs.yml` — 新增 lychee / redocly / 一致性校验 step
- `CHANGELOG.md` — 补 v0.9.10、改为索引结构
- `CLAUDE.md` — §5 文档检查清单与 PR 模板呼应（项目侧可微调措辞）

---

## 实施顺序建议（迭代 5–7 天）

1. **Day 1（机制先行）**：PR 模板、`docs/plans/README.md`、CI 校验骨架 — 让后续每步都被守护
2. **Day 2**：轨道 A 故障排查全部 8 篇 — 价值密度最高，全部从 commit message 直接产出
3. **Day 3**：CHANGELOG 补齐 + ADR 0014/0015 + 拆分 changelogs/
4. **Day 4**：轨道 C 架构图（5 张 Mermaid）
5. **Day 5–6**：轨道 D 用户手册 admin/superadmin 共 10 篇
6. **Day 7**：轨道 B API 指南 7 篇 + 三个新生成脚本 + sidebar 接线

每个轨道完成后单独 commit，便于回滚和 review。

---

## 验证方法

**本地：**
```bash
pnpm docs:dev               # http://localhost:5173 巡检三栏导航完整性
pnpm docs:build             # 验证 prebuild 链路（mirror-adr + sync-openapi + 新脚本）
pnpm --filter @anno/docs-site exec lychee 'docs-site/**/*.md'
pnpm --filter @anno/docs-site exec redocly lint apps/api/openapi.snapshot.json
```

**端到端：**
1. 故意改一个 API 路由 → 提 PR → 验证 PR 模板触发 + CI 链接校验生效
2. 新增一个 plan → 验证 CI warning 在 30 天后触发
3. 浏览 `/docs/dev/troubleshooting/docker-rebuild-vs-restart` → 按文中步骤实操 Celery 重启验证脚本，确认与代码一致

**人工抽查清单：**
- [ ] 标注员能仅看 `user-guide/annotator/*` 上手
- [ ] 管理员能仅看 `user-guide/admin/*` 跑通批量导入 + AI 预标注 wizard
- [ ] 超管能仅看 `user-guide/superadmin/*` 完成 ML Backend 注册
- [ ] 新人按 `dev/troubleshooting/` 自助排查 Celery 不更新问题
- [ ] OpenAPI 修改后，CI 自动同步 `public/openapi.json` 且 API 指南页交叉引用未坏
