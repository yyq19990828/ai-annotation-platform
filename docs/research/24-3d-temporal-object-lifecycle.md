# 3D 时序对象与轨迹生命周期深度调研

> - 调研日期：2026-08-25
> - 关注范围：Scene 级对象身份、存在区间、关键帧、插值、遮挡与重现、轨迹修正、跨传感器成员、质量修复和审计
> - 前置报告：[`22-supervisely-cvat-workbench.md`](./22-supervisely-cvat-workbench.md)、[`23-supervisely-cvat-image-video-workbench.md`](./23-supervisely-cvat-image-video-workbench.md)
> - 对照基线：本仓库提交 `1cc180ef`，已交付 3D 轨迹拆分与合并
> - 结论用途：下一阶段领域模型与计划评审，不是竞品功能清单

现有两份工作台报告主要回答界面如何组织、用户怎样连续作业。本文继续检查八个商业或开放核心平台、五个开源项目和一个行业标准，重点看它们如何表达同一对象跨越多帧、多传感器和多个可见区间。公开材料无法证明的平台内部实现不作推测；只有 2D 视频证据的平台用于验证通用时序交互，不据此外推其 3D 数据模型。

---

## 0. 推荐把下一步改成轨迹领域基础

“在当前帧终结轨迹并清理尾段”只覆盖单一场景：对象从此不再出现。真实 3D 序列还会遇到暂时遮挡后重现、驶出后重新进入、静止后开始运动、人工关键帧与模型结果并存、不同相机可见性不一致，以及错误身份修正后的撤销。把终结直接实现成删除后续框，会让这些状态共用一个不可逆动作。

下一阶段推荐建立 `SceneTrack` 领域，保留现有 `Annotation.track_id` 作为成员查询键和兼容接口，同时增加三层结构：

| 层                | 职责                                             | 不承担的职责                     |
| ----------------- | ------------------------------------------------ | -------------------------------- |
| Scene Track       | Scene 内对象身份、类别、轨迹级属性、并发版本     | 不复制逐帧几何                   |
| Presence Interval | 一个或多个存在区间，表达缺席、恢复和终止         | 不用删除来表达不可见             |
| Track Operation   | 拆分、合并、标记缺席、恢复、终止和撤销的幂等日志 | 不替代审计日志和 Annotation 历史 |

逐帧 `Annotation` 继续保存几何、来源和版本。插值结果仍可物化，便于当前工作台、导出和数据管理查询，但“对象是否存在”由轨迹区间决定。用户编辑的锚点与系统生成帧还需要独立的时间角色，不能继续只靠 `source=manual/interpolated` 猜测。

因此，原候选“3D 轨迹终结与尾段清理”应改为“3D 时序对象与轨迹生命周期基础”。终结只是这套模型上的一个命令，不再单独定义数据语义。

---

## 1. 调研范围与证据

### 1.1 商业平台

| 平台          | 深读材料                                                      | 能核验的范围                                                         |
| ------------- | ------------------------------------------------------------- | -------------------------------------------------------------------- |
| Supervisely   | Point Cloud Episode 格式、3D Episodes、对象标签 SDK           | episode 级 object、逐帧 figure、多相机上下文、对象级时间范围标签     |
| Segments.ai   | 3D cuboid、序列技巧、批量模式、关键帧、标签格式、多传感器投影 | remove-keyframe、track ID、插值帧、对象级属性、批量逐对象修轨        |
| Scale         | Sensor Fusion Scene、LiDAR Task、Nucleus 3D 数据合同          | 稀疏对象 path、duration、stationary、父子关系、逐传感器投影确认      |
| Kognic        | Scene/Input、OpenLABEL 预标注、数据要求、导出                 | 对象 UUID、frame interval、世界坐标插值、轨迹级与传感器级属性边界    |
| BasicAI Cloud | LiDAR Fusion、对象检测与追踪                                  | selected/all 范围、正反向传播、插值条件、合并、拆分、批量审阅        |
| Dataloop      | LiDAR 数据准备与 Studio 文档                                  | 点云、相机和标定的 Scene 输入组织；公开材料不足以核验完整轨迹状态    |
| Encord        | 视频轨迹、插值、对象操作                                      | 人工锚点保护、派生置信度、按对象重插值、拆分与范围删除；仅作 2D 对照 |
| Labelbox      | 视频编辑器与关键帧时间轴                                      | 实例轨迹、关键帧和插值范围；公开材料不支撑 3D 生命周期判断           |

