# 0004 — 标注画布引擎：Konva（4 Layer 架构）

- **Status:** Accepted
- **Date:** 2026-05-06（回填；选型实际发生于 v0.2.x 阶段）
- **Deciders:** core team
- **Supersedes:** —

## Context

工作台画布的核心约束：

1. **多 Layer**：图像层 / 已有标注层 / 当前绘制 overlay / 评论批注 / 选中变换 controls 必须分开渲染，避免一帧重绘所有内容。
2. **大图 + 多框**：单图 4K + 1000+ box 是常见场景；缩放/平移/绘制必须维持 ≥ 60 FPS。
3. **像素级交互**：bbox 8 锚点 resize、polygon 顶点拖拽 / 边插入 / 顶点删除、Alt/Shift 修饰键、键盘 nudge 1px / Shift+10px——交互模型复杂。
4. **声明式 + React 集成**：业务逻辑（撤销/重做、批量编辑、AI accept/reject）走 React state；画布层应能用 React 组件描述。

候选：

| 选项 | 主要卖点 | 主要劣势 |
|---|---|---|
| **Konva + react-konva** | Layer 模型原生、声明式 wrapper、社区成熟（CVAT 同款） | 大量节点时 `Stage.batchDraw` 调度需要小心 |
| Fabric.js | 图形对象模型最丰富、内置变换 controls | React 集成需手写 wrapper、Layer 概念弱、事件系统重 |
| 原生 Canvas + 手写 dirty-rect | 性能上限最高、零依赖 | 自己实现 Layer / 命中测试 / 拖拽手势，工作量数月 |
| SVG + React | 完全声明式、CSS 友好 | 1000+ 节点 DOM 性能急剧下降；大图缩放失真 |
| PixiJS | WebGL 加速、性能强 | 学习曲线陡、文本渲染弱、声明式集成不成熟 |

## Decision

采用 **Konva 10.x + react-konva 18.x**，画布按 4 Layer（v0.6.4 起 5 Layer）切分：

```
ImageStage (Konva.Stage)
├─ Layer 1 · Image     — 底图（KonvaImage）+ blurhash 预览
├─ Layer 2 · Annotations — user / AI 标注（rect / polygon / keypoints）
├─ Layer 3 · Drawing   — 当前绘制中的 overlay（preview rect、polygon ghost、handle）
├─ Layer 4 · Selection — 选中态变换 controls（8 锚点 / 多边形顶点圆 / IoU 高亮）
└─ Layer 5 · Comments  — v0.6.4 评论画布批注（笔触、画笔/箭头/圈选）
```

约束：

1. **每 Layer 独立 batchDraw**：标注 hover/select 不引起 image layer 重绘。
2. **顶层只画 React-shape**：所有 Konva 节点必须由 react-konva 组件树渲染，禁止 imperative `new Konva.Rect()`，便于 useEffect / state 同步。
3. **数据归一化坐标**：所有标注 geometry 存 `[0,1]` 归一化值，Layer 渲染时乘 stage size 转像素。换图/换缩放无需改数据。
4. **工具是插件**：`apps/web/src/pages/Workbench/stage/tools/` 每个工具一个 `{ id, hotkey, icon, onPointerDown, ... }` 模块；新增工具不改 ImageStage 主文件。

## Consequences

正向：

- v0.5.x 性能基线：4K 图 + 500 框稳定 60 FPS（Chromium devtools profile）；2000 框降到 ~ 35 FPS 但仍流畅。Layer 切分是关键。
- React state 与 Konva 节点同步靠 react-konva 的 reconciler，业务层基本不用 escape hatch（`useRef<Konva.Layer>` 仅在 batchDraw 强制刷新时用）。
- 工具插件化让 SAM / marquee 等未来工具可独立开发，不污染主流程。
- v0.6.4 评论画布批注作为第 5 Layer 加入时，对其它工具零影响——证明分层架构的可扩展性。

负向：

- React 渲染与 Konva 重绘不完全对齐：某些场景下 `useState → 子树 rerender → Konva 节点重建` 会丢失 transformer 引用。这是 react-konva 的常见坑，已在 `KonvaBox` 组件里用 `key` + `useImperativeHandle` 兜底。
- Konva 没有内置碰撞检测优化（rbush 类）：> 1000 节点的命中测试走线性扫描；ROADMAP §C.1 已列「IoU rbush 加速」但触发条件未到。
- `package.json` 同时存在 `fabric` 和 `konva` 依赖：`fabric` 是早期评估留下的 dead dep，`apps/web/src/` 实际不再 import（仅 `App.tsx:20` 注释提及）；下次 dep 清理时移除。

## Alternatives Considered（详）

**Fabric.js**：v0.1 阶段试过两周。优势是 transformer / 多选 / 旋转开箱即用、对象事件丰富。劣势：

- React wrapper 不主流（fabric-react、react-fabricjs 维护差），自写 wrapper 等于重新发明 react-konva。
- Layer 概念弱：得自己用 group/zIndex 模拟，且事件冒泡顺序难调。
- 默认 SVG-style 渲染对大图缩放友好度低。

**原生 Canvas**：评估过完全自写。性能上限最高，但要自己写：dirty-rect 重绘、Layer 合成、命中测试、拖拽手势、键盘焦点、撤销栈与渲染解耦……估算 2-3 人月才能追上 Konva 基础能力。MVP 阶段不值得。

**PixiJS**：WebGL 加速吸引人，但：

- 对文本（类别 label / 置信度数字）渲染需要走 BitmapText 或 SDF，配色/字体定制成本高。
- React 集成（pixi-react）成熟度低。
- 标注画布性能瓶颈通常在「事件分发 + state 同步」而不是渲染绝对吞吐，PixiJS 无明显收益。

**SVG**：1000+ 节点 DOM 直接卡死，已在 v0.1 早期 PoC 验证过——抛弃。

## Notes

- 4 Layer 模型与 CVAT 不谋而合（CVAT 用 SVG 替代 Konva，但分层思路一致），证明这是该问题的「业内主流答案」。
- 调研报告 [`docs/research/03-cvat.md`](https://github.com/yyq19990828/cvat) 有详细对比。
- 后续可能扩展：
  - **VideoStage**（react-konva 同栈，加 Konva.FastLayer 跑视频帧）
  - **LidarStage**（Three.js 单独栈，与 Konva 不复用——见 ROADMAP §C.4 Layer 2）
  - 这两条扩展不动 ImageStage 既有代码，分维度切渲染器是 v0.4.9 Step 1 已确立的方向。
