# 0070 — 点云四视图采用单 context 与事件驱动渲染

- **Status:** Accepted
- **Date:** 2026-08-25
- **Deciders:** core team
- **Supersedes:** ADR-0068 中“主视图与三视图各有 renderer owner”的部分；实验资格与 fallback 决策继续有效

## Context

点云工作台包含一个可自由 orbit 的透视主视图和 Top / Side / Front 三个框体正交精修视图。历史实现让
`PointCloudScene` 与 `TriViewRenderer` 各自创建 renderer 和 canvas。两边引用同一个 CPU
`BufferGeometry`，但 WebGL / WebGPU context 不能共享已上传 GPU 资源，因此点 buffer、shader、相机纹理
和 device-lost 生命周期仍然重复。

主视图还使用永久 RAF，即使 OrbitControls 阻尼已经稳定、点云和标注状态没有变化，仍然逐帧提交 Scene。
三视图虽然已经改为 dirty render，却独立维护 viewport 原点、DPR、裁剪、backend 状态和回退。近期三视图
错位、缩放后点框分离、框体调整后内容丢失和主/三 backend 文案分叉都发生在这条重复边界上。

三视图浮窗受点云 viewport bounds 约束，始终落在主 renderer canvas 覆盖区域内。Three.js 的 renderer
同时支持多 viewport / scissor，因此不需要第二 canvas 或离屏合成。

## Decision

1. 每个 `PointCloudScene` 只创建一个 `PointCloudRenderer`、canvas 和图形 context。该 owner 继续负责
   Legacy / 实验 WebGPU 选择、真实 backend 状态、初始化失败和 device lost 后回退。
2. 主透视视图与三个正交视图由同一个 scheduler 合帧。主 Scene 先绘制完整 canvas；可见三视图随后在
   浮窗内容 rect 中清色/深度并通过三个 scissor viewport 绘制。
3. 三视图 render pass 拥有正交相机、裁剪材质和正交点对象，但不拥有 renderer、canvas 或 RAF。主、
   正交点对象引用同一个 `BufferGeometry`，允许使用不同材质来保持透视 attenuation 与正交像素点径。
4. 主视图改为事件驱动。任何可见状态 mutation 调用 invalidate；OrbitControls 只在交互或 damping 仍改变
   相机时继续请求下一帧，稳定后停止。三视图折叠或隐藏时不提交正交 pass。
5. 三视图 DOM 只保留编辑 overlay 与浮窗 chrome。row 的 client rect 由 React 测量后下发，renderer
   统一换算到 canvas viewport 坐标；WebGL 左下原点与 WebGPU 左上原点的差异只在一处处理。
6. 不使用 RenderTarget atlas。当前视图都在同一 canvas 覆盖区域内，直接 scissor 避免额外纹理分配、
   采样和合成 pass。若未来三视图离开主 canvas 或进入独立窗口，再另立 compositor 决策。
7. ADR-0068 的实验开关、Legacy 保留、真实 backend badge、跨设备推广门和回退语义保持不变；本决策不
   批准默认启用 WebGPU。

## Consequences

正向：

- 点云 attribute 在同一 context 中上传一次，主/三视图不再各持一个 renderer/device。
- renderer backend、device lost、dispose 和 GPU 资源 plateau 只有一个权威 owner。
- 静止工作台不再持续占用渲染线程；三视图脏帧会在同一次调度中先恢复主 Scene，再提交对应 scissor pass，避免延迟 clear 留下黑色主视图。
- viewport、DPR 和 scissor 坐标收口，减少四视图同步行为的重复实现。

负向：

- 四台不同相机在共同更新时仍需四次 render pass；本决策不提供通用多相机 single-draw。
- 浮窗内容背景必须允许主 canvas 透出，并在浮窗移动时重绘旧区域；DOM 层级和 canvas rect 成为明确合同。
- `PointCloudScene` 成为四视图 renderer owner，需要用独立 `PointCloudTriViewPass` 保持相机/裁剪代码边界，
  避免把 React 浮窗交互写进命令式 Scene。

## Alternatives Considered

**保留双 renderer，只给主视图停止 RAF**：能降低空闲提交，但不能消除资源复制、backend 分叉和两套
device-lost 生命周期，拒绝作为完整修复。

**RenderTarget atlas + DOM 合成**：可以支持不在主 canvas 上的视图，但当前浮窗已有同 canvas bounds，
atlas 会多出 offscreen texture 与一次合成，没有对应收益，拒绝。

**WebGPU multiview / 自定义 instanced camera shader**：Three.js 的公开 multiview 主要面向 WebXR；自定义
方案会把 WebGL2 fallback、裁剪、点径和拾取一起拉入专用渲染管线，且四视图像素负载仍然存在。当前性能
证据不支持这项复杂度，拒绝。

## Notes

- 实施与验收：`docs/plans/2026-08-25-v0.24.12-3d-four-view-render-coordinator.md`
- 被部分替代的实验决策：`docs/adr/0068-experimental-webgpu-pointcloud-renderer.md`
- Three.js 官方模式：单 canvas 配合 viewport / scissor 渲染多个视图；不同 WebGL context 无法共享资源。
