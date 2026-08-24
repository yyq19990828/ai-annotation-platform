# 研究草案与转定稿约定

`docs/plans/backlog/` 保存已经形成推荐方向、但尚未排期且不能直接授权实施的计划草案。它们用于保留调研结论、范围边界、依赖顺序和验收方向，不是当前仓库的实现说明，也不占用任何版本号。

## 状态语义

- `research-draft`：推荐方向已经明确，仍需按实施当日的仓库重新校准。
- `trigger-gated research-draft`：除重新校准外，还必须先满足草案写明的数据、性能或业务触发条件。
- 根目录中的 `draft / pending approval / approved` 才能进入版本评审；backlog 文件不能作为开工依据。

草案不得用 `TODO`、`TBD` 或空白占位隐藏决策。尚不能安全冻结的内容必须写成可验证的触发条件或转定稿检查项。

## 转定稿门

准备实施任一草案时，必须完成下面的顺序；任何一步发现基础假设已变化，都以当前代码、Schema、ADR 和正式文档为准，重写草案而不是迁就旧文字。

1. 确认当前 `CHANGELOG.md`、四处版本源、活跃 Epic 与已实施计划，重新决定是否分配版本；不得沿用草案日期推导版本。
2. 检查 `git status`，区分用户未提交变更与本计划范围，记录不能覆盖的工作树约束。
3. 用 `rg` 重新定位草案列出的代码锚点，核对 API、数据库模型、迁移 head、前端状态机、测试夹具和正式文档是否已经演进。
4. 对照草案的触发条件、范围和非范围，记录“仍成立 / 已由现状覆盖 / 需要拆分 / 不再成立”的结论。
5. 把候选变更面替换为精确文件清单、依赖图、迁移与兼容策略、按层测试命令、人工验收矩阵、文档与 `CHANGELOG.md` 同步项。
6. 明确每个可合并切片的验收门和回滚方法；超过 8 个文件时在定稿中显式确认大变更面，超过 3 个组件时保留 ASCII 数据流图。
7. 将文件移动到 `docs/plans/` 根目录，使用转定稿当天日期；若版本已经获批，文件名使用 `yyyy-mm-dd-vx.y.z-...md`，否则保持无版本名。状态改为待批准或已批准后，才能实施。

转定稿不是给原文补几条备注，而是一次基于真实仓库的重新决策。旧草案的研究来源和被否决方向可以保留，文件范围、契约与测试口径必须重新生成。

## 当前 3D 工作台草案集

### 可在精修计划后优先转定稿

[持续创建与持续自动拟合](../2026-08-24-v0.24.3-3d-continuous-creation.md) 已转为 v0.24.3 实施计划，不再属于 backlog。

[跨帧任务中心](../2026-08-25-v0.24.8-3d-cross-frame-job-center-mvp.md) 已拆出 registration 并转为实施计划，不再属于 backlog；registration 仍需单独通过准确率门。

| 草案                                                       | 独立结果                                 | 关键依赖                   |
| ---------------------------------------------------------- | ---------------------------------------- | -------------------------- |
| [3D 专属质量流程](2026-08-24-3d-quality-workflow-draft.md) | 规则发现问题但不自动改真值，一键恢复现场 | scene 时间轴、稳定几何口径 |

可信 LiDAR 导出已收缩为 [LiDAR 可信导出 MVP](../2026-08-25-v0.24.9-lidar-trusted-export-mvp.md) 并转入实施；完整 nuScenes 与多相机 COCO 派生 2D 不在当前版本范围。

### 由合同或基线触发后再转定稿

| 草案                                                                          | 触发后交付                           | 触发门                                    |
| ----------------------------------------------------------------------------- | ------------------------------------ | ----------------------------------------- |
| [点云空间流式加载](2026-08-24-pointcloud-spatial-streaming-draft.md)          | 视口 LOD、分块解码和稳定全局点 ID    | 三档固定数据集基准证明现链路不达标        |
| [持久化多模态对象](2026-08-24-persistent-multimodal-object-draft.md)          | 人工 2D 与 3D 成员共享身份和审计关系 | 真值冲突与标定版本 ADR 获批               |
| [3D AI 候选助手](2026-08-24-3d-ai-candidate-assistant-draft.md)               | 预览、调整、接受、拒绝的统一候选合同 | 本地算法验证后再开放远程模型协议          |
| [地面、测量与几何辅助层](2026-08-24-3d-scene-aids-draft.md)                   | 不污染标注真值的场景理解 overlay     | 参数、缓存和持久化边界冻结                |
| [Point Cloud Pen](2026-08-24-pointcloud-pen-draft.md)                         | 点选与笔刷共用一个点掩码工具         | 点索引稳定；若启用 tiling 则先完成全局 ID |
| [3D Ground Truth 与 Consensus](2026-08-24-3d-ground-truth-consensus-draft.md) | 可解释的对拍、即时反馈与多人一致性   | 3D 指标合同和质量定位流程稳定             |

## 共同研究依据

- [`v0.24.4 · 3D Scene 时间轴 MVP`](../2026-08-24-v0.24.4-3d-scene-timeline.md) 已转为实施计划，不再属于 backlog。

- [`docs/research/22-supervisely-cvat-workbench.md`](../../research/22-supervisely-cvat-workbench.md)：Supervisely / CVAT 工作台、教程、图片、GIF、视频与固定源码快照的深度调研。
- [`docs/research/14-point-cloud-image-fusion.md`](../../research/14-point-cloud-image-fusion.md)：点云与图像联合标注、真值边界与平台差距。
- [`docs/plans/2026-08-14-v0.24.x-3d-workbench-optimization-epic.md`](../2026-08-14-v0.24.x-3d-workbench-optimization-epic.md)：已实施历史、延期方向和版本边界。

具身 Episode Profile、2D 类别行工具、Center Out、Slice、通用 Layers / Filters 和视频双层时间轴不属于这组 3D 工作台草案；它们需要各自的产品域计划，不能借本目录顺带实施。
