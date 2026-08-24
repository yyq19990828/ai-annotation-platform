# 3D Ground Truth 与 Consensus 计划草案

> Status: trigger-gated research-draft
>
> Implementation authorization: no
>
> Version: unassigned；本草案不占版本号
>
> Finalization: 实施前必须执行 [`backlog/README.md`](README.md) 的“转定稿门”

## 1. 推荐结论

推荐按**指标合同 → 只读对拍 → 即时反馈 → 多人 Consensus → 显式合并**的顺序建设。Ground Truth 和每个标注副本都必须是隔离、可版本化的 annotation set；Consensus 只能产出比较结果和合并提案，不能像覆盖导入一样直接改父任务真值。

现有 `Annotation.ground_truth` 布尔字段不足以表达参考集 revision、覆盖帧、可见对象、评审人和更新历史。转定稿必须先用 ADR 决定 annotation set / task revision 的权威模型，不能把该布尔值扩写成完整 QA 系统。

## 2. 触发门

只有以下条件同时成立才允许转定稿：

- [3D 专属质量流程](2026-08-24-3d-quality-workflow-draft.md)已稳定，cuboid、点掩码、track 与投影相关指标都有固定夹具和可解释定位。
- 至少一个真实项目需要隐藏 GT / 即时反馈，或至少三个标注副本的 Consensus，而不是只需要普通 review。
- 项目方已确认 replica 成本、盲标规则、GT 更新权限和争议仲裁人。
- 当前任务 / annotation revision 模型可以创建隔离快照；若不能，ADR 已批准新增最小持久化模型。

## 3. 指标合同

### 3.1 Cuboid

- 先按 scene / frame / class 限定候选，再用 3D IoU、中心距离、尺寸相对误差和 yaw 周期误差形成匹配成本。
- 一对一匹配采用确定性最优分配；匹配阈值按类别 / 项目版本化。
- 结果至少区分 false positive、false negative、class mismatch、geometry mismatch，不能只给单一总分。

### 3.2 Point mask

- 使用稳定全局点 ID 计算交并；点云抽样或 tile 不完整时禁止宣称完整 IoU。
- 同时报告 IoU、漏点、冗余点和互斥类冲突，定位可高亮差集。

### 3.3 Track

- 使用 `track_id` 比较存在区间、ID switch、fragmentation、缺帧和每帧几何误差。
- 单帧匹配正确不代表 track 正确；track 分数与 frame 几何分数分开呈现。

### 3.4 多模态

- 只有持久化人工 2D 成员存在时才计算 2D / 3D 投影残差。
- 标定 revision 不同的集合先归一到明确版本，不能把标定漂移归罪于标注员。

## 4. 数据与操作边界

```text
GT Annotation Set (immutable revision) ─┐
Replica A / B / C (isolated revisions) ─┼─► Comparison Run
Metric + threshold revisions ────────────┘         │
                                                   ├─► pairwise matrix
                                                   ├─► per-object conflicts
                                                   └─► merge proposal
                                                            │ explicit review
                                                            ▼
                                                 New accepted annotation revision
```

- GT revision 一旦用于 run 就不可原地改；修订 GT 产生新 revision，历史报告仍能复现。
- replica 之间不可互见，直到项目配置允许或任务完成；权限必须由服务端约束。
- merge proposal 保存每个对象的来源、投票、指标和人工决定；接受后写入一个新 annotation revision。
- 合并前后都可导出和审计；不提供“撤销数据库覆盖”，而是通过 revision 回退。

## 5. 范围

- 3D annotation set revision、GT 指定、replica 隔离和 comparison run 的最小模型。
- cuboid 第一版指标、逐冲突定位和项目级阈值；点 mask / track 按触发门分切片加入。
- GT 即时反馈的 attempt 限额、可见提示和防泄漏权限。
- Consensus 成对矩阵、对象级冲突、显式合并提案与审计。
- 数据集级离线评估导出，不把 UI 总分作为唯一证据。

## 6. 非范围

- 不自动覆盖父任务 annotation，不提供不可逆“一键合并”。
- 不用多数票代替几何匹配，也不把不同类别 / 不同标定版本直接投票。
- 不在第一版支持所有 3D geometry；按 cuboid → point mask → track 顺序扩展。
- 不把普通 reviewer issue、生产抽检或模型评估全部重命名为 Consensus。
- 不承诺跨项目共享 GT；ontology 和传感器合同不同的集合不可直接比较。

## 7. 推荐实现切片（转定稿后执行）

1. **ADR 与离线指标**：冻结 annotation set revision 和 cuboid 匹配，在固定夹具上生成可解释报告，不开 UI 写入口。
2. **GT 对拍**：单个 replica 对一个不可变 GT，提供冲突定位；再加入有限即时反馈。
3. **多人比较**：N 个隔离 replica 的 pairwise / aggregate 视图，不提供合并。
4. **显式合并**：对象级提案、人工决定、新 revision 和回退；通过审计演练后才开放生产。
5. **点 mask 与 track**：分别在全局点 ID 和 track 指标通过后独立加入。

## 8. 验收方向

- 同一组 annotation set revision、metric revision 和 threshold revision 重跑得到逐对象一致结果。
- GT 更新不会改变历史 run；新 run 明确指向新 GT revision。
- replica 权限测试证明标注员无法从 API、WebSocket、导出或计数侧信道读取隐藏 GT / 他人副本。
- 合并前展示每个对象的来源与冲突，接受后生成新 revision；父集合和 replica 保持可恢复。
- yaw 周期、遮挡、无匹配、重复框、稀疏点 mask、track ID switch 均有确定性 fixture。
- 取消或失败的 comparison run 不产生半合并结果。

## 9. 风险与回滚

- GT 泄漏会让质量数据失真，权限验证优先级高于 UI 完整度。
- 一个总分会掩盖 false negative 与严重几何错误；必须保留按规则、类别和对象钻取。
- 合并语义是最高风险操作。回滚首选关闭 merge capability，保留只读比较；已接受结果通过 revision 切回，不删除审计。

## 10. 转定稿专项检查

- 重新审计 `Annotation.ground_truth`、task revision、assignment / review、数据管理器与权限模型，写 ADR 比较至少两种隔离方案。
- 核对 3D Quality 的最新 metric / locator，Consensus 不得另写一套略有不同的 IoU 和 yaw 口径。
- 用真实项目估算 replica 存储、run 复杂度和最大对象数，冻结分页、worker budget 与保留策略。
- 定稿必须列出迁移、回填、权限矩阵、API、worker、UI、导出、测试和正式文档的精确文件清单。
