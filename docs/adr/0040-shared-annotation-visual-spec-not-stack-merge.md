# 0040 — 标注视觉:统一参数规格,不合并图片/视频渲染栈

- **Status:** Accepted
- **Date:** 2026-06-16
- **Deciders:** core team
- **Supersedes:** —

## Context

图片工作台用 Konva/Canvas 画标注(`ImageStageShapes.tsx`:`<Rect>`/`<Line>`/`<Text>`,缩放靠 `/scale`),视频工作台用 SVG `<rect>`(归一化 `viewBox` + `vectorEffect="non-scaling-stroke"`)叠 DOM 文字层。两条栈对**同一类视觉属性各自硬编码**,导致默认值长期漂移:

| 属性 | 图片 | 视频 |
|---|---|---|
| 标签字号 | 共用常量 12,渲染 `/scale` | 同常量 12,但 DOM 固定 px |
| 标签显隐 | `image.showBoxLabels` 二态 | 恒显,无开关 |
| 线宽 | `(selected?2:1.5)/scale` | `selected?3:2`(non-scaling) |
| 闭合形状填充 | 类别色 `hexToRgba(color, 0.07/0.08)` | 纯白 `rgba(255,255,255,0.08/0.03)` |

痛点的根因不是「选错了渲染引擎」——第三方里 CVAT 全 SVG、Label Studio 全 Konva 都能自洽;问题是**本仓库两栈混用且各写各的默认值**。

一个直觉方案是「把视频也搬到 Konva,一套栈到底」。但视频栈与图片栈的诉求并不相同:视频框稀疏、要跟随 `<video>` 的 letterbox 自适应(SVG 归一化 viewBox + non-scaling-stroke 天然合身),文字层走 DOM 拿到字体/抗锯齿/i18n/暗色 token;图片栈重顶点编辑、像素掩膜、拖拽手柄,Konva 命中测试与节点缓存更合身。强行合并要解决帧合成、坐标系、海量测试迁移三块硬骨头(见 [[project_canvas_unification_epic]] / 画布栈统一 epic),成本高、收益仅是「少一套栈」。

## Decision

**统一参数与默认值,不统一渲染栈。**

- 新建共享视觉规格模块 `apps/web/src/pages/Workbench/stage/annotationVisual.ts`:默认值单一来源(`VISUAL_DEFAULTS`)+ 纯函数(`buildLabelText` / `fillAlpha` / `strokeWidthFor` / `shouldShowLabel`),不依赖 settings store / React。
- Konva 路径与 SVG/DOM 路径都消费同一规格;分歧只留在最后一步 draw call(图片对字号/线宽再 `/scale`,视频原样用 screen px)。逻辑、默认值、参数全部收口。
- 把这批视觉参数收敛到 `workbench.common.*`(图片 + 视频共享),用户级偏好,不进项目锁定(纯视觉、不改标注落点数据)。
- 顺手对齐两端历史分歧:视频线宽 2/3 → 1.5/2、填充纯白 → 类别色(与图片同语义)。这是**有意为之的破坏性观感统一**,在 CHANGELOG 显式说明。

## Consequences

正向:
- 默认值漂移被根除——改一处 `annotationVisual.ts`,图片与视频同步生效。
- 用户在「通用」组调一次,两端实时一致。
- 渲染栈各自保留最合身的实现,不引入大规模迁移风险。

负向:
- 仍维护两条渲染路径;新增视觉属性要在两个调用点各接一次最后一步。
- 视频默认观感发生变化(线宽变细、填充变类别色),老用户需适应。

## 搬迁触发条件(任一成立才重评「视频搬到 Konva」)

- 视频要做逐顶点编辑
- 视频要做像素级掩膜
- 单帧需渲染上百个形状(SVG 节点数成为瓶颈)

在此之前,视频继续 SVG + DOM,与图片 Konva 并存,共享 `annotationVisual.ts` 规格。
