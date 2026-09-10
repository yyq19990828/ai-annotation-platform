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

## 共用 Markdown 编辑与阅读

`components/markdown/MarkdownEditor` 提供可视化编辑、源码和预览；`MarkdownView` 负责只读排版。页面继续持有草稿、提交校验、保存请求和附件策略。标注指引、项目模板指引、BUG 描述和 BUG 评论复用这组组件，持久化格式仍是 Markdown 字符串。

编辑器基于 MDXEditor，只在需要编辑时动态加载。只读视图使用 `react-markdown` 与 `remark-gfm`，不能从编辑器模块导入运行时代码。`GuideMarkdownView` 和 `MarkdownBlock` 保留为兼容适配层，共用渲染和样式。

| 接口                             | 归属与用途                                                       |
| -------------------------------- | ---------------------------------------------------------------- |
| `value` / `onChange`             | 页面拥有草稿；初始化或仅切换模式不把编辑器规范化输出当成人工修改 |
| `documentId`                     | 切换文档时重建编辑上下文，隔离未完成上传与旧回调                 |
| `label` / `variant` / `disabled` | 可访问名称、正文或紧凑工具栏、当前可编辑状态                     |
| `onBlur`                         | 离开整个编辑区域时通知页面；工具栏和编辑器弹层属于同一操作范围   |
| `onUploadImage`                  | 业务上传图片，返回要保存的稳定 `src` 和可选替代文字              |
| `resolveImage` / `imageScope`    | 将内部图片标识解析为临时显示地址，并按文档隔离解析状态           |

`types.ts` 中的 `MarkdownImageResolver` 接收完整图片 `src` 和可选的强制刷新选项，返回 `url` 及可选的 `expiresAt`（Unix 毫秒时间戳）。项目图片通过 `useGuideAssets` 解析 `guide-asset:KEY`；签名 URL 仅用于显示，不写回 Markdown。缓存与进行中的签名请求按项目隔离，过期或加载失败后可以重新获取地址。

编辑器和阅读器支持同一组 Markdown/GFM 文本结构。阅读器保留默认 URL 过滤，仅在提供项目图片解析器时允许图片节点使用内部资源协议。可视化编辑不启用原始 HTML、JSX 执行和图片尺寸 HTML 输出。不能解析的原文保留在源码模式中供恢复。

BUG 截图仍由反馈表单的附件队列拥有，文件粘贴不能同时被编辑器和表单消费。其描述限长须校验追加诊断后的完整载荷。工作台评论的字符偏移提及、画布批注和定位锚点仍由原组件处理，不能直接替换成普通 Markdown 输入。

回归检查应同时覆盖真实编辑器和表单保存。重点包括旧原文不被空操作改写、撤销回到初值、失败保稿、异步结果不跨文档、内部图片解析、反馈附件粘贴和中文输入。浏览器流程位于 `apps/web/e2e/tests/markdown-authoring.spec.ts`；运行时使用独立测试数据库和对象存储桶。

## OpenAPI 自动生成

```
后端改 schema → uv run python scripts/export_openapi.py
            → apps/api/openapi.snapshot.json 更新
            → pnpm codegen → src/api/generated/types.gen.ts 更新
            → 手写 wrapper 引用新类型
```

snapshot 是契约的真值源头；CI 会校验它与运行时一致。
