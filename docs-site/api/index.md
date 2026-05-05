# API 文档

完整可交互的 OpenAPI 文档：[**打开 API Reference →**](/api-reference.html){target="_blank"}

<iframe
  src="/api-reference.html"
  style="width: 100%; height: 80vh; border: 1px solid var(--vp-c-divider); border-radius: 8px; margin-top: 1rem;"
  title="API Reference"
></iframe>

## 概览

后端基于 FastAPI，自动遵循 OpenAPI 3.1。

- **基础 URL（本地）**：`http://localhost:8000`
- **路由前缀**：`/api/v1`
- **认证**：JWT Bearer Token（`POST /api/v1/auth/login`）
- **错误格式**：`{"detail": "<message>"}` 或 Pydantic 校验数组
- **限流**：用户级，超出返回 `429 Too Many Requests`

## 静态契约

仓库中的真值源头：

```
apps/api/openapi.snapshot.json
```

每次后端路由 / Pydantic schema 变化都会刷新这份 snapshot；CI 校验运行时与 snapshot 一致，前端 `pnpm codegen` 也读它。

下载：[/openapi.json](/openapi.json)

## 本地实时文档

启动后端后：

- [Swagger UI](http://localhost:8000/docs)
- [ReDoc](http://localhost:8000/redoc)
- [openapi.json (live)](http://localhost:8000/openapi.json)

## 前端类型生成

`pnpm codegen` 根据 snapshot 重新生成 `apps/web/src/api/generated/`。
