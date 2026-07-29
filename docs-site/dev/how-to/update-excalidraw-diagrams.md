---
title: 更新 Excalidraw 图表
description: 在文档站新增、引用和继续编辑自包含的 Excalidraw SVG
audience: [developer]
type: how-to
status: stable
last_reviewed: 2026-07-29
---

# 更新 Excalidraw 图表

文档站使用自包含的 Excalidraw SVG 呈现稳定的架构、数据流和业务流程。单个 SVG 同时是展示文件和可编辑源，不再额外维护容易漂移的 `.excalidraw` 副本。

## 何时使用

| 场景                         | 推荐形式       | 原因                             |
| ---------------------------- | -------------- | -------------------------------- |
| 系统架构、模块边界、数据航线 | Excalidraw SVG | 布局和视觉层级重要，变化频率较低 |
| 需要手绘风格的讲解图         | Excalidraw SVG | 可精确编排，并保留可编辑 scene   |
| 频繁随协议更改的时序或状态图 | Mermaid        | 文本 diff 更容易审查和同步       |
| 临时草图或很小的线性流程     | Mermaid        | 维护成本更低                     |

迁移采用按需方式：只有当现有 Mermaid 图的可读性或布局受限时，才转换为 Excalidraw。

## 单文件合同

图表放在 `docs-site/public/diagrams/<文档域>/<页面>/<图名>.svg`，路径段只使用小写字母、数字和连字号。例如：

```text
docs-site/public/diagrams/dev/concepts/system-overview.svg
```

每个 SVG 必须满足：

- 导出自 Excalidraw，包含 `svg-source:excalidraw` 标记。
- 开启 scene 内嵌，SVG 可直接重新导入 Excalidraw 继续编辑。
- 文字使用 Virgil 手写字体，并将字体作为 data URI 内嵌。
- 具有有效 `viewBox`，不包含 script 或外部资源。
- 使用白色纸张背景；文档站深色模式只改变外围边框，不对图表做反色。

## 新增图表

### 1. 绘制和导出

在 Excalidraw 中完成绘制后，导出 SVG 时启用以下选项：

1. 将 scene 嵌入导出文件。
2. 将字体嵌入 SVG。
3. 包含背景，并保留适度画布留白。

将导出文件直接保存到 `docs-site/public/diagrams/` 下对应的文档域。
跨多个页面复用的 canonical 图放在 `docs-site/public/diagrams/shared/`，所有页面引用同一个 SVG，不要为不同受众复制资产。

### 2. 在 Markdown 中引用

统一使用全局组件，不要使用 Markdown 图片语法或原始 `<img>`：

```md
<ExcalidrawDiagram
  src="/diagrams/dev/concepts/system-overview.svg"
  alt="系统请求、后台任务与模型服务的关系"
  caption="系统全景"
/>
```

`alt` 描述图中的关键关系，不要只重复标题。`caption` 可选。读者可点击图表打开全屏预览，也可下载同一个 SVG 继续编辑。

### 3. 校验

```bash
pnpm --filter @anno/docs-site check:diagrams
DOCS_BASE=/ai-annotation-platform/ pnpm --filter @anno/docs-site build
```

图表校验会拒绝：

- 文档引用了不存在的图。
- `public/diagrams/` 内存在没有正文引用的孤儿图。
- SVG 没有内嵌 Excalidraw scene 或 Virgil 字体。
- 图表使用 Markdown 图片语法绕过统一组件。
- SVG 包含 script、外部资源或非标准路径。

## 更新现有图表

1. 从文档图注下方下载可编辑 SVG，或直接从 `public/diagrams/` 打开原文件。
2. 将 SVG 导入 Excalidraw 后修改。
3. 使用相同选项重新导出，覆盖原 SVG。
4. 运行图表校验和文档站构建，再检查浅色、深色和窄屏显示。

不要另存一份 `.excalidraw` 作为同级源文件；图表的唯一真值是内嵌 scene 的 SVG。
