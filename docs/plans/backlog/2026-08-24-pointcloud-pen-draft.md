# Point Cloud Pen 混合点掩码工具计划草案

> Status: trigger-gated research-draft
>
> Implementation authorization: no
>
> Version: unassigned；本草案不占版本号
>
> Finalization: 实施前必须执行 [`backlog/README.md`](README.md) 的“转定稿门”

## 1. 推荐结论

推荐在现有 `point_mask_3d` 真值和矩形 / polygon 选择基础上，增加一个**点击构造 polygon、拖动执行屏幕空间笔刷**的统一工具。手势通过明确移动阈值消歧；每一笔只在 pointerup 形成一次点索引差集、一次 annotation mutation 和一次 history entry。

默认笔刷只编辑前表面深度带，避免透过整片点云误选；“穿透选择”若确有需求，应是显式模式而不是隐藏 modifier。

## 2. 当前基线快照

- `ThreeDWorkbench.tsx` 已支持 `point_mask_3d` 创建 / 编辑、矩形选点、polygon 选点、加 / 减点和选择完成。
- `PointCloudScene` 已能把屏幕矩形 / polygon 投影到 points，并返回 point indices、`decimate_stride` 与 `source_point_count`。
- 当前工具在一次选择后会退出到 select；polygon 顶点、结束和双击行为与未来对象聚焦存在手势冲突，需要按工具状态决定所有权。
- 当前点索引建立在单 PCD + stride 上。空间 tiling 若先落地，本计划必须改用稳定全局 point ID。

## 3. 手势状态机

```text
ARMED
  │ pointerdown
  ▼
PENDING_GESTURE
  ├─ move < threshold + pointerup ─► ADD_POLYGON_VERTEX
  ├─ move ≥ threshold              ─► BRUSH_STROKE ─► pointerup commit
  ├─ Enter / explicit finish       ─► POLYGON_SELECT commit
  └─ Esc                           ─► cancel current gesture / exit tool
```

交互合同：

- 移动阈值以 CSS pixel 和 pointer type 校准；触控笔、鼠标、触控板分别测试，不能依赖单一硬编码体验。
- 点击只增加 polygon 顶点，不同时落一笔 brush；拖动越过阈值后当前手势不可再回退成点击。
- 加点 / 减点沿用届时工作台的统一 modifier 和可见提示，转定稿不得另造一套快捷键。
- polygon 双击 / Enter 结束时，由 point pen 独占事件；非 point pen 状态下才允许对象双击聚焦。
- brush 半径用屏幕像素表达并显示圆形光标；缩放相机不改变屏幕可控性，但世界覆盖范围随深度自然变化。

## 4. 深度与点身份

- pointerdown 首先命中最近可见点，建立中心深度；stroke 只选择投影落入 brush 且处于可配置深度带的点。
- 无前景命中时不跨深度扫全场，显示“未命中点”并保持当前 mask。
- 每次 move 只更新本地 preview set；pointerup 计算相对原 mask 的 add / remove ID diff，一次提交。
- 同一 stroke 内重复经过一个点只记录一次；减点也使用集合差，不产生负索引或重复索引。
- legacy PCD 使用源顺序全局 ID；tile 路径使用 manifest global point ID。两者不能在同一 annotation 中混用而不带 generation。

## 5. 范围

- point pen 状态、光标、阈值、polygon 顶点与 brush stroke 的事件所有权。
- add / subtract、前表面深度带、本地 preview、pointer capture / cancel。
- 一笔一次 mutation / history、失败恢复和大 mask 索引 diff 性能。
- mouse / pen / touch 的最小可访问性与快捷键说明。
- legacy point ID；若 tiling 已落地，则接入 global ID / generation 和完整 ROI 门。

## 6. 非范围

- 不改变 `point_mask_3d` 的语义，不新增 rasterized 3D mask 真值。
- 不在第一版做软笔刷、压力、羽化、3D 球形笔刷、智能边缘吸附或模型分割。
- 不把每个 pointermove 发送到 API，不为每个采样点创建 history。
- 不默认穿透点云，不在未加载完整 ROI 时提交部分结果。
- 不与持续 cuboid 创建共用一个隐式 armed 状态；两者只复用通用状态视觉规则。

## 7. 触发门

- 至少用固定点级分割任务证明矩形 / polygon 的模式切换是主要耗时或误差来源。
- 现有 point index 合同在目标数据上稳定；若空间 streaming 已实施，global point ID 与 generation 迁移已通过。
- 选中 10 万级点索引的一笔 diff、preview 和 history 在目标浏览器内满足转定稿预算。
- 双击聚焦、相机操作、TransformControls 和 point pen 的 pointer ownership 已能写成无歧义矩阵。

## 8. 推荐实现切片（转定稿后执行）

1. **纯手势 reducer**：用事件序列 fixture 固定 click / drag / cancel / finish，不接真实点云。
2. **brush preview**：前表面选择、半径、add / subtract 和 pointer capture，只更新本地 set。
3. **单次提交与 history**：pointerup diff、version conflict、撤销 / 重做和大 mask 性能。
4. **polygon 合并与设备矩阵**：把已有 polygon 接入同一工具，验证鼠标 / pen / touch 与对象聚焦冲突。
5. **tile 兼容**：仅在 streaming 已落地时增加 global ID、generation 和 ROI 完整性。

## 9. 验收方向

- 小于阈值的 100 次点击全部只增加 polygon 顶点；越过阈值的 100 次拖动全部只产生 brush stroke。
- 一笔 200 次 pointermove 最终只有一次 annotation PATCH 和一次 history entry；cancel 为零 PATCH。
- 相同事件序列在固定点云、相机和参数下得到相同 ID diff，刷新后 mask 一致。
- 默认模式不选择深度带外点；无命中、相机移动中、pointerleave、lost capture 和切 task 都安全取消。
- 撤销 / 重做精确恢复 stroke 前后 ID 集合，不影响其他 annotation。
- 与 polygon、双击聚焦、OrbitControls 和只读 / 锁定状态的事件矩阵全部通过。

## 10. 风险与回滚

- 2D 屏幕 brush 对稀疏 3D 点的深度含义不直观，必须显示命中深度带和 preview，不允许“涂完才发现选穿了”。
- 大索引集合复制会造成 GC 峰值；转定稿应基于当前 mask representation 选择差集结构，不先引入复杂压缩。
- 回滚可隐藏 point pen，保留原矩形 / polygon 工具。它不改变 geometry schema，已保存 point mask 可继续编辑和导出。

## 11. 转定稿专项检查

- 重新审计 `ThreeDWorkbench.tsx`、`PointCloudScene` 选择 API、point-mask mutation / history、对象双击聚焦和所有 pointer handler。
- 用真实设备测量 click jitter，冻结每种 pointer type 的阈值、采样频率和 brush 半径范围。
- 明确前表面深度带算法与无命中语义，并建立前后层、稀疏点、重叠对象和相机缩放 fixture。
- 若 tiling 尚未落地，定稿不得提前加入 tile abstraction；若已落地，则 global ID / generation 是硬依赖和发布门。
