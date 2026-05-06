# 0003 — 前端 OpenAPI 客户端生成方案：@hey-api/openapi-ts

- **Status:** Accepted
- **Date:** 2026-05-06（回填；选型实际发生于 v0.4.x 阶段）
- **Deciders:** core team
- **Supersedes:** —

## Context

后端 OpenAPI schema（FastAPI 自动生成 + 路由 docstring/responses 增强，参见 ADR-0002）总计 140+ 端点 + 200+ DTO。前端调用必须满足：

1. **类型与后端 1:1**：DTO 字段命名/可空性/枚举值任何变化，前端 TS 类型立即报错。
2. **codegen 可重复**：`pnpm codegen` 必须确定性输出，不能因生成器版本/操作系统差异产生 diff 噪声。
3. **请求库可换**：未来不排除从 axios 迁到 fetch / ofetch / hono client，generator 不应硬绑死单一 HTTP 库。
4. **可分包**：把不同 tag（auth / projects / tasks）的 service 拆成不同文件，避免一个 mega `api.ts` 几千行。

候选生成器：

| 选项 | 主要卖点 | 主要劣势 |
|---|---|---|
| **@hey-api/openapi-ts** | 现代、活跃维护、配置简单、产物清爽（type + service split） | 生态较新（< 1 年），文档相对少 |
| orval | 与 react-query / SWR 深度集成，自动生成 useQuery hook | 强约定 react-query；切换 server state lib 需重写 |
| swagger-typescript-api | 老牌、长期稳定 | 生成的代码偏冗长、JSDoc 多到污染 IDE；项目 maintenance 状态不稳 |
| openapi-generator-cli (Java) | 业界标准、最完整 | 需要 JDK 启动慢（数十秒）；TS 模板偏过时；不在 npm 工作流原生 |
| 手写 wrapper | 零依赖 | 200+ DTO 不可能手维护；类型对齐成本溢出 |

## Decision

采用 **`@hey-api/openapi-ts` 0.55+** 作为前端 OpenAPI → TypeScript 客户端生成方案，结合 **后端 OpenAPI snapshot 文件**作为契约基线。

工作流：

1. 后端跑 `uv run python scripts/export_openapi.py`，把当前 FastAPI 的 OpenAPI 写到 `apps/api/openapi.snapshot.json`（进 git，作为契约基线）。
2. 前端 `pnpm codegen` 调用 `openapi-ts` 读 snapshot → 输出 `apps/web/src/api/generated/{types.gen.ts, sdk.gen.ts}`。
3. 业务代码 import 自 `@/api/generated`，永不直接 fetch URL 字符串。
4. CI 跑 `pnpm openapi:check`：重新 export → 与 snapshot diff，有差异即 fail（强制开发者主动 commit snapshot 变更）。
5. v0.7.6 起 `apps/web/scripts/codegen-if-changed.mjs` 在 prebuild 阶段比较 hash，仅在 snapshot 变化时跑 codegen，避免每次 build 重做。

## Consequences

正向：

- 类型路径短：路由改 → snapshot 变 → codegen → 业务文件 TS 报错。无运行期惊喜。
- snapshot 进 git 让 PR review 可见 API 变更：即使后端 PR 描述没写「新增 endpoint」，diff 里 snapshot 也会暴露。
- 与 server state lib 解耦：当前用 `@tanstack/react-query`，业务层手包 `useQuery({ queryKey: ..., queryFn: () => sdk.getProject(id) })`；未来切换不需要重新 codegen。
- 产物干净：types.gen.ts 只含类型定义，sdk.gen.ts 只含调用函数，分文件易 tree-shake。

负向：

- 没有自动 useQuery hook，每个业务方都要包一遍。这是有意为之——避免把 cache key 命名/失效策略锁死在 generator 上。但确实多写一些胶水。
- snapshot 进 git 偶尔产生 conflict（两个分支同时改 schema）。处理方式：先 rebase，重新跑 `uv run python scripts/export_openapi.py`，accept 重新生成的 snapshot。
- `@hey-api/openapi-ts` 仍处快速演进期；major bump 可能要求小幅调整 codegen config。已经经历过一次（0.45 → 0.55），影响可控。

## Alternatives Considered（详）

**orval**：v0.4 时短暂评估。它能直接生成 `useGetProject(id)` 这样的 react-query hook，DX 极顺。但：

- 把缓存策略（`staleTime`、`gcTime`、`select`）写在调用处更灵活，hook 全自动反而把决策推到 generator config，调试时多一层间接。
- 切换到 SWR / urql / 自研 cache 时需重 codegen + 改业务层。
- 平台 server state 已经覆盖较多自定义场景（offline queue、tmpId 替换、optimistic update with rollback），自动 hook 难以覆盖到。

**swagger-typescript-api**：产物体积大、JSDoc 充斥每个方法 + 每个参数，IDE 提示噪声严重。对 OpenAPI 3.1 的判别 union 支持迟迟未跟进。

**openapi-generator-cli**：JDK 启动 30-60s，每次 codegen 显著拖累 prebuild；TS 模板（typescript-axios、typescript-fetch）维护节奏慢。

**手写 wrapper**：试过 v0.1 ~ v0.3，DTO 在 50 之内还行，过百后类型同步成本爆炸；type 缺漏导致的运行期错误多次出现。

## Notes

- snapshot 文件位置：`apps/api/openapi.snapshot.json`；docs-site 的 prebuild 还会把它复制到 `docs-site/public/openapi.json` 给 Scalar 渲染（见 `docs-site/scripts/sync-openapi.mjs`）。
- generator config：`apps/web/openapi-ts.config.ts`（如有）；当前用默认配置 + `output: src/api/generated`。
- 后续考虑：把 codegen 产物加到 .gitignore 并依赖 prebuild —— 但当前 monorepo 跨包构建顺序让产物进 git 更稳，等 turbo / nx 接入再评估。
