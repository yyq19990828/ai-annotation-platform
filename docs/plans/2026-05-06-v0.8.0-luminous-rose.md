# v0.8.0 — 文档细化与补全

## Context

v0.7.x 已把功能、安全、治理、测试基座全部铺好（v0.7.4 落了 VitePress 三栏骨架，v0.7.5 性能 & DX 收尾，v0.7.6 功能补缺，v0.7.7/0.7.8 登录注册 + 安全加固）。但 ROADMAP §B「文档」分组仍有 7 项 open：4 个开发文档新页（deploy / security / ml-backend-protocol / ws-protocol）、ADR 0002-0005 回填、用户手册关键页填实、快捷键 SoT 化。

本期目标是把文档站从「骨架完整、内容大纲为主」推进到「可作为新人 onboarding 与运维交付物」。代码改动只限于 ① 新增快捷键自动生成脚本和 ② VitePress 侧边栏配置；文档主体新增/修订集中在 `docs-site/` 与 `docs/adr/`。

完成标志：管理员可以拿 `docs-site/dev/deploy.md` 完成首次 production bootstrap；ML backend 接入方可以仅靠 `ml-backend-protocol.md` 实现 `/health` + `/predict` 兼容服务；4 篇关键架构决策（后端选型 / OpenAPI 客户端 / Konva / 任务锁 + 审核矩阵）有正式 ADR 留档。

---

## 工作面（按依赖排序）

### 1. 4 个新开发文档页

新增于 `docs-site/dev/`：

| 文件 | 行数预估 | 关键内容 |
|---|---|---|
| `deploy.md` | 80-120 | docker-compose production profile、必填环境变量清单（含 v0.7.7/0.7.8 新增的 `ALLOW_OPEN_REGISTRATION` / `MAX_INVITATIONS_PER_DAY` / `JWT_BLACKLIST_REDIS_*` / `CORS_ORIGINS`）、TLS / 反代示例、首次 bootstrap_admin 步骤、备份与恢复（pg_dump + MinIO 桶同步）、升级/迁移 runbook |
| `security.md` | 60-100 | 威胁模型表、RBAC 角色×权限矩阵（super_admin / admin / pm / annotator / reviewer / viewer）、JWT 生命周期 + jti/gen 黑名单（v0.7.8）、邀请流程时序图（mermaid）、审计日志字段释义 + 不可变 trigger（v0.7.8）、密码策略 + 失败登录限流 + user_agent 记录 |
| `ml-backend-protocol.md` | 100-150 | 约束接入方实现的 4 个端点：`GET /health` / `GET /setup` / `GET /versions` / `POST /predict`（同步 + 交互式两种 payload）；鉴权（`auth_method=none\|token`，token 走 Authorization: Bearer）；`is_interactive` 字段语义；错误格式约定；`prediction_metas` token/cost 透传约定；最小 echo backend 示例（FastAPI 50 行） |
| `ws-protocol.md` | 80-120 | 两个频道：`/ws/notifications`（JWT query param 鉴权 + `notify:{user_id}` 订阅 + NotificationOut payload）、`/ws/projects/{pid}/preannotate`（progress payload）；30s 心跳 ping 约定（防 LB idle 断连）；前端指数退避重连策略（1s 起，30s 上限，8 次）；扩展新频道的 how-to |

代码引用全部以 `apps/api/...:行号` 形式标注，便于读者跳转。

**关键素材**（探索报告已收集）：
- ML Backend 服务: `apps/api/app/services/ml_backend.py:11-76`
- ML Client: `apps/api/app/services/ml_client.py:19-97`
- WebSocket 端点: `apps/api/app/api/v1/ws.py:1-115`
- 前端 WS hooks: `apps/web/src/hooks/useNotificationSocket.ts`, `usePreannotation.ts`, `useReconnectingWebSocket.ts`

### 2. ADR 0002-0005 回填

写在 `docs/adr/`，每篇 80-150 行，按 ADR 模板（Status / Context / Decision / Consequences / Alternatives Considered）。选题按 ROADMAP §B 建议：

- `0002-backend-stack-fastapi-sqlalchemy-alembic.md` — FastAPI（异步 + Pydantic）、SQLAlchemy 2.0 async、Alembic 选型；对比 Django REST / Tortoise / Prisma
- `0003-openapi-client-codegen.md` — `@hey-api/openapi-ts` 选型；对比 orval（强 react-query 集成）/ swagger-typescript-api（更老）；为什么不手写
- `0004-canvas-stack-konva.md` — Konva（4 Layer 架构）选型；对比 Fabric.js（事件模型重）/ 原生 Canvas（手写脏矩形）；性能基线（v0.5.x 实测）
- `0005-task-lock-and-review-matrix.md` — Task 5min TTL 锁机制 + 审核流转角色矩阵（pending → in_progress → submitted → approved/rejected → reopened）；为什么 5min（与 batch scheduler 协调）

