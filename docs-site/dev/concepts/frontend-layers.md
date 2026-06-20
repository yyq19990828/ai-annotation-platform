---
audience: [dev]
type: explanation
since: v0.1.0
status: stable
last_reviewed: 2026-05-11
---

# 前端分层

## 路径别名

`@/*` → `apps/web/src/*`

## 分层

```
pages → components/ui + stores + api → generated types
```

## 页面（pages）

- 一个路由一个目录
- 复杂页面可拆 `state/` `stage/` `stages/` `modes/` `shell/`：
  - `state/` — Zustand store + reducer-like actions
  - `stage/` — 底层画布 / 播放器组件（标注工作台特有）
  - `stages/` — image / video / 3D 的 Stage adapter 与 stage-specific action hooks
  - `modes/` — annotate / review 的页面策略 hook
  - `shell/` — 该页特有的布局、面板、overlay 与 Host 组件

Workbench 的细分边界见 [工作台 Shell 架构](./workbench-shell)。

## API 层（src/api）

- `generated/` — `openapi-ts` 输出，**不手动改**
- `users.ts` / `projects.ts` 等 — 手写包装：组合 axios/fetch、统一 baseURL、注入 token、错误归一化
- 导出函数命名：`getXxx` / `createXxx` / `updateXxx` / `deleteXxx`

## 状态管理

- 全局：Zustand store
- 服务端状态：TanStack Query（带缓存与失效）
- 不要把服务端数据塞进 Zustand store —— 那是 React Query 的活

## 组件分层

- `components/ui/` — 应用兼容适配层（Button / Card / Badge ...）只允许接收 props，不调 API
- `components/shadcn/ui/` — shadcn/ui 原语和底层交互组件
- `components/shell/` — 应用框架（TopBar / Sidebar）
- 页面内的局部组件 — 放在 `pages/<Page>/components/`

## 样式

- 主题变量定义在 `src/styles/shadcn.css`，当前 CSS 只读 `--sc-*`
- 页面和组件优先使用 Tailwind 语义类与 shadcn/ui
- 残留 CSS Module 只保留局部布局或画布叠加层样式，不再读取旧颜色变量

## OpenAPI 自动生成

```
后端改 schema → uv run python scripts/export_openapi.py
            → apps/api/openapi.snapshot.json 更新
            → pnpm codegen → src/api/generated/types.gen.ts 更新
            → 手写 wrapper 引用新类型
```

snapshot 是契约的真值源头；CI 会校验它与运行时一致。
