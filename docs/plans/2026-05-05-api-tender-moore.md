# 2026-05-05- 测试与文档体系一次性建齐

## Context

项目已进入 v0.7 阶段（CHANGELOG 2300+ 行、77 个后端测试、216 个前端文件），但「质量与知识传递」的基础设施滞后于代码增长：

- **测试**：后端 77 个测试无 coverage 统计、前端仅 8 个 vitest、无 E2E、CI lint 用 `|| true` 不阻断
- **文档**：有 DEV.md / CHANGELOG.md，但**无用户手册、无 ADR、无文档站点、无静态化的 API 文档**
- **API 契约**：FastAPI 自带 `/docs` 但仅靠运行时；前端用 `@hey-api/openapi-ts` 生成类型，无版本化、无 diff 检查

目标：**一次性把 4 块（测试 / 用户文档 / 开发文档 / API 文档）的骨架与红线都立起来**，后续日常开发只填内容、不再补地基。

用户决策：
- 节奏：**立刻全部建齐**（1 周骨架，后续填充）
- 用户文档形态：**VitePress 文档站**
- CI 严格度：**中等**（lint 阻断、coverage 上报不阻断）

---

## 总体架构

```
ai-annotation-platform/
├── apps/
│   ├── api/        # 后端：补 coverage、契约测试、OpenAPI 导出
│   └── web/        # 前端：补单测、加 Playwright E2E、加 MSW
├── docs-site/      # 【新】VitePress 文档站（用户 + 开发 + API 三合一）
│   ├── .vitepress/config.ts
│   ├── user-guide/
│   ├── dev/
│   └── api/        # 由 openapi.json 自动生成
├── docs/           # 保留：研究报告、计划归档、ADR
│   ├── adr/        # 【新】架构决策记录
│   ├── research/   # 已有
│   └── plans/      # 已有
├── .github/workflows/
│   ├── ci.yml      # 改：lint 阻断、加 coverage 上报、加 E2E、加 openapi-diff
│   └── docs.yml    # 【新】docs-site 构建与发布
├── .pre-commit-config.yaml  # 【新】
└── scripts/
    └── export-openapi.ts    # 【新】把 /openapi.json 落盘成版本化文件
```

文档站统一三类受众，避免维护多个站点：
- `/user-guide/` → 标注员与项目管理员
- `/dev/` → 内部工程师
- `/api/` → 集成方与前端开发者（自动生成）

---

## 一、测试体系

### 1.1 后端（apps/api）

**新增 coverage 配置**（`apps/api/pyproject.toml`）：

```toml
[tool.coverage.run]
source = ["app"]
branch = true
omit = ["app/migrations/*", "app/main.py"]

[tool.coverage.report]
show_missing = true
skip_covered = false
exclude_lines = ["pragma: no cover", "raise NotImplementedError"]

[tool.pytest.ini_options]
addopts = "-q --cov=app --cov-report=term-missing --cov-report=xml"
```

**契约测试**（新增 `apps/api/tests/test_openapi_contract.py`）：

- 导出当前 openapi.json
- 与仓库内 `apps/api/openapi.snapshot.json` 比对
- 不一致即 fail（强制 PR 提交时刷新 snapshot，让 reviewer 看到 API 变更）

**复用项**：
- `conftest.py` 的 4 角色 fixture（super_admin / project_admin / annotator / reviewer）已经做得不错，新增测试直接复用
- `httpx_client` ASGI 客户端 + SAVEPOINT 隔离已有，无需重建

### 1.2 前端（apps/web）

**新增 MSW**（`apps/web/src/mocks/`）：

- `handlers.ts` 基于 `src/api/generated/types.gen.ts` 写 mock handlers
- `vitest.setup.ts` 注入 server，组件单测自动启用
- 为 Workbench、Dashboard、ProjectList 三个核心页面补单测（每页至少 1 个）

**新增 Playwright E2E**（`apps/web/e2e/`）：

```
e2e/
├── playwright.config.ts
├── fixtures/
│   └── seed-db.ts        # 调后端 API 准备数据
└── tests/
    ├── auth.spec.ts      # 登录/登出/JWT 续期
    ├── annotation.spec.ts # 标注核心路径
    └── batch-flow.spec.ts # 批次创建→分配→审核→导出
```

依赖前后端都起来（CI 中通过 docker-compose + uvicorn + vite preview 串起来）。

**前端 coverage**（`apps/web/vite.config.ts` test 段）：

```ts
test: {
  coverage: {
    provider: 'v8',
    reporter: ['text', 'json', 'html', 'lcov'],
    exclude: ['src/api/generated/**', '**/*.config.ts'],
  },
}
```

### 1.3 CI 改造（`.github/workflows/ci.yml`）

| Job | 现状 | 改造 |
|---|---|---|
| `pytest` | 有 | 加 `--cov` + 上传 codecov |
| `vitest` | 有 | 加 coverage 上报 |
| `lint` | `\|\| true` 容错 | **去掉 `\|\| true`，失败阻断**；加 `pnpm typecheck` |
| `e2e` | 无 | 【新】docker-compose up + uvicorn + vite preview + `npx playwright test` |
| `openapi-contract` | 无 | 【新】启动 API、导出 openapi.json、与 snapshot diff，不一致 fail |

