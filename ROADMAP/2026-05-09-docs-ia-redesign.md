# 提案 · 文档 IA 重构（docs-site/ 信息架构升级）

> 状态：**草案 / 待对齐**。无版本绑定，落地分两个里程碑（轻量整理 + 深度重构），可在 v0.10.x 周边窗口期插入。
>
> 目标：把目前扁平、按文件堆放的 `docs-site/` 改造成「按读者意图分层」的 IA，对齐主流标注平台 / 开源项目文档站的成熟做法。

---

## 0. TL;DR

- 当前 `docs-site/` 三大板块（user-guide / dev / api）内部都是**单层平铺**，sidebar 把所有页都顶到第一屏；新人很难在「我此刻该看什么」上做决定。
- 引入 [Diátaxis](https://diataxis.fr/) 四象限（Tutorials / How-to / Reference / Explanation）作为底层心智模型，再叠一层「按角色 × 按任务」的入口分流，对齐 Label Studio / CVAT / Roboflow / Encord 的既有惯例。
- 不动文档内容、不大改路由：**重排 sidebar + 加一层入口页 + 引入文档元数据**就能拿到 80% 收益（M1）；M2 再做深度切分（拆 user-guide、引入 cookbook / glossary、做语种隔离）。
- M1 ≈ 3 个工作日（IA 重排 + 入口页），M2 ≈ 5 个工作日（拆分 + 元数据 + 校验脚本）。

---

## 1. 现状盘点

### 1.1 `docs-site/` 当前结构

```
docs-site/
├── index.md                  # home：3 张卡片（user-guide / dev / api）
├── user-guide/               # 9 个目录平铺
│   ├── getting-started.md
│   ├── faq.md
│   ├── workbench/  projects/  review/  export/  superadmin/
│   └── images/  IMAGE_CHECKLIST.md
├── dev/                      # 30+ 文件平铺在 5 类目
│   ├── local-dev / testing / conventions / release
│   ├── architecture/ (10 篇)
│   ├── how-to/ (5 篇)
│   ├── troubleshooting/ (8 篇)
│   ├── ml-backend-protocol.md / ws-protocol.md / security.md / monitoring.md / deploy.md
│   └── icon-conventions.md / examples/
├── api/                      # OpenAPI + 7 篇 guides
├── changelog/  roadmap/      # 由 mirror 脚本镜像
└── adr/                      # 由 mirror-adr.mjs 生成
```

### 1.2 痛点

| # | 痛点 | 表现 | 后果 |
|---|---|---|---|
| P1 | dev sidebar 一屏装不下 | "起步 / 架构 / 部署与协议 / How-to / 故障排查 / ADR" 6 大类 30+ 项 | 新贡献者抓不到入口 |
| P2 | 用户手册扁平 | 标注员 / 审核员 / 项目管理员 / 超管 4 类读者塞同一棵树 | 标注员一打开看到 ml-backend-registry，分流失败 |
| P3 | 没有"为什么"层 | 协议 / 安全 / 模型集成是 reference + how-to 混杂 | 只能跳着读，不知道某个决定背后的取舍 |
| P4 | 文档无元数据 | 没有 audience / type / since 字段 | 搜索结果无法过滤；陈旧度无法体现 |
| P5 | API 文档孤立 | `/api/` 与 dev `/architecture/api-schema-boundary` 两边各说一套 | 后端契约的真相在哪不清 |
| P6 | 镜像目录拼接 | `roadmap/` `changelog/` `adr/` 由脚本生成，没和 dev 对齐 | 入口分散；roadmap 和 plans 有重叠 |
| P7 | 缺索引 / 词表 | 没有术语表、没有命令速查、没有按角色筛选页 | 同一概念（task / batch / job / pipeline）在不同章节定义不一致 |

### 1.3 行业参考

> 下面是跑过的开源 / 商业平台的文档 IA 模板，挑接近我们形态的对照：

| 平台 | IA 关键特征 | 我们能借鉴的 |
|---|---|---|
| **Label Studio** ([labelstud.io/guide](https://labelstud.io/guide/)) | Guide（角色/任务） + Templates（按标注类型） + Integration + Tags Reference + API | 「Templates 按标注类型分」直接对应我们的 workbench/* |
| **CVAT** ([opencv.github.io/cvat](https://opencv.github.io/cvat/docs/)) | Manual（用户）+ Administration + API & SDK + Contributing + FAQ | 把「部署 / 安全」从 dev 里独立成 Administration |
| **Roboflow** ([docs.roboflow.com](https://docs.roboflow.com/)) | Quickstart + Guides + Reference + Changelog（顶部独立 tab） | 把 Quickstart 真当一等公民放 home，下面的卡片一律点到 5 分钟跑通 |
| **Encord** ([docs.encord.com](https://docs.encord.com/)) | Get Started / Workflow / Annotate / Active / Index 五大读者旅程 | 用「读者旅程」(journey) 而不是"功能模块"做一级分类 |
| **V7 / Scale** | Quickstart / Concepts / Tutorials / Reference + 顶部 audience switcher | 「Concepts」单独存在，强制把 explanation 抽出来 |
| **Stripe / Vercel / Next.js**（通用范式） | Diátaxis 显式落地（Learn / Build / API / Concepts） | 我们 dev 应该明显分出 Concepts vs How-to vs Reference |

> 共性：都没有把所有东西塞到一个 sidebar；都有显式的 quickstart；都把 API reference 和 explanation 分开；都有元数据驱动的搜索筛选。

---

## 2. 设计原则

1. **按读者意图分层**：先选「我是谁 + 我要做什么」，再细看具体页面。
2. **Diátaxis 四象限**：Tutorial（学习）/ How-to（任务）/ Reference（查阅）/ Explanation（理解）—— 同一篇文档只属于一个象限。
3. **三屏内见底**：任何 sidebar 一屏内可见的项 ≤ 12，超出折叠。
4. **入口页 ≠ 索引页**：每个一级板块的 `index.md` 必须给出「按角色 / 按任务」两条导航，而不是只列子目录。
5. **不重写已有内容**：M1 只动结构、入口、sidebar；正文文件 0 改动。
6. **元数据驱动**：每页 frontmatter 必填 `audience` / `type` / `since` / `status`，VitePress 主题渲染读者过滤器。

---

## 3. 目标 IA

### 3.1 顶层导航（顶 nav，5 → 6 项）

| 顺序 | 入口 | 路径 | 受众 |
|---|---|---|---|
| 1 | **快速开始** *(新)* | `/quickstart/` | 所有人 |
| 2 | 用户手册 | `/user-guide/` | 标注员 / 审核员 / 项目管理员 / 超管 |
| 3 | 开发文档 | `/dev/` | 贡献者 / 维护者 |
| 4 | 部署与运维 *(从 dev 拆出)* | `/ops/` | 部署人员 / SRE |
| 5 | API 文档 | `/api/` | 集成方 / 后端 |
| 6 | 更新日志 / Roadmap | `/changelog/` `/roadmap/` | 所有人（合成下拉） |

> "快速开始"独立于 user-guide 与 dev：它一份文档同时回答标注员（怎么登录开始标）和工程师（怎么把仓库跑起来）—— 用 tab / role-switcher 分屏。

### 3.2 user-guide/ 重排（按读者旅程 + 任务）

```
user-guide/
├── index.md                        # 角色入口卡 + 推荐路径
├── concepts.md  *(新)*             # 项目 / 批次 / 任务 / 标注 / 审核 / 导出 的统一术语表
├── for-annotators/  *(原 workbench/ 改名 + 上提)*
│   ├── index.md
│   ├── bbox.md  polygon.md  keypoint.md  classification.md
│   ├── sam-tool.md
│   └── shortcuts.md
├── for-reviewers/   *(原 review/ 改名)*
├── for-project-admins/  *(原 projects/ 改名 + 接 ai-preannotate)*
│   ├── index.md  create.md  batch.md  ai-preannotate.md  schema.md  assignment.md
├── for-superadmins/  *(原 superadmin/)*
├── workflows/  *(新 · 跨角色场景)*
│   ├── new-project-end-to-end.md   # PM 创项目 → 上传 → 标注 → 审核 → 导出
│   ├── ai-preannotate-pipeline.md
│   └── failed-prediction-recovery.md
├── reference/  *(新)*
│   ├── export-formats.md  *(原 export/)*
│   ├── hotkeys.md  *(generate-hotkeys.mjs 自动生成)*
│   └── glossary.md
└── faq.md
```

**关键变化**：
- 一级菜单从「功能模块」(workbench / projects / review / export / superadmin) 转为「角色」(for-X) + 「场景」(workflows)，对应 Encord 风格。
- 把 `export/` 降到 reference（标注员从 ribbon 直接进，不需要在主导航占位）。
- `concepts.md` 收录平台核心名词（task / batch / job / pipeline / prediction / annotation 的差别），同 [glossary.md](docs-site/user-guide/reference/glossary.md) 互相 anchor。
- `workflows/` 是 explanation + tutorial 杂交：用户读完一个 workflow 能从头跑通一遍，不需要在 5 个章节间跳转。

### 3.3 dev/ 重排（Diátaxis 显式落地）

```
dev/
├── index.md                    # 入口 + 5 分钟跑通
├── tutorials/  *(新 · learning)*
│   ├── first-contribution.md   # 「改一个文案，跑测试，提 PR」
│   ├── add-annotation-type.md  # 端到端实战
│   └── e2e-with-playwright.md
├── how-to/  *(原样保留)*
│   ├── add-api-endpoint.md  add-page.md  add-migration.md
│   ├── debug-celery.md  debug-websocket.md
│   └── upgrade-dependencies.md  *(新)*
├── concepts/  *(改名自 architecture/，强调"为什么")*
│   ├── overview.md  data-flow.md  ai-models.md  prediction-pipeline.md
│   ├── frontend-layers.md  backend-layers.md  backend-infrastructure.md
│   ├── api-schema-boundary.md  deployment-topology.md  perfhud.md
│   └── README.md  *(画一张地图：哪个图对应哪段代码)*
├── reference/  *(新 · 协议 / 规范集中)*
│   ├── ml-backend-protocol.md  ws-protocol.md
│   ├── conventions.md  icon-conventions.md
│   ├── env-vars.md  *(新 · 从 .env.example 自动生成)*
│   └── error-codes.md  *(新)*
├── testing.md  release.md
├── troubleshooting/  *(原样)*
└── adr/  *(原样，由 mirror-adr 注入)*
```

**关键变化**：
- `architecture/` → `concepts/`：名字传达「读这里是为了理解，不是 copy-paste」。
- 协议 / 规范全归 `reference/`：和 `troubleshooting/` 之间界限清楚。
- 新增 `tutorials/`：对齐 Diátaxis；空着也比没有好（先放 1 篇 first-contribution）。
- `local-dev.md` 从 sidebar 顶级提到 `tutorials/`；`testing.md` `release.md` 留顶级（高频）。

### 3.4 拆出 ops/

把 dev 里的 deploy / monitoring / security 抽到独立板块：

```
ops/
├── index.md
├── deploy/
│   ├── docker-compose.md  k8s.md  *(占位)*
│   └── ml-backend-deployment.md
├── observability/   *(原 monitoring.md 拆细)*
│   ├── logs.md  metrics.md  tracing.md  perfhud.md
├── security/        *(原 security.md 拆细)*
│   ├── threat-model.md  csp.md  authn-authz.md
├── runbooks/  *(新 · 出事时翻这里)*
│   ├── celery-worker-stuck.md
│   ├── ml-backend-down.md
│   └── postgres-connection-pool-exhausted.md
└── upgrade-guide.md
```

> ops 是面向「**已部署**这个平台的人」，而不是「想看代码的人」。这个分流和 CVAT 的 Administration 同构。

### 3.5 api/ 微调

- 顶部加 `concepts.md`（鉴权模型 / 限流 / 错误约定 / 版本兼容承诺）
- guides 改名 `recipes/`：每个 guide 是「调 N 个端点完成一件事」而不是端点列表
- 端点 reference 由 OpenAPI 自动生成（已有），单独 tab 进入

### 3.6 元数据 schema（M2 引入）

每篇文档 frontmatter 强制：

```yaml
---
title: SAM 智能工具
audience: [annotator, project_admin]   # annotator | reviewer | project_admin | super_admin | dev | ops
type: how-to                           # tutorial | how-to | reference | explanation
since: v0.9.0
status: stable                         # draft | stable | deprecated
last_reviewed: 2026-05-09
---
```

VitePress 主题在 sidebar / 搜索结果旁渲染 audience badge；CI 校验 `last_reviewed` > 180 天的页面输出 warning（`scripts/check-doc-freshness.mjs`）。

### 3.7 home 页（`docs-site/index.md`）

把现在的 3 张大卡改成 6 张「读者旅程」卡：
- 我是新标注员 → for-annotators
- 我是项目管理员 → workflows/new-project-end-to-end
- 我要部署 → ops/deploy
- 我要贡献代码 → dev/tutorials/first-contribution
- 我要集成 API → api/concepts
- 我要看最近变化 → changelog 顶部 N 条

下面再放「按主题浏览」的 8-12 张小卡。

---

## 4. 里程碑切片

### M1 — IA 轻量重排（约 3 个工作日）

**目标**：sidebar / 入口页 / home 的视觉层级到位；不动文件内容，只动 sidebar 配置和 `index.md`。

- [ ] `docs-site/.vitepress/config.ts` 重排 sidebar：dev 6 大类 → 5 类 + 折叠；user-guide 改成"按角色 + 按场景"骨架（先靠 alias / 重定向，不实际移动文件）
- [ ] `docs-site/index.md` 改写为 6 张读者旅程卡 + 8-12 张主题卡
- [ ] 三个一级板块的 `index.md` 全部重写为「按角色 / 按任务」入口
- [ ] 引入顶部 nav 的 ops 入口（先临时指向 dev/deploy + dev/security + dev/monitoring 的合集页）
- [ ] 加 `docs-site/user-guide/concepts.md`（术语表占位 + glossary 链接）
- [ ] 加 `docs-site/dev/concepts/README.md`（架构地图）

**验收**：
1. `pnpm docs:dev` 打开任一页，sidebar 一屏内可见项 ≤ 12
2. home 6 张卡每张都能 1 click 跳到「读者旅程入口」
3. dead link check (`pnpm docs:build`) 通过
4. 不动 `.md` 正文文件（git diff 限定在 `index.md` / `config.ts` / 新建的 `concepts.md`）

### M2 — 深度重构 + 元数据（约 5 个工作日）

**目标**：物理目录与 IA 对齐；元数据强制；ops 独立板块上线。

- [ ] 落地物理迁移：`workbench/` → `for-annotators/`、`projects/` → `for-project-admins/`、新建 `workflows/`、`reference/`、`tutorials/`、`concepts/`（旧路径加 301 redirect via [vitepress rewrites](https://vitepress.dev/reference/site-config#rewrites)）
- [ ] 拆 `dev/` → `dev/` + `ops/`，搬迁 deploy / monitoring / security
- [ ] 所有 `.md` 加齐 frontmatter（脚本生成空骨架，再人工补 audience / type）
- [ ] `docs-site/scripts/check-doc-frontmatter.mjs`：CI 强制 frontmatter 必填字段
- [ ] `docs-site/scripts/check-doc-freshness.mjs`：last_reviewed 超 180 天 warning
- [ ] VitePress 主题 patch：sidebar 项右侧渲染 audience badge；搜索结果带 type 标签
- [ ] `docs-site/scripts/generate-env-vars.mjs`：从 `.env.example` 生成 `dev/reference/env-vars.md`
- [ ] 写 `dev/tutorials/first-contribution.md`（占位 → 真内容）
- [ ] 写 3 篇 ops/runbooks/*（celery / ml-backend / pg-pool）
- [ ] CHANGELOG / DEV.md / CLAUDE.md 中所有 `docs-site/` 路径引用全量批改
- [ ] 写 `docs/adr/00XX-docs-ia-redesign.md`，记录 Diátaxis 选型与 audience 字段约定

**验收**：
1. 旧 URL 经 redirect 仍能打开（外链不烂）
2. 任一页搜索 audience=annotator 能筛出标注员相关页
3. 所有页通过 frontmatter 校验
4. CHANGELOG 不再出现「文档新增 / 移动」混杂（迁移走 ADR + 一次性大 PR）

---

## 5. 风险与对策

| 风险 | 概率 | 缓解 |
|---|---|---|
| 物理迁移破坏外链 / 书签 | 高 | M2 强制配置 redirects；加 `pnpm docs:check-links-external` 跑外站抽样 |
| frontmatter 维护成本 | 中 | M2 脚本生成默认骨架；CI 只校验必填，不校验"准确" |
| 中英双语化（未来）| 低 | M1 不引入；M2 只为 audience/type 留中英映射，等专门版本做 |
| 团队接受度 | 中 | M1 上线后跑 1 个 sprint 听反馈再做 M2；ADR 写明可回滚路径 |
| 与 changelog/roadmap mirror 脚本冲突 | 低 | 不动 `docs-site/changelog/` `docs-site/roadmap/` `docs-site/adr/` 三个生成目录 |

---

## 6. 不做的事

- ❌ 不引入 i18n / 中英双语（成本高，等专门版本）
- ❌ 不替换 VitePress（社区生态足够；切 Astro Starlight / Docusaurus 是另一个提案）
- ❌ 不强行写所有 tutorials（先一篇起步，后续按需补）
- ❌ 不写"自动从代码生成 user-guide"（业务文档天然需要人写）

---

## 7. 开放问题

1. ops 板块独立必要性：是顶 nav 一级，还是塞在 dev 下作为折叠目录？
   - 倾向独立：部署人员经常不是开发者，不应让他们先穿过 dev sidebar
2. `audience: dev` 与 dev 板块本身重复，是否要去掉 dev？
   - 倾向保留 dev 作为 audience 值，因为文档也可能交叉（user-guide 里的某些 admin 页其实给 dev 看）
3. 物理迁移要不要分阶段（按板块逐个迁）？
   - 倾向一次性 PR：redirect 一次性写好；分阶段反而长期带「半新半旧」
4. tutorials 是否合并 examples/？
   - 待 examples/ 有真实内容时再合，目前 `examples/echo-ml-backend/` 单一示例，独立无妨

---

## 8. 文档与 ADR 产出

- [ ] **ADR-00XX**：文档 IA 采用 Diátaxis + audience metadata 的取舍
- [ ] `docs/research/` 加一篇 `12-docs-ia-references.md`，整理 Label Studio / CVAT / Encord / Roboflow 的 IA 截图与对照
- [ ] `CHANGELOG.md` —— M1 / M2 各加一段
- [ ] DEV.md / CLAUDE.md 文档索引段落同步更新（路径会变）

---

## 9. 时间预估

| 切片 | 估计工时 |
|---|---|
| M1 IA 轻量重排 | ~3 工作日 |
| M2 深度重构 + 元数据 | ~5 工作日 |
| **合计** | **~1.5 周** |

---

## Sources

- Diátaxis 框架：https://diataxis.fr/
- Label Studio Docs IA：https://labelstud.io/guide/
- CVAT Docs IA：https://opencv.github.io/cvat/docs/
- Roboflow Docs：https://docs.roboflow.com/
- Encord Docs：https://docs.encord.com/
- VitePress rewrites / sidebar：https://vitepress.dev/reference/site-config
- 内部参考：[CLAUDE.md 文档索引](../CLAUDE.md)、[docs-site/.vitepress/config.ts](../docs-site/.vitepress/config.ts)、[ROADMAP/0.10.x.md](./0.10.x.md)
