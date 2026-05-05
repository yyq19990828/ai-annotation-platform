# 前端分层

## 路径别名

`@/*` → `apps/web/src/*`

## 分层

```
pages → components/ui + stores + api → generated types
```

## 页面（pages）

- 一个路由一个目录
- 复杂页面可拆 `state/` `stage/` `shell/`：
  - `state/` — Zustand store + reducer-like actions
  - `stage/` — Konva 画布层（标注工作台特有）
  - `shell/` — 该页特有的容器组件

## API 层（src/api）

- `generated/` — `openapi-ts` 输出，**不手动改**
- `users.ts` / `projects.ts` 等 — 手写包装：组合 axios/fetch、统一 baseURL、注入 token、错误归一化
- 导出函数命名：`getXxx` / `createXxx` / `updateXxx` / `deleteXxx`

## 状态管理

- 全局：Zustand store
- 服务端状态：TanStack Query（带缓存与失效）
- 不要把服务端数据塞进 Zustand store —— 那是 React Query 的活

## 组件分层

- `components/ui/` — 设计系统（Button / Card / Badge ...）只允许接收 props，不调 API
- `components/shell/` — 应用框架（TopBar / Sidebar）
- 页面内的局部组件 — 放在 `pages/<Page>/components/`

## 样式

- CSS 变量定义在 `src/styles/tokens.css`
- 组件级 CSS Module（`Button.module.css`）
- 不引入 Tailwind / styled-components

## OpenAPI 自动生成

```
后端改 schema → uv run python scripts/export_openapi.py
            → apps/api/openapi.snapshot.json 更新
            → pnpm codegen → src/api/generated/types.gen.ts 更新
            → 手写 wrapper 引用新类型
```

snapshot 是契约的真值源头；CI 会校验它与运行时一致。