**Codecov 集成**（不设硬门槛，仅 PR 上显示 diff coverage 与趋势）：仓库根加 `.codecov.yml`，门槛设为 informational（不阻断）。

### 1.4 Pre-commit（`.pre-commit-config.yaml`）

```yaml
repos:
  - repo: https://github.com/astral-sh/ruff-pre-commit
    hooks: [{id: ruff}, {id: ruff-format}]
  - repo: local
    hooks:
      - id: eslint
        name: eslint
        entry: pnpm --filter @anno/web lint
        language: system
        files: ^apps/web/.*\.(ts|tsx)$
      - id: typecheck-web
        name: typecheck web
        entry: pnpm --filter @anno/web exec tsc --noEmit
        language: system
        pass_filenames: false
        files: ^apps/web/.*\.(ts|tsx)$
```

DEV.md 加一节「首次 clone 后跑 `pre-commit install`」。

---

## 二、用户文档（VitePress）

### 2.1 站点搭建

```
docs-site/
├── package.json       # vitepress + @nolebase/vitepress-plugin-* (可选)
├── .vitepress/
│   └── config.ts      # 三栏导航：用户 / 开发 / API
├── index.md           # 首页（产品定位 + 核心入口）
├── user-guide/
│   ├── index.md
│   ├── getting-started.md
│   ├── workbench/     # 标注工作台（截图 + 快捷键）
│   ├── projects/      # 项目与批次管理
│   ├── review/        # 审核流程
│   ├── export/        # 数据导出
│   └── faq.md
├── dev/               # 见第三节
└── api/               # 见第四节
```

### 2.2 内容范围（骨架优先，第一批必备页）

