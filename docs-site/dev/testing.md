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

| Fixture | 用途 |
|---|---|
| `db_session` | function-scoped，SAVEPOINT 隔离的 DB 会话 |
| `httpx_client` | ASGI 客户端，依赖注入了 db_session |
| `super_admin` / `project_admin` / `annotator` / `reviewer` | 4 角色 fixture，带 JWT token |

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
docker compose up -d
cd apps/api && uv run uvicorn app.main:app --port 8000 &
cd apps/web && pnpm dev &
cd apps/web && pnpm test:e2e
```

**何时写 E2E**：跨页面流程、长链路、涉及 WebSocket / 文件上传。

**何时不写 E2E**：单组件交互、纯逻辑校验。

### `_test_seed` router + e2e fixture（v0.8.3）

E2E spec 通过 `apps/web/e2e/fixtures/seed.ts` 调后端 `/api/v1/__test/seed/*` 端点造数：

```ts
// apps/web/e2e/tests/auth.spec.ts
import { test, expect } from "../fixtures/seed";

test("正确凭证 → 跳 dashboard", async ({ page, seed }) => {
  const data = await seed.reset();                  // truncate + 重建固定 fixture
  await seed.loginViaUI(page, data.admin_email, "Test1234");
  await expect(page).toHaveURL(/\/dashboard/);
});

test("注入 token 跳 UI 登录", async ({ page, seed }) => {
  const data = await seed.reset();
  await seed.injectToken(page, data.annotator_email);  // 直接 localStorage 注入
  await page.goto("/annotate");
});
```

**安全约束**：`_test_seed` router **仅**当 `settings.environment != "production"` 时挂载（`apps/api/app/api/v1/router.py` 末尾条件 import），即使误挂端点入口也再做一次环境守卫。

**fixture 用法**：`reset()` 返回固定结构（admin/annotator/reviewer 三个邮箱 + 项目 id + 5 个任务 id）；密码统一 `Test1234`。新增数据用 `apps/api/tests/factory.py` 的 `create_user / create_project / create_task / create_batch`。

## 覆盖率

CI 上传到 [Codecov](https://codecov.io)，PR 评论显示 diff coverage。

**v0.8.3 切硬阻断**：`codecov.yml` backend `informational: false`（target 60%）+ frontend `informational: false`（target 10%，实测 10.88% 留 0.88pp 容差）。`apps/web/vite.config.ts` coverage thresholds 同步生效（lines/statements ≥ 10）；`pnpm test:coverage` 低于阈值非 0 退出。

ROADMAP 列出的 ≥ 25% 目标继续推：补 InviteUserModal / RegisterPage / Dashboard / ProjectList / WorkbenchShell 等页面级单测，达标后上调阈值。

## Pre-commit

`pre-commit install` 后每次 `git commit` 自动跑：

- ruff check + format（apps/api）
- eslint（apps/web）
- tsc --noEmit（apps/web）

如果 hook 失败，**不要** `--no-verify`，先把问题修了。
