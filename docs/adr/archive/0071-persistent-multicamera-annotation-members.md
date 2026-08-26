# 0071 — 多相机人工标注作为 SceneTrack 的持久成员

- Status: Accepted
- Date: 2026-08-26
- Deciders: AI Annotation Platform maintainers
- Supersedes: ADR-0030 中“标定无版本历史”的部分，扩展 ADR-0033

## Context

当前 LiDAR 工作台会在每帧的相机图上实时投影 3D 框，但这些投影不是人工真值，也不能独立修正或保存。训练与质量流程因此无法表示“3D 框正确，但某相机的 2D 框需要人工修正”。

同时，相机标定只保存在 `DatasetItem.metadata.calibration` 的当前值中。当标定变更时，系统无法判断某个人工 2D 成员是在哪一版标定下创建，投影残差也无法追溯。

要支持更完整的 3D 多模态标注，必须同时决定对象身份、人工/派生真值语义、标定历史、并发写入、质量检查和导出优先级。

## Decision

1. `SceneTrack` 继续是跨帧对象身份与生命周期的权威模型。一个对象在某帧可以有一个 3D 主成员和多个按相机 role 区分的 2D 人工成员。
2. 2D 相机成员使用现有 `annotations` 版本化写模型，而不是新建另一张真值表。它以 `sensor_dataset_item_id + sensor_role` 明确绑定当帧传感器，并复用所属 3D 对象的 `scene_track_id + track_id + class_name + tool_unit_id`。
3. 3D 框与每个相机 2D 框都可以是人工真值。3D→2D 实时投影是可重建的派生参考，不持久化，也不自动覆盖人工 2D 成员。
4. 数据库以部分唯一索引保证同一 task、SceneTrack 和相机 role 最多一个活跃成员。应用层同时校验几何类型、任务-数据项 link、类别和身份一致性。
5. 相机标定增加 append-only revision 表和内容 digest。`DatasetItem.metadata.calibration` 保留为兼容读模型，每个人工成员冻结创建/修改时的 revision 和 digest。
6. 标定变更不修改人工 bbox。成员冻结 digest 与当前 digest 不一致时，关系显式为 `stale`，由人工重新确认。
7. 导出以人工真值优先：所选相机存在人工成员时使用它的 2D bbox，否则回退到受信的当前标定投影。导出报告分开计数两种来源。
8. 投影几何只保留一个服务内核，由 KITTI 导出、投影残差 Quality 规则和 API 诊断共用。

## Consequences

### Positive

- 对象身份、时序生命周期、版本冲突和审计继续复用现有成熟边界，不产生双重真值源。
- 人工 2D 与派生投影的语义可视、可追溯，质量评估和导出可复现。
- bbox 之后增加 polygon / mask 成员时，不需要重写对象成员和标定关系。

### Negative

- `annotations` 不再能被简化理解为“每帧每轨迹只有一行”；SceneTrack 命令必须区分 3D 主成员和按相机划分的模态成员。
- 标定同时存在 append-only 历史和 metadata 当前读模型，所有标定更新必须经过单一服务，避免两者漂移。
- 只有旧 metadata 的存量项目第一次更新时会多写一条基线 revision。

## Alternatives Considered

### 独立 camera annotation member 表

拒绝。它会复制 annotation 的版本、软删除、锁定、审计、类别和权限逻辑，也会让导出和 Quality 同时对账两个真值系统。

### 只保存 3D 框和手工投影 offset

拒绝。offset 依赖某个标定和派生 bbox，标定或 3D 几何改变后难以解释，也无法表示一个独立的人工 2D 真值。

### 标定只保留当前 metadata

拒绝。无法对人工成员、Quality issue 和导出产物进行可复现的关系审计。

## Notes

- 该决策保留 ADR-0033 的“派生投影不预存”约定，新增的是并行的人工真值成员。
- 标定历史不改变现有导入文件格式；导入后的服务会在需要时物化基线 revision。