- **getting-started.md**：登录、第一个标注任务的端到端流程（含截图）
- **workbench/**：每种标注类型（bbox / polygon / 关键点 / 分类）一篇 + 快捷键表（直接从 `pages/Workbench/state/hotkeys.test.ts` 测试用例提取真值）
- **projects/**：项目创建 → 上传数据 → 配置标注规范 → 分配人员
- **review/**：审核员视角的工作流、IoU 阈值意义
- **export/**：COCO / YOLO / Label Studio JSON 三种格式的差异

### 2.3 部署

- `.github/workflows/docs.yml`：push 到 main 时构建 docs-site，发布到 GitHub Pages
- 也支持本地 `pnpm --filter docs-site dev` 预览

---

## 三、开发文档（VitePress 内 `/dev`）

### 3.1 内容架构

```
docs-site/dev/
├── index.md                  # 入口（迁移 DEV.md 大部分内容）
├── architecture/
│   ├── overview.md           # 系统全景图（Mermaid）
│   ├── backend-layers.md     # api/services/db/workers 分层
│   ├── frontend-layers.md    # pages/state/api 分层
│   └── data-flow.md          # 标注数据从上传到导出的完整链路
├── how-to/
│   ├── add-api-endpoint.md   # 新增 API 的标准流程（含 OpenAPI 同步）
│   ├── add-page.md           # 新增前端页面
│   ├── add-migration.md      # Alembic 迁移操作流程
│   └── debug-celery.md
├── testing.md                # 如何写测试（fixtures、MSW、Playwright 用法）
├── conventions.md            # 命名、提交、PR 规范
└── release.md                # 版本流程 + CHANGELOG 维护规则
```

### 3.2 ADR（`docs/adr/`）

新建目录，初始化 `0001-record-architecture-decisions.md`（采用 Michael Nygard 模板）。

**回填一批关键决策**（基于 CHANGELOG 与 docs/research/）：
- 0002: 选择 FastAPI + SQLAlchemy + Alembic
- 0003: 前端 OpenAPI 类型生成方案选 `@hey-api/openapi-ts`
- 0004: 标注 Canvas 选 Konva
- 0005: 任务锁与审核流的状态机设计

ADR 文件直接 Markdown，不进文档站（保留为内部档案）。

### 3.3 docs/ 旧目录的角色再定位

- `docs/research/` 保留原位（深度调研，受众是决策者）
- `docs/plans/` 保留原位（开发流水账）
- `docs/adr/` 新增（架构决策档）
- 用户文档和开发指南**不放在 docs/ 而放在 docs-site/**，避免与 plans/research 混淆

---

## 四、后端 API 文档

### 4.1 OpenAPI 静态化

新增 `scripts/export-openapi.ts`（或 Python 等价物）：

```ts
// 启动 FastAPI -> fetch /openapi.json -> 写入 apps/api/openapi.snapshot.json
//                                       -> 写入 docs-site/api/openapi.json
```

放进 `package.json` scripts：

```json
"openapi:export": "tsx scripts/export-openapi.ts",
"openapi:check": "tsx scripts/export-openapi.ts --check"  // CI 用，diff 不一致即 fail
```

### 4.2 文档站 API 页

`docs-site/api/`：

- 用 [vitepress-openapi](https://vitepress-openapi.vercel.app/) 或 `@scalar/api-reference` 把 `openapi.json` 渲染成可读站点
- 每次 docs 构建时读取最新 snapshot
- URL 形如 `/api/projects/createProject`，按 tag 分组

### 4.3 增强 OpenAPI 元信息（提升文档质量）

后端 FastAPI 路由补充 docstring + response examples：
- 每个路由的 `summary`、`description`、`responses` 都写齐
- 用 `Annotated[..., Field(description=...)]` 给 schema 字段加描述
- 在 `app/main.py` 的 FastAPI 实例传入 `tags_metadata` 描述每个分组

这一步不一次性铺满，先建立 lint 规则（自定义 pytest 检查：所有 router 必须有 docstring）兜底。

### 4.4 前端 codegen 强化

- 现有 `pnpm codegen` 输入改为 `apps/api/openapi.snapshot.json`（脱离运行时依赖，CI 不需要起后端就能 build）
- 加 `pnpm codegen:check`：生成后比对 git diff，有变更但未提交即 fail
- 在 CI `vitest` job 前置 `pnpm codegen:check`

---

## 五、关键文件清单（创建/修改）

### 新建

```
docs-site/.vitepress/config.ts
docs-site/package.json
docs-site/index.md
docs-site/user-guide/index.md          (+ getting-started/workbench/projects/review/export/faq)
docs-site/dev/index.md                 (+ architecture/how-to/testing/conventions/release)
docs-site/api/index.md                 (+ openapi.json 渲染页)
docs/adr/0001-record-architecture-decisions.md
.pre-commit-config.yaml
.codecov.yml
.github/workflows/docs.yml
apps/web/src/mocks/handlers.ts
apps/web/src/mocks/server.ts
apps/web/e2e/playwright.config.ts
apps/web/e2e/tests/{auth,annotation,batch-flow}.spec.ts
apps/api/tests/test_openapi_contract.py
apps/api/openapi.snapshot.json
scripts/export-openapi.ts
```

### 修改

```
.github/workflows/ci.yml          # 去 || true、加 e2e job、加 openapi-contract job、加 codecov
apps/api/pyproject.toml           # coverage 配置 + addopts
apps/web/vite.config.ts           # vitest coverage
apps/web/vitest.setup.ts          # 启用 MSW server
apps/web/openapi-ts.config.ts     # 输入改为本地 snapshot
package.json                      # scripts: openapi:export / codegen:check / docs:dev / docs:build
DEV.md                            # 加 pre-commit 安装、文档站说明、迁移指引到 docs-site
CLAUDE.md                         # 文档索引指向 docs-site
README.md                         # 【新建】顶层入口（仓库当前没有）
```

### 复用

- `apps/api/tests/conftest.py` 的角色 fixture 与 httpx_client 一律复用，不重写
- `apps/web/src/api/generated/` 的类型在 MSW handlers 里直接 import
- `scripts/` 已有目录直接添加新脚本

---

## 六、验证方式（端到端）

执行完上述变更后，按以下流程验证骨架是否真的立起来：

1. **本地 pre-commit**
   `pre-commit install && git commit -m "test"` → 触发 ruff/eslint/typecheck

2. **后端测试 + coverage**
   `cd apps/api && uv run pytest` → 终端打印 coverage table；查看 `coverage.xml` 生成

3. **OpenAPI 契约**
   `pnpm openapi:export` 后改一个路由的 summary，再跑 `pnpm openapi:check` → 应 fail

4. **前端单测 + MSW**
   `pnpm --filter @anno/web test` → 至少 3 个新页面单测通过，MSW 拦截 fetch

5. **E2E**
   `docker-compose up -d postgres redis minio && pnpm --filter @anno/web exec playwright test` → 三个 spec 全绿

6. **文档站**
   `pnpm --filter docs-site dev` → 浏览器访问 localhost:5173，三栏导航（用户/开发/API）能切换；API 页能看到所有路由

7. **CI 红绿验证**
   推一个故意破坏 lint 的 PR → CI 应在 lint job fail（验证 `|| true` 已去掉）
   推一个改了 API 但没刷 snapshot 的 PR → CI 应在 openapi-contract job fail
   推一个加了新 page 的 PR → coverage 上报到 codecov，PR 评论显示 diff coverage

8. **GitHub Pages**
   合并到 main 后 docs.yml 触发，访问 GitHub Pages URL → 文档站可访问

---

## 七、不在本次范围内（避免 scope creep）

- **填充用户文档全部内容**：本次只建骨架 + 关键 5-7 篇，其余按月迭代
- **后端测试覆盖率达标**：本次只接通统计与上报，不要求覆盖率达到某个数字
- **i18n 文档**：先单语（中文）；后续再加英文
- **changelog 自动化**（如 changesets）：CHANGELOG.md 当前手写已经良好，不引入工具
- **API mock 服务化**：MSW 仅用于测试，不替代后端
