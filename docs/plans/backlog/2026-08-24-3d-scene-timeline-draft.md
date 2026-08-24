# 3D Scene 时间轴计划草案

> Status: research-draft
>
> Implementation authorization: no
>
> Version: unassigned；本草案不占版本号
>
> Finalization: 实施前必须执行 [`backlog/README.md`](README.md) 的“转定稿门”

## 1. 推荐结论

推荐先做一个**只读、虚拟化、按区间取数的 scene 状态时间轴**。它负责解释当前帧、对象存在区间、关键帧、候选数量、跨帧任务进度和失败帧，并提供确定性的导航；第一版不允许在时间轴上拖拽改标注或自动修复轨迹。

这比扩展现有 `FramePicker` 更合适：`FramePicker` 是一次操作的目标帧弹层，scene 时间轴是持续存在的场景状态层，两者职责不同。

## 2. 当前基线快照

- ADR-0035 已把 `Scene + DatasetItem.frame_index` 定为跨 task 时序真值，点云 manifest 已返回 `scene_id / frame_index / scene_total_frames / ego_pose`。
- ADR-0045 已把 `Annotation.track_id` 定为跨帧对象身份。
- 前端已有 `useFrameNeighbors`、`useSceneTrajectory`、`FramePicker`、邻帧缩略图和跨帧传播 / 插值入口，但没有一个完整 scene 状态视图。
- 现有邻帧反查适合局部导航，不适合 1 万帧摘要；时间轴需要服务端区间聚合，不能为每帧逐个请求 annotation。

## 3. 信息架构与数据流

```text
Scene / DatasetItem(frame_index) ─┐
Annotation(track_id, source) ─────┼─► 区间摘要 API ─► query cache
Prediction / AsyncJob 状态 ───────┘                      │
                                                        ▼
对象轨道 + 帧密度 + 任务轨道 ─► 虚拟化时间轴 ─► Workbench 导航
                                                        │
                                                        └─► 选中对象 / 相机 / issue 上下文
```

时间轴分三层显示：

1. **scene 层**：当前帧、缺失帧、每帧对象数、待确认候选数和异常密度。
2. **对象层**：当前 `track_id` 的存在区间、manual / prediction / interpolated 来源、关键帧和断点。
3. **任务层**：传播、插值、AI 或跟踪任务的运行区间、进度、失败帧与可重试状态。

第一版默认只展开当前对象轨道，其余对象按密度聚合；避免把对象数量直接变成常驻 DOM 数量。

## 4. 只读交互合同

- 点击帧：使用现有 task 映射和工作台导航切到对应帧，服从任务可见性、保存保护与锁语义。
- 点击对象区间：跳到最近有该 `track_id` 的帧并选中对象；若目标标注已删除或不可见，显示稳定的失效提示，不猜测替代对象。
- 点击失败帧：跳转并打开对应任务详情；重试和取消动作属于跨帧任务中心，不由时间轴自行发明 API。
- 缩放和滚动只改变观察窗口，不改变当前帧；键盘左右导航继续使用现有工作台所有权。
- scene 不存在、frame_index 缺失或只有一帧时隐藏时间轴，保持单帧工作台不回归。

## 5. 范围

- 一个可折叠的底部时间轴容器，适配 3D 布局预设，不遮挡保存、提交与退出入口。
- 按可视区和预取窗口请求 scene 摘要，缓存 key 包含 scene、区间、筛选和摘要版本。
- 当前帧、对象存在区间、关键帧 / 来源、对象与候选数量、任务进度和失败帧。
- 从时间轴恢复到帧、对象、相机或任务上下文的导航协议。
- 1 万帧的虚拟化、请求取消、快速拖动和 stale response 测试。

## 6. 非范围

- 不在时间轴上拖动对象边界、关键帧或 annotation 几何。
- 不自动插值、传播、接受候选、修复断点或改变 task 状态。
- 不把整个 scene 的 annotation 明细一次性塞进响应。
- 不复用视频内部 `VideoFrameIndex` 代替跨 task 的 `Scene / frame_index`。
- 不在第一版提供任意轨道编排、颜色自定义或无限层级。

## 7. 摘要合同方向

转定稿时应基于现有 API 风格冻结区间摘要，但至少要满足：

- 请求显式携带 `scene_id`、闭区间或半开区间边界、可选 `track_id` 和摘要版本。
- 响应返回 frame 到 task 的可见映射、缺失 / 无权访问状态、聚合计数、对象片段和异步任务片段。
- 对象片段只使用 `track_id` 作为身份；没有 track_id 的孤立框只贡献帧计数，不伪造跨帧轨道。
- 任务状态必须有稳定 job id、operation、scope、status、progress、failed frames 和可否取消 / 重试。
- ETag 或 revision 能让客户端识别旧摘要；annotation 更新后只失效受影响区间，不强制重拉整个 scene。

本草案不固定端点名和字段拼写；转定稿必须用当前 OpenAPI 与 async job 合同生成精确 Schema，而不是把上面文字直接翻译成新 API。

## 8. 推荐实现切片（转定稿后执行）

1. **frame 密度轨道**：区间 API、当前帧和对象 / 候选计数，验证 1 万帧虚拟化。
2. **当前对象轨道**：存在区间、来源、关键帧和断点，接通 frame + object 导航。
3. **任务轨道**：消费已有或同期获批的异步任务状态，增加失败定位，不在本切片实现任务本身。
4. **布局与可访问性**：接入 3D 布局预设、键盘与屏幕阅读器语义，补正式文档。

## 9. 验收方向

- 1 万帧场景仅为可视窗口和有限 overscan 创建节点，常驻 DOM 数不随总帧数线性增长。
- 首次打开和连续拖动不会触发逐帧 annotation 请求；过期响应不能覆盖新窗口。
- 用户无需逐帧翻页即可找到指定 track 断点、待确认高密度帧和任务失败帧。
- 时间轴导航与工作台的未保存保护、权限、锁和当前选择一致；失败导航不改变当前上下文。
- 单帧、无 scene、缺 frame_index 和部分帧无权访问均有确定性降级。

## 10. 风险与回滚

- 最大风险是把摘要 API 做成另一套数据管理器。第一版只服务 3D scene 导航，不承诺通用查询语言。
- 对象轨道与任务进度若来自不同 revision，可能出现短暂不一致；UI 必须显示各自更新时间并允许局部刷新。
- 回滚可以隐藏时间轴并撤下新增只读端点；它不写 annotation，因此不需要数据回滚。

## 11. 转定稿专项检查

- 重新审计 scene、neighbors、trajectory、annotation range 和 async job 端点，确认是否已有可组合的区间查询。
- 核对 3D 精修布局是否已落地，时间轴尺寸不能破坏三套预设。
- 用生产形态数据测量 1 千 / 1 万帧的响应体、SQL 计划、前端 DOM 和交互延迟，再冻结分页与 overscan。
- 精确列出后端 Schema / service / router、前端 query / component / navigation、单元 / API / E2E 和正式文档文件。
