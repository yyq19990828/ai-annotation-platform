---
audience: [dev]
type: reference
since: v0.1.0
status: stable
last_reviewed: 2026-07-23
---

# 测试指南

## 测试金字塔

```
        ╱╲
       ╱E2E╲      少量、慢、覆盖关键用户路径
      ╱──────╲
     ╱集成测试╲    适量、按 API 端点为单元
    ╱──────────╲
   ╱  单元测试  ╲   大量、快、覆盖纯逻辑
  ╱──────────────╲
```

按这个比例分配精力。**不要**为单一函数写 E2E、也不要为页面跳转写单元测试。

## 后端：pytest

### 跑

```bash
cd apps/api
uv run pytest                                # 全部
uv run pytest tests/test_smoke.py -v         # 单文件
uv run pytest -k "batch_lifecycle"           # 关键字过滤
uv run pytest --cov=app --cov-report=html    # 看覆盖率
```

报告：`htmlcov/index.html`。

### Fixture（已就绪）

`tests/conftest.py` 提供：

| Fixture                                                    | 用途                                      |
| ---------------------------------------------------------- | ----------------------------------------- |
| `db_session`                                               | function-scoped，SAVEPOINT 隔离的 DB 会话 |
| `httpx_client`                                             | ASGI 客户端，依赖注入了 db_session        |
| `super_admin` / `project_admin` / `annotator` / `reviewer` | 4 角色 fixture，带 JWT token              |

### 写一个 API 测试

```python
async def test_create_project(httpx_client, project_admin):
    headers = {"Authorization": f"Bearer {project_admin['token']}"}
    res = await httpx_client.post(
        "/api/v1/projects",
        json={"name": "demo", "type_key": "bbox", "classes": ["car"]},
        headers=headers,
    )
    assert res.status_code == 201
    body = res.json()
    assert body["name"] == "demo"
```

### OpenAPI 契约测试

每次改路由 / Pydantic schema：

```bash
# 改完路由后
cd apps/api
uv run python ../../scripts/export_openapi.py
git add openapi.snapshot.json
```

CI 中 `tests/test_openapi_contract.py` 会校验 snapshot 与运行时一致；忘了刷就 fail。前端 `pnpm codegen` 也读这个 snapshot，所以 snapshot 是前后端契约的真值源头。

## 前端：vitest + MSW

### 跑

```bash
cd apps/web
pnpm test                  # 一次性跑
pnpm test:watch            # watch
pnpm test:coverage         # 带覆盖率
```

### MSW 用法

`vitest.setup.ts` 已挂上 MSW server，默认 handlers 在 `src/mocks/handlers.ts`。

单测里临时覆盖某个 endpoint：

```ts
import { http, HttpResponse } from "msw";
import { server } from "@/mocks/server";

it("空态文案", async () => {
  server.use(
    http.get("*/api/v1/projects", () =>
      HttpResponse.json({ items: [], total: 0 }),
    ),
  );

  render(<ProjectList />);
  expect(await screen.findByText(/还没有项目/)).toBeInTheDocument();
});
```

### 写组件测试的边界

✅ 写：渲染分支、用户交互后的状态变化、与服务端契约的校验
❌ 不写：颜色样式、像素级布局、内部状态字段名

## 前端：Playwright E2E

详见 `apps/web/e2e/README.md`。

启动：

```bash
docker compose up -d postgres redis minio
pnpm test:e2e
```

Playwright 会自动准备专用逻辑库 `annotation_e2e`、执行迁移，并启动 Web
`127.0.0.1:3001` 与 API `127.0.0.1:8010`。它不会复用开发环境的
`3000/8000`；专用端口被占用时会直接失败。如需替换隔离测试库，设置
`PLAYWRIGHT_E2E_DATABASE_URL`，并保持库名以 `_e2e` 或 `_test` 结尾。

**何时写 E2E**：跨页面流程、长链路、涉及 WebSocket / 文件上传。

**何时不写 E2E**：单组件交互、纯逻辑校验。

### `_test_seed` router + E2E fixture

E2E spec 通过 `apps/web/e2e/fixtures/seed.ts` 调后端 `/api/v1/__test/seed/*` 端点造数：

```ts
// apps/web/e2e/tests/auth.spec.ts
import { test, expect } from "../fixtures/seed";

test("正确凭证 → 跳 dashboard", async ({ page, seed }) => {
  const data = await seed.reset(); // 清理并重建固定 fixture
  await seed.loginViaUI(page, data.admin_email, "Test1234");
  await expect(page).toHaveURL(/\/dashboard/);
});

test("注入 token 跳 UI 登录", async ({ page, seed }) => {
  const data = await seed.reset();
  await seed.injectToken(page, data.annotator_email); // 直接 localStorage 注入
  await page.goto("/annotate");
});
```

**安全约束**：路由默认关闭，只有非 production 进程显式设置
`E2E_SEED_ENABLED=true` 时才会挂载。路由的统一守卫还会在当前会话查询
`current_database()`，数据库名不以 `_e2e` 或 `_test` 结尾时拒绝所有
seed/login/cleanup 请求。production 即使设置开关也不挂载路由。

**fixture 用法**：`reset()` 返回固定结构（admin/annotator/reviewer 三个邮箱 + 项目 id + 5 个任务 id）；密码统一 `Test1234`。新增数据用 `apps/api/tests/factory.py` 的 `create_user / create_project / create_task / create_batch`。

Playwright 正常结束时由 `globalTeardown` 调用 `/seed/cleanup`。它只是兜底：
强制中断可能跳过 teardown，因此必须始终依赖 `annotation_e2e` 的数据库隔离，
不能把 cleanup 当成可在开发库运行 E2E 的理由。

## 覆盖率

CI 上传到 [Codecov](https://codecov.io)，PR 评论显示 diff coverage。

**v0.8.3 切硬阻断**：`codecov.yml` backend `informational: false`（target 60%）+ frontend `informational: false`（target 10%，实测 10.88% 留 0.88pp 容差）。`apps/web/vite.config.ts` coverage thresholds 同步生效（lines/statements ≥ 10）；`pnpm test:coverage` 低于阈值非 0 退出。

ROADMAP 列出的 ≥ 25% 目标继续推：补 InviteUserModal / RegisterPage / Dashboard / ProjectList / WorkbenchShell 等页面级单测，达标后上调阈值。

## Pre-commit

先执行 `uv tool install "pre-commit==4.6.1" && pre-commit install`。之后每次
`git commit` 自动跑：

- Ruff check + format（全部第一方 Python，排除 vendor）
- Prettier（本次提交涉及的受支持文本文件）
- eslint（apps/web）
- tsc --noEmit（apps/web）

如果 hook 失败，**不要** `--no-verify`，先把问题修了。

CI 在全仓 `format:check`、Ruff、ESLint 和类型检查之外，还会以 `manual` 阶段执行一次
`pre-commit --all-files`。该阶段跳过会写入并暂存 OpenAPI、能力词表和文档生成物的三个
本地提交 hook；这些生成物继续由 OpenAPI 契约测试、能力词表契约测试和文档 codegen
只读检查兜底。