### 3. data-flow.md mermaid 图增加代码路径标注

`docs-site/dev/architecture/data-flow.md` 当前已有 4 个 mermaid 序列图（标注链路 / AI 预标注 / 数据导出 / 实时通知）。本期改造：在每个 actor 节点和关键消息上补 `apps/api/...:行号` 标注（mermaid 支持 `note over` 注释），让读者可点 GitHub 跳转到具体函数。

### 4. how-to/add-api-endpoint.md 改成真实 v0.7.x 端点示例

当前文档用的是 widgets 占位例。改成走 v0.7.8 新增的 `POST /auth/logout` 全链路：路由 → service → schema → 测试 → OpenAPI 重生成 → 前端 hook。素材直接从最近 commits 抽取。

### 5. 快捷键 SoT 化

新增 `scripts/generate-hotkeys-md.ts`：
- 读 `apps/web/src/pages/Workbench/state/hotkeys.ts` 的 `HOTKEYS` 数组（结构: `{ keys, desc, group, actionType? }`）和 `GROUP_LABEL`
- 按 group 分组 → 输出 Markdown 表到 `docs-site/user-guide/workbench/hotkeys.generated.md`（文件头加 `<!-- AUTO-GENERATED -->` 警示）
- 在 `docs-site/user-guide/workbench/index.md` 用 VitePress 的 `<!--@include: ./hotkeys.generated.md-->` 内联
- 在 `package.json` 加 `pnpm docs:hotkeys`，并在 `pnpm docs:dev` / `docs:build` 的 prebuild hook 自动跑一次（或加 husky pre-commit）
- 删除 `index.md` 中手抄的快捷键表

### 6. 用户手册关键页截图占位

仅放占位 + 拍图清单，用户后续手动补图。涉及页面：
- `docs-site/user-guide/getting-started.md` — 端到端 GIF（登录 → 标第一个任务 → 提交）+ 登录页 + 忘记密码（v0.7.8 新增）3 张截图占位
- `docs-site/user-guide/workbench/bbox.md` — 工具栏 + IoU 阈值 + 批量编辑 3 张
- `docs-site/user-guide/workbench/polygon.md` — 顶点编辑 + 闭合提示 + simplify 2 张
- `docs-site/user-guide/workbench/keypoint.md` — 模板示例（人体/手部）2 张
- `docs-site/user-guide/projects/index.md` — 6 步 wizard 关键页截图
- `docs-site/user-guide/review/index.md` — 审核界面 + 拒绝反馈表单 2 张
- `docs-site/user-guide/export/index.md` — 导出格式选择 + 进度 2 张

每处放 `![登录页](./images/getting-started/login.png)<!-- TODO(0.8.1): 拍图，分辨率 1920x1080，标注红框：邮箱+密码+登录按钮 -->` 占位。同时新建 `docs-site/user-guide/IMAGE_CHECKLIST.md`（不上侧边栏）汇总所有占位项 + 拍摄要求（角度、分辨率、标注、敏感信息脱敏）。

### 7. VitePress 侧边栏更新

修改 `docs-site/.vitepress/config.ts`：在 `sidebar["/dev/"]` 的 `架构` 组之后插入新分组「部署与协议」，含 deploy / security / ml-backend-protocol / ws-protocol 4 项。`sidebar["/user-guide/"]` 不变（hotkeys.generated.md 通过 include 内联，不单独占侧边栏项）。

### 8. ROADMAP / CHANGELOG 收尾

- `CHANGELOG.md` — 新增 `## v0.8.0 — luminous-rose (2026-05-XX)`，按 docs / adr / dev-experience 分组列出
- `ROADMAP.md` — 把已完成项划线（B §文档 7 项中的 6 项；快捷键 SoT 化；ADR 0002-0005）；用户手册截图填实迁到 0.8.1 候选

---

## 关键文件清单

### 新增

```
docs-site/dev/deploy.md
docs-site/dev/security.md
docs-site/dev/ml-backend-protocol.md
docs-site/dev/ws-protocol.md
docs-site/user-guide/workbench/hotkeys.generated.md   # 自动生成产物
docs-site/user-guide/IMAGE_CHECKLIST.md
docs/adr/0002-backend-stack-fastapi-sqlalchemy-alembic.md
docs/adr/0003-openapi-client-codegen.md
docs/adr/0004-canvas-stack-konva.md
docs/adr/0005-task-lock-and-review-matrix.md
scripts/generate-hotkeys-md.ts
```

