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

## 覆盖率

CI 上传到 [Codecov](https://codecov.io)，PR 评论显示 diff coverage。

**当前不设硬门槛**——避免起步阻塞日常开发。等覆盖率自然爬到 70% 后再卡。

## Pre-commit

`pre-commit install` 后每次 `git commit` 自动跑：

- ruff check + format（apps/api）
- eslint（apps/web）
- tsc --noEmit（apps/web）

如果 hook 失败，**不要** `--no-verify`，先把问题修了。