商业平台的网页可能随产品更新，本文在 2026-08-25 抓取当前公开版本。没有公开源码的行为只按文档陈述，不推断数据库结构。

### 1.2 开源项目与标准

| 来源                                                                                                    | 固定快照               | 用途                                                                                                               |
| ------------------------------------------------------------------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------ |
| [3D-BAT](https://github.com/walzimmer/3d-bat/tree/75ca64cbae8ccf84302a2b15f3f8cba7821a3eb8)             | `75ca64c`              | 多传感器、插值、自动跟踪、撤销和 Review 的完整工具面                                                               |
| [CVAT](https://github.com/cvat-ai/cvat/tree/cd392352e76fc314a4cb8c271ad18097224afb77)                   | `cd39235`              | 2D/3D Track、关键帧、outside 状态、插值与对象级编辑合同                                                            |
| [Scalabel](https://github.com/scalabel/scalabel/tree/071d073598e7c988134dc70a5c0c52761226bf42)          | `071d073`              | 跨消失与重现的链接身份、关键帧插值、实时协作                                                                       |
| [Xtreme1](https://github.com/xtreme1-io/xtreme1/tree/20cffa07769e83cff9128ea77e098b70ea97be47)          | `20cffa0`              | Scene、帧、传感器文件树和 `trackId` 工程实现；源码细节见[点云与图像联合标注报告](./14-point-cloud-image-fusion.md) |
| [CaliperGT](https://github.com/caliperai-ai/caliperai-gt/tree/465366c43765a0fae10840d0906c12f3ca3f7ab5) | `465366c`              | 新开源的 Scene、轨迹合并、关键帧插值和多级 QA 对照；项目较新，不作为成熟度基准                                     |
| [ASAM OpenLABEL 1.0.0](https://www.asam.net/standards/detail/openlabel/)                                | 官方标准与 JSON Schema | 对象、帧区间、流、坐标系、关系和几何的交换模型                                                                     |

CVAT、3D-BAT、Scalabel 和 Xtreme1 证明常用交互可以开源实现。OpenLABEL 用于校验领域概念是否能跨平台交换，不要求本项目照搬它的 JSON 结构。

### 1.3 证据等级

| 等级 | 证据                                  | 本文用途                                 |
| ---- | ------------------------------------- | ---------------------------------------- |
| A    | 标准 Schema、固定源码、当前本项目代码 | 数据结构、状态边界和现状判断             |
| B    | 官方 API、用户文档和公开格式          | 用户行为、导入导出与平台能力             |
| C    | 产品页和 README 功能声明              | 发现能力，只在有第二份材料时支撑架构判断 |
| D    | 从多份 A/B 证据归纳的设计建议         | 明确标注为推荐或推断                     |

---

## 2. 平台没有把轨迹等同于一串框

### 2.1 Segments.ai 用 remove-keyframe 表达缺席

Segments.ai 的关键帧时间轴同时显示普通关键帧、remove-keyframe 和可见区间。remove-keyframe 表示对象从该帧起缺席，直到下一枚普通关键帧；删除这枚标记会恢复可见性。[关键帧文档](https://docs.segments.ai/how-to-annotate/label-sequences-of-data/use-keyframe-interpolation)明确区分了“删除一个关键帧”和“添加对象缺席标记”。

它的 3D 推荐流程也要求标注员在对象消失帧移除 cuboid，动态对象通过少量关键帧和插值覆盖中间帧；静态对象可以用轨迹级 `is_static` 属性，让尺寸和姿态修改同步到其它帧。[序列标注指南](https://docs.segments.ai/how-to-annotate/label-3d-point-clouds/tips-for-labeling-cuboid-sequences)

公开标签格式仍按 `frames[]` 导出逐帧 cuboid，并带 `track_id`、`is_keyframe` 和 `index`。[标签格式](https://docs.segments.ai/reference/label-types)说明 UI 可以使用稀疏关键帧语义，同时向下游提供物化帧。这两层不必二选一。

### 2.2 Scale 把对象写成稀疏时间 path

Scale Sensor Fusion Scene 中，每个 annotation 有稳定 UUID、类型、`stationary`、属性和时间 path。官方文档说明响应只在对象值变化时写入位置，静态对象不需要每个时间戳都有记录。cuboid path 还包含激活时间、duration、姿态，以及各相机投影的时间戳、2D 框和 `confirmed` 状态。[Sensor Fusion Reference](https://api-reference.scale.com/docs/api-reference/sensor-fusion-reference)

这套结构把对象身份、时间路径和传感器投影放在同一对象下。它还允许 `parent_id` 与关系定义，适合表达车辆与挂车、对象与关键点等复合语义。[LiDAR Task API](https://scale.com/docs/api-reference/sensor-fusion-lidar-tasks)

Scale 的公开标注指南要求对象短暂离场后仍保持同一 trail；若类别发生语义变化，则结束旧 trail 并建立新 trail。[3D 标注指南](https://scale.com/guides/data-labeling-annotation-guide)给出的规则进一步说明：身份连续、可见性连续和类别连续是三件不同的事。

### 2.3 Kognic 与 OpenLABEL 把身份、区间和几何分开

Kognic 把原始 Scene 与用于生产的 Input 分开，同一个 Scene 可以创建多个不同任务。交付和预标注采用 OpenLABEL，对象 UUID 跨帧稳定。[Key Concepts](https://developers.kognic.com/docs/key-concepts/)

Kognic 的预标注文档推荐使用 object data pointer：对象声明某个几何在哪些 `frame_intervals` 存在，只需在首尾帧提供几何，中间帧可以插值。3D 插值既能在帧局部坐标执行，也能在世界坐标执行；后者需要 ego pose。[Pre-annotations](https://developers.kognic.com/docs/kognic-io/pre_annotations/)还明确区分 stationary 与 static，并指出传感器专属属性和 3D 几何存在实际支持边界。

OpenLABEL 的对象、动作、事件、上下文和关系都有独立身份与帧区间，几何通过 frame 数据和 object data pointer 挂到这些实体上；流和坐标系描述传感器与变换。[OpenLABEL 标准](https://www.asam.net/standards/detail/openlabel/)适合做导入导出和领域术语对照，但完整 Schema 比当前产品需求宽得多。

### 2.4 BasicAI 与批量工作台强调对象级修轨

BasicAI 的 LiDAR Fusion 工作流允许对选中对象或全部对象做前向、后向和自定义区间跟踪。插值至少需要两个真值锚点，完成后进入 Batch Review，在多帧中调整同一对象并复核类别和属性。[Object Detection & Tracking](https://docs.basic.ai/docs/object-detection-tracking)

Segments.ai 的 Batch Mode 也采用“先选对象，再并排看多帧”的路径，可以在任意帧添加或移除对象，关键帧规则与单帧工作台一致。[Batch Mode](https://docs.segments.ai/how-to-annotate/label-3d-point-clouds/batch-mode-for-dynamic-objects)

两家公开流程都以对象为修轨单位，而不是逐帧清单。当前本项目已经有跨帧任务中心和 Scene 时间轴，可以继续沿用入口，但需要后端返回完整轨迹状态，而非只返回首帧、末帧和成员数。

### 2.5 Supervisely 的 object/figure 分层与 CVAT 的 outside 状态

Supervisely Point Cloud Episode 的官方格式把整个 episode 的对象放在 `objects[]`，逐帧几何放在 `frames[].figures[]`，figure 通过 `objectKey` 归属稳定对象；对象 tag API 还可以给同一对象附加 frame range。[Point Cloud Episode Annotation](https://developer.supervisely.com/getting-started/supervisely-annotation-format/point-cloud-episodes)证明它没有把“对象”降级成逐帧 cuboid 数组，但公开格式没有独立的通用 presence interval 或可逆操作 journal，因此本文只借鉴 object/figure 边界，不推断内部数据库。

CVAT Track mode 使用关键帧、插值与 `outside` 属性：对象离开画面时设置 outside，之后重新出现可以在同一 Track 上恢复；3D cuboid 也能使用 Track 模式。[Track mode](https://docs.cvat.ai/docs/annotation/tools/track-mode-advanced/)与[3D object annotation](https://docs.cvat.ai/docs/manual/advanced/3d-object-annotation-advanced/)共同证明“缺席”应是时间状态而非删除身份。CVAT 的导出合同和界面状态并不等于本项目必须照搬单一 outside 布尔；多个闭区间更适合 Scene Track 查询和约束。

### 2.6 Encord 与 Labelbox 验证了人工锚点和派生结果必须分层

Encord 的视频插值把人工标签保留为 100% 置信度锚点，插值标签为 99%，再次插值只覆盖低于 100% 的派生结果；对象菜单还提供 Split object track 和按帧范围删除。[Interpolation](https://docs.encord.com/platform-documentation/Annotate/automated-labeling/annotate-interpolation)与[Label Editor](https://docs.encord.com/platform-documentation/Annotate/annotate-label-editor/annotate-label-editor-annotate)说明“来源”和“时间角色”必须分开，否则无法安全重算派生段。

Labelbox 的视频编辑器在对象创建或修改时生成关键帧，并在关键帧间插值；对象实例的持续范围由轨迹控制。[Video editor](https://docs.labelbox.com/docs/video-editor)只能核验 2D 通用交互，不能证明其 3D 点云内部模型。它仍为“人工修改自动成为锚点”提供了独立商业产品对照。

### 2.7 开源工具验证了能力面，数据合同深度不同

3D-BAT 同时提供序列、插值、自动跟踪、撤销、Review、OpenLABEL 和多传感器支持。Scalabel 允许对象消失后在后续帧重新链接，关联框保持同一身份并在关键帧之间插值。Xtreme1 用 Scene、单帧和传感器文件树组织输入，`trackId` 贯穿帧和相机成员。

CaliperGT 在 2026 年公开的文档中包含 track merge、关键帧插值、4D stacking 和 Annotation、QA、Customer QA、Accepted 流程。它的导出仍把 3D cuboid 写成逐帧记录并携带 `track_id`。仓库建立时间短、公开采用证据少，本文只把它当作近期设计样本，不据此判断生产稳定性。

### 2.8 能力矩阵揭示的共同底座

| 平台 / 来源       | 稳定对象身份 | 人工锚点与派生帧分离 | 显式缺席 / 重现 | 对象级拆分 / 合并 | 多传感器成员 | 可核验服务端撤销日志 |
| ----------------- | ------------ | -------------------- | --------------- | ----------------- | ------------ | -------------------- |
| Supervisely       | 是           | 部分                 | 未核验          | 未核验            | 是           | 未核验               |
| Segments.ai       | 是           | 是                   | 是              | 改 track ID 合并  | 是           | 未核验               |
| Scale             | 是           | 稀疏 path            | duration/path   | 未核验            | 是           | 未核验               |
| Kognic/OpenLABEL  | 是           | 是                   | frame interval  | 未核验            | 是           | 未核验               |
| BasicAI           | 是           | ground truth/结果    | 帧结果范围      | 是                | 是           | 未核验               |
| CVAT              | 是           | 是                   | outside         | Join/Split        | contextual   | 未核验               |
| Encord（2D 对照） | 是           | 是                   | 范围删除        | Split             | 不适用       | 未核验               |

共同部分足以支持稳定 Track、成员角色和存在范围；没有一家公开材料足以证明服务端可逆 journal 的具体实现。因此 journal 是本项目为协作编辑、质量修复和幂等 API 增加的工程能力，不包装成竞品事实。

---

## 3. 三组差异决定数据模型

### 3.1 稀疏状态与逐帧物化可以共存

| 路线                       | 代表                                     | 优点                                       | 代价                                             |
| -------------------------- | ---------------------------------------- | ------------------------------------------ | ------------------------------------------------ |
| 稀疏 path / frame interval | Scale、Kognic、OpenLABEL                 | 关键帧和存在范围清楚，长 Scene 存储紧凑    | 查询和编辑必须处理插值、坐标系与区间             |
| 逐帧 frame array           | Segments.ai 导出、CaliperGT 导出、本项目 | 读取、过滤、导出简单；每帧几何可独立版本化 | 很难仅从成员缺口判断对象是缺席、漏标还是尚未处理 |
| 稀疏控制面加物化读模型     | Segments.ai 的 UI 与导出组合             | 用户语义清楚，同时兼容逐帧消费者           | 必须防止控制面与物化结果漂移                     |

本项目适合第三条。直接把全部 Annotation 改成紧凑 path，会同时冲击权限、任务锁、Data Manager、导出、质量和协作；继续只看逐帧成员，又无法可靠表达缺席。新增 Scene Track 与存在区间，把当前 Annotation 保留为几何读模型，可以逐步迁移。

### 3.2 “终止”和“暂时缺席”必须分开

至少需要以下语义：

| 动作     | 对象身份                           | 后续既有几何                           | 是否允许恢复                                     |
| -------- | ---------------------------------- | -------------------------------------- | ------------------------------------------------ |
| 标记缺席 | 保留                               | 区间内不参与显示、导出和质量真值       | 允许由普通关键帧恢复                             |
| 终止轨迹 | 保留历史身份，关闭最后一个存在区间 | 边界后的成员进入预览清单，不能静默删除 | 可通过撤销恢复；重新出现默认建立新轨迹或显式恢复 |
| 删除轨迹 | 逻辑删除整个对象                   | 所有成员停用                           | 只通过受审计撤销恢复                             |
| 拆分     | 生成第二个身份                     | 边界后成员迁移到新身份                 | 两个对象独立存在                                 |
| 合并     | 选择 survivor                      | 两侧成员归入同一身份，区间可不连续     | 需要保存反向映射才能撤销                         |

“重新出现默认建立新轨迹还是恢复旧轨迹”属于项目标注规范。平台应提供两个显式动作，不能根据时间间隔猜测。

### 3.3 类别、属性和传感器可见性不在同一层

Segments.ai 的 `is_static` 是轨迹级属性，普通对象属性可以随关键帧变化。Scale 允许 annotation 属性与逐传感器投影确认并存。Kognic 公开了几何级、stream 级属性的支持限制。由此可分出四个作用域：

- 轨迹级：稳定类别、物理身份、静态或 stationary 标记。
- 时间级：速度状态、姿态状态、行为、遮挡等随时间变化的属性。
- 几何成员级：某一帧 3D cuboid 或 point mask 的来源、置信度和修订。
- 传感器级：某个相机中的可见、遮挡、截断、人工 2D 成员和投影确认。

现有 `Annotation.attributes` 只能稳定承载成员级属性。把其它三层都复制到每帧，会产生批量同步和冲突语义；轨迹领域应为后续多模态对象草案预留明确作用域。

---

## 4. 本项目当前模型的边界

### 4.1 已有基础

| 能力     | 当前实现                                      | 可继续使用                                          |
| -------- | --------------------------------------------- | --------------------------------------------------- |
| 身份键   | `Annotation.track_id`，统一 `trk_<uuid>` 工厂 | 继续作为外部 ID 和成员查询键                        |
| Scene    | `Scene`、`DatasetItem.scene_id/frame_index`   | 作为轨迹作用域                                      |
| 位姿     | `SceneFramePose`                              | 世界坐标插值和运动补偿                              |
| 几何版本 | `Annotation.version`                          | 并发与 stale 检查                                   |
| 原子预览 | split/merge 的 snapshot token 与排序锁行      | 提炼成所有轨迹命令的公共执行合同                    |
| 操作基础 | `AnnotationOperation`、lineage、AuditLog      | 可复用幂等和谱系模式，不直接塞入现有 Mask kind 枚举 |

ADR-0045 解决了跨几何类型的身份键分裂，但它没有建立轨迹实体。当前服务每次按 `track_id` 聚合 Annotation，轨迹类别、首末帧、成员数和合法性都是临时推导；数据库无法记录多个存在区间、缺席标记、轨迹级属性或轨迹修订版本。

### 4.2 当前 `source` 不能兼任时间角色

当前代码用 `manual`、`prediction_based`、`interpolated` 等 source 描述结果来源。一个人工修正过的模型帧既有人类修订来源，也可能仍是插值区间内的关键帧；“谁产生它”和“它在时间模型中是什么”是两条正交信息。

推荐给轨迹成员增加独立时间角色，至少区分 `keyframe`、`derived` 和普通采样成员。具体列或关联表由 ADR 决定，不能修改 source 的既有含义。

### 4.3 现有 split/merge 是可复用原型

当前拆分与合并已经具备候选、预览、快照令牌、权限复核、确定锁序和原子执行。缺口在于操作没有统一的可逆 journal，执行结果只改 `track_id` 与 Annotation version；未来的 Quality Issue 也没有稳定命令 ID 可以引用。

这条链路适合升级，不需要另造第二个弹窗和第二套并发协议。

---

## 5. 推荐领域模型

### 5.1 `scene_tracks`

每条记录表示一个 Scene 内对象身份，建议包含：

- `id` 与稳定 `track_id`。
- `project_id`、`scene_id`、`class_name`。
- 轨迹级 `attributes` 与 `attributes_meta`。
- `revision`，所有成员、区间或轨迹级属性变化都会递增。
- `created_by`、`retired_at` 和审计时间。`retired_at` 表示身份被逻辑删除，不表示对象在某帧不可见。

对 3D Scene 的新成员，`Annotation.track_id` 必须能解析到同 Scene 的 `scene_tracks`。视频 compact track 暂时保持现有合同，后续若统一到 Scene 再单独迁移，不能在本次用多态外键强行覆盖两种存储。

### 5.2 `scene_track_intervals`

存在区间使用闭区间 `[start_frame, end_frame]`，一条轨迹允许多个互不重叠的区间。开放尾段可用 `end_frame=NULL`，但只有 Scene 长度未知或持续摄取时才允许；固定数据集应写实终点。

区间带 `source`、`created_by`、`version` 和可选 operation 关联。轨迹的缺席标记、终止标记与时间轴色带都由相邻区间推导，不再另存一份布尔状态。

数据库需要约束同一轨迹区间不重叠。是否允许首尾相邻的两个区间应冻结为“不允许”，相邻区间应合并，否则同一可见段会产生多种表示。

### 5.3 时间角色与物化成员

逐帧 Annotation 继续保存实际 geometry。新增时间角色后：

- `keyframe` 是用户或已接受模型明确冻结的锚点。
- `derived` 是插值、传播或跟踪生成的可重算成员。
- `sample` 是导入格式只提供逐帧结果、无法判断关键帧的兼容状态。

轨迹命令只能自动停用可重算成员。边界之后存在人工 keyframe 时，终止预览必须列出冲突，并要求用户选择“缩短存在区间但保留为隐藏历史”或“在该关键帧恢复同一轨迹”；第一版不提供静默覆盖。

### 5.4 `scene_track_operations`

操作日志建议保存：

- Scene、actor、operation kind、幂等键和请求摘要。
- 受影响轨迹 revision、Annotation id/version 与区间 version。
- 执行前后摘要、结果和 inverse payload。
- `committed`、`reverted` 状态，以及撤销该操作的 operation id。

支持的第一组命令为 `split`、`merge`、`mark_absent`、`resume`、`terminate` 和 `revert`。Quality Issue 只引用命令建议和 locator，仍然不能自动执行真值修复。

可逆日志是本文基于本项目协作、质量和审计需求作出的设计推断。公开平台通常展示 Undo 或 Review，却没有公开足够的服务端 journal 细节，不能把这一结构写成竞品事实。

---

## 6. 推荐实施顺序

### 6.1 领域 ADR 与只读影子模型

先写 ADR，对比三种方案：继续派生、轨迹 sidecar、Scene Track 聚合。ADR 要冻结身份作用域、区间语义、时间角色、Annotation 与 Track 的权威关系、视频兼容边界和回滚方式。

新增表后从 `(project_id, scene_id, track_id)` 回填轨迹。历史数据只能确认“这些帧有成员”，不能把中间缺口自动判为缺席；合法链先回填为 `[min(member_frame), max(member_frame)]` 的 `legacy_envelope`，区间内部的成员缺口继续表示缺标或未物化，并在 verifier 中报告类别漂移、重复帧和跨 Scene 污染。

### 6.2 双写和读路径校验

创建、传播、插值、跨帧任务和 split/merge 同步维护轨迹 revision 与区间。Scene 时间轴先读取新摘要，同时在诊断模式比较旧聚合结果。所有差异都有稳定 code，不能用日志文本判断是否可发布。

### 6.3 生命周期命令与撤销

在现有跨帧任务中心增加缺席、恢复和终止。每个动作继续走“预览、快照、确认、原子执行”；预览分开统计 keyframe、derived、锁定、不可编辑和区间变化。成功后提供一次明确的撤销入口，撤销仍需检查操作之后有没有新修改。

### 6.4 质量和多模态接入

3D Quality 的 track 断点、类别漂移和时序跳变改读 Scene Track revision 与区间，并把修复建议指向 track command。持久化多模态对象以 Scene Track 为共同身份，传感器成员继续独立版本化。

---

## 7. 下一版本的建议边界

建议候选名称：`3D 时序对象与轨迹生命周期基础`。

一个可发布的版本应同时交付：

- 领域 ADR、`scene_tracks`、存在区间、操作 journal 和安全回填。
- 所有 3D Track 写路径双写，旧数据兼容读取。
- 轨迹详情 API，返回区间、关键帧角色、来源摘要、revision 和可执行命令。
- split/merge 迁入统一命令日志。
- 缺席、恢复、终止和无后续变更时的精确撤销。
- Scene 时间轴与跨帧任务中心展示完整存在区间和命令预览。
- nuScenes mini 浏览器 E2E 覆盖“出现、缺席、恢复、终止、撤销、拆分、合并”。

下面几项不应塞进同一版本：3D 自动质量规则、持久化人工 2D 成员、OpenLABEL 全量导入导出、视频 compact track 迁移、跨 Scene 身份。这些方向依赖新轨迹领域，但各自还需要独立真值与兼容决策。

---

## 8. 验收门

| 门         | 通过条件                                                                                    |
| ---------- | ------------------------------------------------------------------------------------------- |
| 数据完整性 | 回填前后活跃 Annotation 数、track 成员关系和几何哈希一致；异常链有报告，不猜测修复          |
| 区间性质   | 任意命令序列后区间有序、不重叠、不相邻；每个活跃成员落在一个存在区间内                      |
| 并发       | preview 后任一 Track、interval 或 Annotation revision 变化，execute 返回 stale 且零部分写入 |
| 撤销       | 只有目标 operation 之后无相关写入时可撤销；撤销恢复精确 ID、版本、区间与成员状态            |
| 兼容       | 旧客户端仍能按 `Annotation.track_id` 查询；非 Scene 视频与图片不受迁移影响                  |
| 下游       | 时间轴、Data Manager、可信导出和 3D Quality 都遵守存在区间，不显示或导出缺席成员            |
| 浏览器     | nuScenes mini 完整流程无 console error，刷新后状态、区间和撤销结果一致                      |

随机命令序列适合做性质测试：生成关键帧、缺席、恢复、拆分、合并和撤销组合，持续检查区间与成员不变量。固定 happy path 无法覆盖这类状态空间。

---

## 9. 主要资料

- [Segments.ai：3D cuboid interface](https://docs.segments.ai/how-to-annotate/label-3d-point-clouds/3d-point-cloud-cuboid-interface)
- [Segments.ai：cuboid sequence tips](https://docs.segments.ai/how-to-annotate/label-3d-point-clouds/tips-for-labeling-cuboid-sequences)
- [Segments.ai：keyframe interpolation](https://docs.segments.ai/how-to-annotate/label-sequences-of-data/use-keyframe-interpolation)
- [Segments.ai：label formats](https://docs.segments.ai/reference/label-types)
- [Scale：Sensor Fusion Reference](https://api-reference.scale.com/docs/api-reference/sensor-fusion-reference)
- [Scale：Sensor Fusion / LiDAR Tasks](https://scale.com/docs/api-reference/sensor-fusion-lidar-tasks)
- [Scale Nucleus：uploading 3D data](https://nucleus.scale.com/docs/uploading-3d-data)
- [Kognic：Key Concepts](https://developers.kognic.com/docs/key-concepts/)
- [Kognic：OpenLABEL pre-annotations](https://developers.kognic.com/docs/kognic-io/pre_annotations/)
- [BasicAI：Object Detection & Tracking](https://docs.basic.ai/docs/object-detection-tracking)
- [Dataloop：LiDAR Data Setup](https://docs.dataloop.ai/docs/lidar-data-setup)
- [Supervisely：Point Cloud Episode Annotation](https://developer.supervisely.com/getting-started/supervisely-annotation-format/point-cloud-episodes)
- [Supervisely：Point Cloud Episode object tags](https://developer.supervisely.com/getting-started/python-sdk-tutorials/point-clouds/pointcloud-episodes-and-object-tags)
- [CVAT：Track mode](https://docs.cvat.ai/docs/annotation/tools/track-mode-advanced/)
- [CVAT：3D object annotation](https://docs.cvat.ai/docs/manual/advanced/3d-object-annotation-advanced/)
- [Encord：Interpolation](https://docs.encord.com/platform-documentation/Annotate/automated-labeling/annotate-interpolation)
- [Encord：Label Editor object operations](https://docs.encord.com/platform-documentation/Annotate/annotate-label-editor/annotate-label-editor-annotate)
- [Labelbox：Video editor](https://docs.labelbox.com/docs/video-editor)
- [ASAM OpenLABEL 1.0.0](https://www.asam.net/standards/detail/openlabel/)
- [3D-BAT](https://github.com/walzimmer/3d-bat)
- [Scalabel](https://github.com/scalabel/scalabel)
- [Xtreme1](https://github.com/xtreme1-io/xtreme1)
- [CaliperGT](https://github.com/caliperai-ai/caliperai-gt)

## 10. 最终判断

现有 `Annotation.track_id` 适合回答“这一帧属于哪个对象”，但回答不了“这个对象在 Scene 中什么时候存在、哪些帧是人为锚点、哪段是系统派生、一次修复如何撤销”。继续在服务层临时聚合，会让终结、遮挡、重现、质量修复和多模态成员分别发明自己的边界规则。

下一版应建立 Scene Track、存在区间和可逆命令日志，再交付终结动作。这样增加的迁移和写路径改造有实际成本，却能同时服务 Scene 时间轴、跨帧任务中心、3D Quality、可信导出和后续多模态对象，不需要在每个功能里重复推断轨迹状态。