### 修改

```
docs-site/.vitepress/config.ts                         # 侧边栏新增「部署与协议」组
docs-site/dev/architecture/data-flow.md                # mermaid 图补代码路径标注
docs-site/dev/how-to/add-api-endpoint.md               # 改成 POST /auth/logout 真实例子
docs-site/user-guide/workbench/index.md                # 删手抄表 + include hotkeys.generated.md
docs-site/user-guide/getting-started.md                # 加截图占位
docs-site/user-guide/workbench/{bbox,polygon,keypoint}.md  # 加截图占位
docs-site/user-guide/{projects,review,export}/index.md # 加截图占位
package.json                                           # +pnpm docs:hotkeys + prebuild hook
CHANGELOG.md                                           # +v0.8.0 节
ROADMAP.md                                             # 划线已完成项
```

### 引用素材文件（只读）

```
apps/api/app/services/ml_backend.py:11-76
apps/api/app/services/ml_client.py:19-97
apps/api/app/db/models/{ml_backend,prediction}.py
apps/api/app/api/v1/ws.py:1-115
apps/api/app/api/v1/auth.py                           # logout 端点（add-api-endpoint 例子素材）
apps/web/src/hooks/{useNotificationSocket,usePreannotation,useReconnectingWebSocket}.ts
apps/web/src/pages/Workbench/state/hotkeys.ts          # SoT
docs-site/.vitepress/config.ts                         # 113 行，sidebar 结构已知
```

---

## 实施顺序

1. **A 批 · 协议文档**（独立、素材已齐）：ml-backend-protocol.md → ws-protocol.md
2. **B 批 · 运维文档**（需对照 .env.example / docker-compose）：deploy.md → security.md
3. **C 批 · ADR**（独立写作）：0002 → 0003 → 0004 → 0005
4. **D 批 · 现有文档增改**：data-flow.md mermaid 标注 → add-api-endpoint.md 重写
5. **E 批 · 快捷键 SoT**：写 generate-hotkeys-md.ts → 跑一次产出 hotkeys.generated.md → 改 index.md include → 接 prebuild hook
6. **F 批 · 截图占位**：批量加 `<!-- TODO(0.8.1) -->` 占位 + 写 IMAGE_CHECKLIST.md
7. **G 批 · 收尾**：config.ts 侧边栏 → CHANGELOG → ROADMAP 划线 → 本地 `pnpm docs:dev` 全站点穿一次

---

## 验证

### 本地构建

```bash
pnpm install
pnpm docs:hotkeys                # 新脚本：产出 hotkeys.generated.md，对比 git diff 应无意外变更
pnpm docs:build                  # VitePress 全站构建无 dead-link / 无 missing-include 警告
pnpm docs:dev                    # 浏览器打开 http://localhost:5173
```

逐项点穿：
- /dev 侧边栏「部署与协议」分组 4 项可见可点
- /dev/architecture/data-flow 4 个 mermaid 图正常渲染，节点标注的代码路径可点
- /user-guide/workbench 快捷键表内容与 hotkeys.ts 一致（增改 hotkeys.ts 一项 → 重跑 docs:hotkeys → 表更新）
- /adr 索引页（如有）能看到 0002-0005

### 协议文档可执行性

按 `ml-backend-protocol.md` 的最小 echo 示例起一个 backend：
```bash
uv run python docs-site/dev/examples/echo-ml-backend/main.py
```
然后在前端 ProjectSettings → ML Backends 添加该 URL，点「测试连接」应通过。

### ADR 模板一致性

```bash
ls docs/adr/000{2,3,4,5}-*.md | xargs -I {} grep -l "^## Status" {}
```
4 个文件全有 Status / Context / Decision / Consequences 章节。

### CI

`pnpm test` 应不受影响（脚本不进 vitest）；docs CI（如有）需通过。

---

## 风险与边界

- **截图本期不交付**：占位与 IMAGE_CHECKLIST 提交，0.8.0 在用户回填截图前不阻断发布。
- **ADR 是事后补档**：决策已落地于代码，ADR 描述「当时为什么选 X」需查 git log + 现有依赖版本，不再做选型对比 PoC。
- **hotkeys.generated.md 进 git**：不放 .gitignore；保证用户不跑脚本时文档站仍可构建。CI 加一步「跑脚本后 git diff 应为空」防止 hotkeys.ts 改了但忘 commit 文档。
- **不做的事**：不动 i18n（仍中文硬编码）、不动 ML Backend 周期健康检查、不写部署 IaC（terraform/k8s yaml）、不补图。
