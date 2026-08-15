# Changelog

本文件记录 AI 标注平台的所有重要变更。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

历史版本详情见 [`docs/changelogs/`](docs/changelogs/)：

| 版本组 | 文件                                                   |
| ------ | ------------------------------------------------------ |
| 0.22.x | [docs/changelogs/0.22.x.md](docs/changelogs/0.22.x.md) |
| 0.21.x | [docs/changelogs/0.21.x.md](docs/changelogs/0.21.x.md) |
| 0.20.x | [docs/changelogs/0.20.x.md](docs/changelogs/0.20.x.md) |
| 0.19.x | [docs/changelogs/0.19.x.md](docs/changelogs/0.19.x.md) |
| 0.18.x | [docs/changelogs/0.18.x.md](docs/changelogs/0.18.x.md) |
| 0.17.x | [docs/changelogs/0.17.x.md](docs/changelogs/0.17.x.md) |
| 0.16.x | [docs/changelogs/0.16.x.md](docs/changelogs/0.16.x.md) |
| 0.15.x | [docs/changelogs/0.15.x.md](docs/changelogs/0.15.x.md) |
| 0.14.x | [docs/changelogs/0.14.x.md](docs/changelogs/0.14.x.md) |
| 0.13.x | [docs/changelogs/0.13.x.md](docs/changelogs/0.13.x.md) |
| 0.12.x | [docs/changelogs/0.12.x.md](docs/changelogs/0.12.x.md) |
| 0.11.x | [docs/changelogs/0.11.x.md](docs/changelogs/0.11.x.md) |
| 0.10.x | [docs/changelogs/0.10.x.md](docs/changelogs/0.10.x.md) |
| 0.9.x  | [docs/changelogs/0.9.x.md](docs/changelogs/0.9.x.md)   |
| 0.8.x  | [docs/changelogs/0.8.x.md](docs/changelogs/0.8.x.md)   |
| 0.7.x  | [docs/changelogs/0.7.x.md](docs/changelogs/0.7.x.md)   |
| 0.6.x  | [docs/changelogs/0.6.x.md](docs/changelogs/0.6.x.md)   |
| 0.5.x  | [docs/changelogs/0.5.x.md](docs/changelogs/0.5.x.md)   |
| 0.4.x  | [docs/changelogs/0.4.x.md](docs/changelogs/0.4.x.md)   |
| 0.3.x  | [docs/changelogs/0.3.x.md](docs/changelogs/0.3.x.md)   |
| 0.2.x  | [docs/changelogs/0.2.x.md](docs/changelogs/0.2.x.md)   |
| 0.1.x  | [docs/changelogs/0.1.x.md](docs/changelogs/0.1.x.md)   |

---

## [Unreleased]

### Added

- 后台导出任务现在会展示选中的全部目标格式，完成后同时给出 ZIP 内文件数和产物大小，便于下载前核对输出。
- 自动化流程可用独立的营销母版 project 按单一目标录制。工作台以 1440×810 逻辑 viewport 和 1.8 像素倍率生成 2592×1458/60Hz GPU 采集画面，再以 Lanczos 输出 3840×2160/60fps；归档同时保存不可变 MKV/H.264 采集源和 MP4/H.264 通用母版，明确跳过混合多个功能的组合教程；每项资产按内容摘要存入 Git 忽略目录，以硬件合成、校准后的内容区、有效帧节奏、分辨率和独立时长作为门禁，并在 manifest 记录主题、目标、分镜、剪辑提示、源 commit、媒体参数、采集源尺寸、重采样方式、SHA-256 与预留对象存储键，便于 Agent 后期制作社交平台派生版。
- MKV 与 MP4 按每项资产声明的真实操作窗口自动去掉登录、白屏、骨架屏与网络等待，不再以慢放、刻意放慢鼠标或无意义重复动作补足时长；未裁切缓存仅用于生成母版并在结束后删除。单次命令的批次身份在 Playwright 启动前固定，worker 重启不再把全量资产拆成多个 manifest。
- 视频 Tracking 营销母版把混合多种提示方式的单条录制拆为跨帧多正点、正负点修正和整车框种子三条独立完整链路；每条链路都为左右两辆公交车建立独立目标并同时追踪，负点紧邻车身轮廓且专门停留展示，候选生成后再拖动时间轴呈现两个 AI 追踪框的跨帧变化，便于按能力单独剪辑推广。
- 文档站新增 H.264 MP4 + WebP 流程媒体组件和 4K60 母版派生器，将多目标追踪、AI 预标、OCR、候选审阅、视频与点云等长链路从低帧率 GIF 迁移为 720p/30fps 视频；新增流程媒体来源 manifest、人工复核 commit/哈希清单、每周审计报告和发布前严格检查，便于按仓库变更定期规划重录。

### Changed

- 首页 AI 辅助、OCR、智能点、智能框与 Exemplar 演示统一由对应 4K60 母版派生为 720p/30fps VP9 WebM、H.264 MP4 fallback 和 WebP 封面；普通流程录制不再覆盖首页成品。

### Fixed

- 失败预测重试会沿用原请求的模型上下文，并把对象存储键转换为 ML Backend 可读的签名地址；完成后的单题重试作业也可直接进入对应工作台，避免重试仍因输入不可达或参数丢失而失败。
- 视频 Mask 关键帧或追踪候选更新后延迟释放旧画布位图，避免 Mask 绘制异常阻断同帧的标签与交互层重绘，导致画面继续显示旧轮廓和“保持”帧标签。
- 文档视频初始只加载 WebP 封面，首次进入可视区域才请求并播放 MP4，离开后自动暂停，避免同一页面的多段演示视频同时下载和解码造成滚动卡顿。
- 修正截图专用道路图片中车辆预测框的源坐标与录制锚点，让快速入门录制在提交前完成类别选择，并在切换媒体时重建 Konva 画布，避免导入标注偏离真实车辆或上一题的交互节点跨题残留。
- 为图像画布的拖拽管线增加捕获阶段的鼠标移动兜底，避免 Konva 消费冒泡事件时，远程桌面或自动化输入只触发按下却无法完成画框。
- 将营销母版的指针输入改为按 60Hz 节拍逐帧发送受信任的 Playwright 鼠标事件，并用独立帧校准动画要求有效独立画面不低于 55fps、独立帧占比不低于 90%，同时把实测值写入 manifest，避免标称 60fps 实际由大量重复帧组成而出现拖框卡顿或近似慢放。
- 录制锚点按图片或视频的实际渲染边界换算，并强制等待正确类别选择和 annotation API 落库；AI 素材补齐真实目标提示、候选、人工审阅/采纳和保存结果，避免随机画框、类别缺失或只录到操作开头。
- 根据校准出的 Chromium 内容区精确裁切 4K 画面，避免固定底部对齐裁切造成工作台顶部缺失和底部黑边。
- 远程无显示器会话改为先由 X11 主动按 60Hz 采样 2592×1458 画面、再交给 NVENC 编码和生成 4K 母版，避免损伤驱动的窗口采集在无物理刷新源时用重复帧补齐标称 60fps。
- 修复无源单目标视频追踪在 PVS 返回 `instance_id` 但未显式标记主实例时没有把上一窗末帧几何续给下一窗的问题，避免真实 SAM3 跨窗任务在第二窗以“缺少种子”失败。
- 修复无源多目标视频追踪接受候选时，为整段均不可见的实例落库空轨迹，导致随后刷新标注返回 500 的问题。

## [0.24.0] - 2026-08-14

### Added

- **放大相机投影视图可直接微调 3D 框中心**. 选择单个可编辑框后拖动中心手柄，点云主视图、三正交视图和其他相机投影会共享实时草稿；松手只保存一次，取消操作不会写入标注历史。
- **Python SDK TUI 升级为按需加载的终端运维台**. 增加服务端筛选与分页、Dataset/Batch/项目 Pool 下钻和失败 Job 重试；逐视图错误会保留最近成功数据，窄终端布局与 Backend 实时 WebSocket 也纳入 Pilot 回归。
- **Python SDK / CLI 增加模型服务运维能力**. 明确区分项目 backend/pool 启用、全局物理 registry instance 和逻辑 service pool；支持成员 drain/resume、能力指纹漂移确认、路由拓扑和 runtime snapshot，并保留服务端 fail-closed 静默守卫。
- **Python SDK / CLI 补齐批次、任务与审核自动化流程**. 支持批次流转/分配/批量操作/导出、任务提交与审核闭环、标注批量修改和失败 job 重试；批量操作保留部分成功结果供脚本精确重试。
- **Python SDK / CLI 补齐核心资源管理写能力**. 支持更新和删除项目/数据集、管理数据集文件与项目关联、创建和维护批次、添加和移除项目成员；CLI 对破坏性操作提供预览、交互确认与脚本化 `--yes` 守卫。

### Fixed

- 修复窄屏 3D 工作台无法手动展开自动折叠的相机面板，以及 3D 快捷键与工作台全局监听重复处理的问题。
- 修复数据集文件删除未校验父数据集、失败预测重试可被重复入队的问题，避免错误 ID 组合误删文件或重复生成预测。
- 修复协作视频的 AI 接受、边界质检、缓存与 tracker session 作用域，避免跨 Task 数据串入、无 Segment 标注、陈旧 canonical 结果和执行中上下文被提前清理。
- 修复 Python SDK 批次 VOC 导出响应误解析，以及 TUI Job 类型筛选与失败项重试入口不匹配服务端能力的问题。

## [0.23.33] - 2026-08-14

### Added

- **超级管理员可在系统设置管理连接器主机白名单**. 页面展示部署默认或数据库覆盖来源，支持规范化校验、空名单确认和一键恢复部署默认；显式配置部署主机地址后，还可从数据连接器页预填受白名单约束的 SFTP 连接器。
- **Python SDK、CLI 与 TUI 改用独立 SemVer 并公开 AAP target**. 安装元数据、运行时常量和 CLI 版本输出由同一来源生成；OpenAPI 契约测试直接扫描真实调用点，并以能力台账提示新增稳定端点，平台迭代不再依赖不完整的手工端点清单。

### Changed

- 新建 S3 / OSS 连接器默认启用 HTTPS；SFTP 测试与导入统一支持 RSA、Ed25519、ECDSA 私钥，并在生产 API 与 worker 间共享只读 `known_hosts`。

### Fixed

- 连接器创建、编辑、测试或删除失败时会保留表单并显示服务端原因，不再出现无反馈的失败。

## [0.23.32] - 2026-08-14

### Added

- **审计页新增可下钻的 UTC 月度概览**. 超级管理员可按月查看事件总数、错误事件、每日趋势、Top action、目标类型和角色分布，并从动作排行直接进入原始明细；历史完整日由日粒度物化视图读取，当天与刷新落后范围由在线分区实时补齐，避免报表静默缺数。

### Fixed

- 修复视频工作台未把项目关键点骨骼传入视频画布，导致关键点工具可用但点击无法落点的问题。

## [0.23.31] - 2026-08-13

### Fixed

- 修复已提交视频 Segment 在列表刷新或释放请求后被降级为 `assigned`，确保完成态保持不可逆。

## [0.23.30] - 2026-08-13

### Added

- **长视频可按带 overlap 的 Segment 并行协作**. 项目可在空标注、无运行中 tracker job 时启用协同；Annotation 以 segment fragment 隔离保存，工作台提供显式领取、租约续期、切换释放、work/core 时间轴边界带、分段提交与审核返工，多名标注员可同时处理同一视频的相邻分段。
- **SAM2 与 SAM3 interactive tracker 支持跨窗状态续追**. Backend 通过 capability 声明 session context 和帧数上限，runner 在同一 context span 内复用 predictor state，并在正常结束、取消、失败或超时后释放资源；不支持 session 的 backend 保持末帧 geometry 续种兼容路径。
- **相邻分段提交后自动生成 Track 边界质量报告**. 固定版本 TrackEval 指标子集提供 HOTA、IDF1、双向 MOTA、Track / segment / chapter 汇总和连续错误帧定位；审核员可调整或补充 identity pair、跳帧并排核对两侧 fragment、重跑失败或过期报告并接受对账。

### Changed

- **协同视频的审核与导出统一使用 canonical 轨迹投影**. 每个 fragment 先裁回自己的 core range，再按已接受的 `same_track` 决策聚合；未接受或 stale 的相关边界会阻止任务通过和跨界导出，单一 core 内的范围导出不等待无关边界。
- **视频标注写入在协同模式下统一按 active Segment 校验**. 创建、更新、删除、批量操作、AI 接受、Mask mutation / conversion 与 tracker 接受都要求当前 assignee、有效 lease 和 work range；Task 级长锁不再阻止相邻分段并行。

### Fixed

- 避免视频协同配置尚未加载时抢先发起无 segment 的标注读取与旧 Task 锁请求，消除工作台首次进入的 422 竞态。
- **协同分段切换不再复用上一分段的 Annotation 缓存或发起无 scope 预取**. 查询键、历史写回、转换与 Mask 刷新均绑定当前 segment，避免跨分段短暂显示或刷新错误数据。
- **Raster Mask 浏览器二进制边界兼容严格 typed-array 类型**. gzip Blob、ImageData 与 Worker transfer 会显式持有可传输的 ArrayBuffer，前端类型检查和发布构建不再被 `ArrayBufferLike` 拒绝。

## [0.23.29] - 2026-08-13

### Added

- **视频导出可限定单个任务的连续 Segment 或源帧闭区间**. 项目与批次 API 会在入队前校验并固定范围，Dashboard 可选择整个项目或单视频范围；同一范围贯穿预检、缓存、Video / AAP JSON、MOT、KITTI、YOLO / COCO Frames、DAVIS、YouTube-VOS、MOTS 与 manifest，轨迹边界状态、outside、全局采样相位和源帧映射均保持一致。

## [0.23.28] - 2026-08-13

### Added

- **视频单帧关键点与旋转框可以完整创建和编辑**. 视频工具栏新增 `F` 关键点和 `W` 旋转框；关键点支持按骨骼顺序落点、遮挡、跳过和节点修正，旋转框支持真实区域选择、移动、局部轴缩放和顶部旋转手柄。AAP JSON 与 Video JSON 保留原始几何，专业视频格式会在预检中明确报告不支持。
- **AAP JSON 外部视频预测可进入逐帧人工审阅闭环**. 导入预检会校验视频任务、帧范围、关键帧顺序、outside 与 portable Mask 内容，正式导入只创建外部候选；视频工作台按当前帧显示 bbox、polygon、polyline 和真实像素 Mask，单条采纳或忽略在刷新后保持，采纳后才生成同类型正式标注。
- **文档站新增十四段可复现的自动化流程动图**. 快速上手、AI 预标、审核退回、候选快捷审阅、智能笔迹精修、时间轴缩放/范围/章节操作、多目标种子、轨迹续写、视频 Mask 轨迹编辑与超大图渐进细节均可由 Playwright 重录，维护者不再需要手工复现这些操作。
- **截图 seed 增加经复核的语义录制锚点与 nuScenes 六相机环视夹具**. 智能点、框和笔迹流程可复用与任务绑定的目标坐标；3D 文档场景同时展示激光雷达主画布及前、后、左右六路相机，不再受单相机夹具限制。
- **WebCodecs strict benchmark 可自动生成三档隔离素材并验证实际 VideoToolbox decoder**. 一条命令可准备 1080p/30、1080p/60、4K/30 长素材、登录态和 ready chunks，在结束或失败时清理；Apple Silicon Chrome 的资格证据来自实际 WebCodecs player，不再依赖可能为空的静态硬解 profile。

### Changed

- **视频连续播放资格同时检查媒体时间**. precise-on 与 flag-off 都从首帧开始，必须持续前进到目标时长且未提前 ended；页面 rAF 活跃但视频没有播放不再能通过。

### Fixed

- **超大图可见瓦片与失败 generation 会自动收敛**. 可见瓦片连续失败后会在五秒冷却结束时自动重试，无需平移或缩放；reconciliation 清理失败 generation 的对象前缀后同步删除记录，历史失败不再阻塞后续 GC 批次。
- **预取缓存命中的精确帧会保留 Konva 可见回执时序**. 后续 demux 不再把已经可见帧的 ready 时间重置为空，1080p/4K 快速跨帧不会卡在 `ready` 但 painted frame 未确认的状态。
- **全新截图数据库可直接创建并绑定 stub 后端**. 截图 seed 新建注册项时会同步建立单例服务池，避免干净数据库在项目能力绑定阶段失败。
- **流程录制清理只会连接显式声明的隔离截图库**. 录制器现在要求 `SCREENSHOT_DATABASE_URL`，并校验数据库名以 `_test` 或 `_e2e` 结尾；任务、标注和 OCR 中间状态不再因继承通用连接而清理错库。
- **邀请注册会建立正式的数据组成员关系**. 数据组名称在服务端规范化，接受邀请时复用或创建数据组并同时写入 `group_id`；迁移会回填历史上只有 `group_name` 的用户，组成员统计与管理页面不再漏人。

### Security

- **邀请角色权限改为由服务端强制执行**. 项目管理员只能邀请审核员、标注员和观察者，不能通过直接调用 API 创建项目管理员或超级管理员账号。
- **邀请撤销与管理范围完成闭环**. 已撤销 token 无法再解析或注册；项目管理员只能管理自己创建的邀请，且只能重发其中的低权限邀请；数据迁移会撤销由不具备有效超级管理员权限的签发者创建、尚未接受的存量高权限邀请。

## [0.23.25] - 2026-07-31

### Added

- **Raster Mask WebGPU 增加可复现的可分离 kernel 资格工具**. 显式 benchmark runner 在同一浏览器页面交错执行 production one-pass 与水平/纵向两阶段候选，覆盖非对齐、tail、稠密、checker、边缘和确定性随机正确性，以及 radius/ROI/输入图案两轮 p95、intermediate capacity、Long Task 与 dispose 对账；该工具不被 production Worker 导入。

### Changed

- **Raster Mask WebGPU 继续只使用 one-pass production kernel**. 可分离候选的 50 组 XOR correctness 全部 exact，但 2048²/4K/4096²、radius 8/16/31 与四类输入组成的 36 个两轮性能 bucket 只有 9 个通过正向收益门，无法形成数据分布无关的静态 route；生产不增加 intermediate、第二套 pipeline、protocol selector 或 adapter-name 分支，现有 capability gate、packed CPU fallback 与独立回滚保持不变。
- **超大图 Tile × Raster Mask 客户端计算 Epic 完成封版**. one-pass 在 2048²/4K、radius 31 的百次 production operation 中保持单 owner、稳定 buffer plateau、零 Long Task、save/reload exact 与 dispose 归零；Linux X11 默认 adapter 不可用时继续以零 GPU allocation 精确回退 packed CPU，Wayland、macOS 与 Windows 实机状态明确保留为未测试而不外推。

## [0.23.24] - 2026-07-31

### Added

- **图片工作台获得 task-scoped 栅格资源协调器**. 背景 coverage/detail/prefetch、Raster Mask render/edit/history/compare、Worker cache/scratch、CPU transient 与 WebGPU buffer 统一使用按设备分档的 prospective reservation、原子 handoff、优先级 pressure 和 owner/category 快照；BUG 报告可附带脱敏资源诊断。

### Changed

- **前景 Mask 操作会主动让低优先级背景预取让行**. P0/P1 编辑真值与最低可见覆盖不会被 P4/P5 缓存挤出；超预算时先暂停预取、淘汰可重建 detail/render、释放 idle compute 并按当前 generation 恢复，避免各局部缓存分别合规但联合峰值失控。
- **页面生命周期统一治理栅格资源**. hidden 标签页延迟释放可重建资源，BFCache 保留 dirty Mask 与 history 并在返回时只恢复当前 generation，真正卸载、切题和销毁后 coordinator、bitmap、Worker 与 GPU 逻辑占用归零。

### Fixed

- **资源压力与异步失败不再留下部分编辑或重复计费**. history admission 拒绝会回滚当前操作并保留既有 undo/redo；Worker crash、GPU reset、decode abort、迟到响应和 reservation 实际值增长失败都会确定性释放，原子资源替换不再出现双份峰值或未计账空窗。
- **独立浏览器 E2E 数据库现在总是使用自己的迁移连接**. Playwright 启动 API 时会显式把 migration URL 指向隔离数据库，避免本地环境变量让开发库被升级而测试库仍停留在旧 schema。

## [0.23.23] - 2026-07-31

### Added

- **超大图工作台改为按视口渐进加载金字塔切片**. 图片与审核工作台会按缩放和设备像素比选择 LOD，只批签、下载和解码可见区域及有限预取环；overview 始终提供安全覆盖，ImageBitmap 不可用时自动使用 HTML 图片解码，无 WebGPU 的客户端也能完整浏览和标注。
- **超大图客户端资源可诊断并随 BUG 报告取证**. 调度器按设备内存使用 32/64/128 MiB 解码预算和 2/4/6 并发，记录请求、保留、预留、LRU 淘汰、位图关闭、ObjectURL、取消、迟到提交、签名刷新和可见细节覆盖；切题与卸载会确定性释放资源，并为后续背景/Mask 资源协调暴露只读快照和暂停预取入口。
- **现实超大图可一键进入当前开发栈并生成金字塔**. 固定 SHA-256 的 NASA 高熵、超宽和超高图片可幂等导入专用项目/数据集、创建可打开 Task，并显式入队等待 pyramid 终态，供浏览器回归、性能基准与文档截图共用。

### Changed

- **Minimap、邻题预取、评论画布和审核入口统一遵守图片源合同**. 金字塔图片的辅助消费者只使用 thumbnail、overview 或 manifest，不再从旁路回退并解码完整原图；达到 required 门槛的图片在切片生成中、失败或客户端 gate 关闭时保留安全预览和明确状态，绝不自动请求原图。

### Fixed

- **大图切换与缩放不再出现空白画布、错误适应或中途卡住**. 旧 source 瓦片在释放后不再进入新 Konva 图层，每个媒体 identity 都会按自身尺寸重新适应；放大后可通过滚轮或工具条继续缩回完整适应比例，Minimap 同时避让右下角缩放工具条。
- **短期 tile URL 过期或首次拉取失败可有界恢复**. 当前可见 tile 会重新批签一次后再试，仍失败则保留 overview；金字塔生成失败状态同时提供受后端冷却和频率限制保护的显式重试入口。
- **运行角色收紧为无 DDL 权限后仍可正常启动和迁移**. Alembic 支持独立的 schema-owner 数据库连接，API/Celery 继续使用最小权限运行连接；Compose 只让指定迁移入口自动升级，避免每个 Worker 都持有 DDL 凭据。
- **现实大图下载器不再把夹具写进错误的 `apps/test-results` 目录**. 默认输出现在与文档和 gitignore 一致落在仓库根 `test-results/image-seeds`；同时刷新 NASA 官方已替换字节的竖图摘要，恢复完整清单下载。

## [0.23.22] - 2026-07-31

### Added

- **超大图获得不可变代次金字塔生成与安全交付地基**. DatasetItem 共享或 direct Task 独占的 asset 现在以数据库约束和 generation lease 单飞生成 full-resolution-first、512 core + 1px overlap 的 WebP 金字塔；专用单并发 Worker 使用 pyvips/libvips 流式处理 EXIF、ICC、灰度与 alpha，在完整网格、edge、摘要和远端对象校验后才原子发布 ready。源字节、解码像素、tile、派生/临时字节、分阶段耗时、状态和 GC 均可观测。
- **Task API 提供轻量金字塔状态、manifest 与批量私有资源签发**. Task 列表/详情只附带 O(1) summary；鉴权 manifest 支持 source/generation fence、private ETag/304 和短期 overview，最多 128 项的 overview/tile batch 只接受逻辑坐标并在验证对象存在后签发，缺失对象会使 generation 自失效而不是返回坏 URL。失败重试具备幂等、冷却和频率限制。
- **提供有界回填与生命周期对账工具**. 管理脚本可按 cursor、owner 类型和 dry-run 小批量入队；每日 reconciliation 回收过期 lease、旧代次和孤儿前缀，source/DatasetItem 删除同步清理派生对象，金字塔不进入普通媒体缓存的固定期限 lifecycle。
- **现实大图 seed 可按需校验下载**. 浏览器 E2E、性能基准和文档截图可从 NASA 官方来源顺序获取高熵 RGB PNG、接近硬上限的超宽 JPEG 与 optional 边界 RGBA 竖图；manifest 固定尺寸、字节数、SHA-256、署名和媒体使用政策，原图只进入 gitignored 测试目录。

### Changed

- **普通图片 thumbnail 不再先把整个对象聚合进 Python bytes**. 小图缩略图改为流式下载到临时文件后解码，逻辑尺寸按 EXIF orientation 探测；达到金字塔门槛的图片不会再走 Pillow 整图解码，启用自动生成时转入专用队列。direct Task 缩略图同时统一写入 media-cache bucket，使读取和生命周期路由一致。
- **API 镜像加入 libvips 与 sRGB ICC profile 运行依赖**. image-pyramid Worker 固定 libvips 并发、缓存和 allocator 回收参数，并以独立队列、单并发、prefetch 1 和子进程内存上限隔离大图资源域；自动生成默认关闭，部署可先发布 schema/API 再分批开启。

### Fixed

- **Alembic 迁移失败不再被 advisory unlock 的二次事务错误掩盖**. PostgreSQL DDL 失败后会先回滚 aborted transaction 再释放 session lock，日志保留原始迁移根因。
- **金字塔生成期间替换源对象不会发布陈旧像素**. Worker 在生成前和发布前分别校验 ETag、字节数与可用对象版本，API 读取也执行同一 fence；旧 generation 会稳定进入 stale/failed，而不会继续和新标注坐标叠加。

## [0.23.21] - 2026-07-31

### Added

- **Raster Mask WebGPU 提供一次冷却重试与页内熔断诊断**. adapter、device、shader、pipeline、buffer、queue、encode、submit、map、readback 和 patch-build 故障现在记录稳定 stage；首次失败进入 30 秒 cooldown，到期后的新 eligible 请求只重试一次，连续第二次失败后当前页面固定 CPU，避免 adapter/device 重试风暴。任务内最近 20 次 typed compute event 可随 BUG 报告附带，但不包含完整 task id、Mask 内容、adapter/driver 或浏览器原始错误。

### Changed

- **大 ROI 方形膨胀的 CPU 路径改用 packed separable kernel**. 2048² 及以上、radius 1–31 的 `square dilate` 会复用 immutable packed base cache 与 dirty overrides，先做水平 word expansion，再做纵向 OR，并继续使用唯一的 word-scatter history builder；gate 关闭、无 GPU、adapter/device 初始化失败、GPU budget 不足或运行时失败均复用同一 packed source，不再重新 materialize dense alpha。两轮 2048²/4K、radius 1/8/31 的 12 个 production case 相对 dense baseline p95 改善 80.1%–91.3%，patch、save、reload checksum 全部精确一致。
- **Raster Mask CPU compute 与 GPU buffer 使用独立 hard budget**. 低内存客户端默认保留 32 MiB CPU budget 并将 GPU budget 设为零，常规/高内存档位分别使用 64/128 MiB；关闭 WebGPU 或客户端没有 adapter 不会再把 CPU budget 清零。prospective ledger 分别报告 packed/dense transient、水平 intermediate、patch upper bound、cache/scratch 与 GPU capacity。
- **production morphology 协议删除 benchmark-only per-bit selector**. Worker 固定使用已胜出的 dense word-scatter builder；direct packed kernel 只保留在纯函数测试与独立内核 runner 中，避免资格赛选择器继续污染产品消息协议和计数器。

### Fixed

- **无 GPU 的默认 Linux 浏览器不再退回数量级更慢的 dense 大 ROI morphology**. X11 默认 Chrome 的真实 `adapter-unavailable` 路径现在稳定使用 packed CPU，仍保留精确 history/save/reload 与零 GPU allocation；本机 RTX 3090 强制 Vulkan 的 WebGPU 成功路径也完成回归，单 owner、资源 plateau、零 Long Task 和 dispose 归零合同不变。

## [0.23.20] - 2026-07-30

### Added

- **五个 GPU ML Backend 提供真实受管生命周期验收器**. YOLO、Grounded-SAM2、SAM3、ONNXTools 和 RapidOCR 都会在目标镜像内执行真实业务推理、两轮全池卸载、GPU provider/device 判定和共享故障矩阵，并用同一严格外壳记录部署与物理 GPU 身份、脱敏制品摘要、显存稳定/工作集回收、最终空池状态和中间产物清理结果；`passed` 由完整证据与 blockers 推导，不能由验收器自行声明。

### Changed

- **五个 ML Backend 统一采用部署级受管生命周期声明门槛**. YOLO 不再仅凭代码实现就无条件发布 `managed_lifecycle`；默认保持 legacy，只有当前镜像、权重和物理 GPU 完成真实加载、全池卸载与显存回落验收后才允许声明能力、进入 enforce 并报告可驱逐，避免 GPU 调度接管未经验证的部署。五个验收开关只接受字面量 `0` 或 `1`，非法值会拒绝启动。
- **GPU 仲裁已完成双 RTX 3090 的逐卡实机 canary**. 五个第一方 Backend 的声明、registry claim、membership、fence、物理 GPU identity、签名控制和数据库角色隔离均已闭环；卡 0 验证共驻、容量拒绝与空闲驱逐，卡 1 验证独立 promotion/demotion，双卡冷加载可真实并行。发布仍保持 observe 安全默认，生产 enforce 继续按资源逐卡启用。
- **WebCodecs 精确帧改为按客户端能力默认尝试**. 暂停、逐帧与稳定 seek 缺省使用既有有状态 GOP 解码链路；用户可在工作台设置或以 URL / localStorage 显式关闭，浏览器不支持、codec / chunk 异常和预算不足继续安全回退原生视频路径。硬解与跨浏览器 1080p/4K 矩阵继续作为后验验证，不把软件解码或 GPU 合成误记为硬解。
- **Raster Mask WebGPU 候选进入默认构建**. 大 ROI `square dilate` 在首次相关操作时才惰性探测客户端 adapter，并继续受操作、尺寸、设备档位与字节预算门禁约束；任何能力或运行错误都精确回退 CPU Worker。生产镜像新增可回滚 build arg，设为 `false` 重建后不会加载 provider 或请求 adapter；macOS、Wayland 与 Windows 的 correctness、长会话、性能和 fallback rate 继续在路线图跟踪。

### Fixed

- **长时间 GPU 加载不会在 admission token 有效期内丢失卡级证明**. 每次成功 admission 现在原子续期 `reconcile_deadline` 到 workload hard deadline 之后，并保留有界健康证明窗口；超长预测配置会在 Backend HTTP 前明确报配置错误，不再让 4K/大模型加载中途因定时 reconcile deadline 过期连续返回 503。
- **空闲驱逐会冻结且完成唯一的 unload 分支**. victim 从 draining 进入 unloading 时先持久冻结 `eviction_branch=unload`，终态只接受同 owner/generation 的 unloading → unloaded，同一请求在响应丢失后可幂等重试；不再因通用 idle 分支抢先匹配而缺失分支证据，或在真实卸载后报 `branch_conflict` 并保守卡住账本。
- **GPU 验收器能正确记录被 dispatch 包装的 health timeout**. Resident victim 健康刷新超时即使被转换为结构化容量错误，也会归因到精确 requester action 并保留错误码；最终真值允许该未获 grant 的 requester 不产生 allocation，同时继续要求 victim allocation 完全不变，避免真实故障注入被误报为普通失败。
- **RapidOCR PP-OCRv6 不再在 RTX 3090 上静默回退 CPU**. 镜像固定含非对称 padding 卷积修复的 cuDNN 9.10.2；部署验收在真实推理后重新检查三引擎九条 ORT session，任一 det/cls/rec provider 链降为 CPU 都会给出具体引擎与组件并拒绝受管声明，并以全池 priming 后的稳定 ORT/CUDA context 计量模型工作集回收。
- **Grounded-SAM2 双池卸载覆盖进程级 CUDA workspace**. image/video 全池清理会在已有 CUDA context 中同步并释放 cuBLAS workspace 与 allocator cache；实卡验收先执行一次双根真实推理和全卸载，以成熟 CUDA/cuDNN context 作为随后两轮工作集回收基线，避免把一次性 runtime 常驻误判成模型泄漏。
- **YOLO 全池卸载会释放进程级 cuBLAS workspace**. 受管清理在模型池对象归零后同步 CUDA、清除 PyTorch cuBLAS 工作区并释放 allocator cache，避免仍残留 32 MiB live allocation 而错误宣告显存已回收；验收器先完成一次真实卷积 priming 与全卸载，以成熟 CUDA/cuDNN context 作为两轮回收基线；tracker 的 `lap` 依赖同时烤入镜像，不再在首个视频请求中联网 AutoUpdate。
- **开发态 GPU collector 可以与普通应用账户形成真实权限隔离**. Compose 内的 Celery worker 新增独立可覆盖的数据库连接串，不再被硬编码的 schema owner 账户锁死；当前部署可以让 API/worker 使用无 membership/fence DELETE 的非特权角色，同时把最小 DELETE 权限只交给 `gpu.control` 的 collector 角色。
- **RapidOCR 部署验收能够在 3.9.0 镜像中完整输出证据**. 验收器改从标准 distribution metadata 读取版本，避免因上游包不暴露 `__version__` 而在 GPU 加载、卸载全部成功后误报失败。
- **GPU 部署验收证据保持为可直接校验的单一 JSON 文档**. 五个 Backend 的验收器现将第三方模型加载输出隔离到 stderr，避免进度、权重诊断或 provider 日志污染 stdout 中的严格证据。

## [0.23.19] - 2026-07-30

### Changed

- **Raster Mask WebGPU dense XOR 改用 word-scatter 构造 history patches**. Worker 先按 non-zero words 计算 changed summary，再以有界 byte spans 写入稳定 tile row-major patches，不再为每个 set bit 重算像素与 tile 坐标；benchmark-only selector 可在同一 bundle 单选旧 per-bit builder 做 A/B，生产请求默认只运行 word-scatter。诊断同步暴露 XOR word density、scan、allocation、scatter 与 touched tiles。固定上限 atomic sparse records 虽能把 canonical payload 压到约 32–35 KiB，但联合 readback + patch p95 未达到增量门，因此相关 shader binding、buffers、record protocol 与诊断未进入生产实现。

## [0.23.18] - 2026-07-30

### Changed

- **Raster Mask WebGPU 候选复用有界 immutable packed base cache**. Worker 按 session 惰性缓存 canonical RLE 的 512² packed base tiles，以 word span 组装 ROI scratch，再用 dirty packed overrides 做可 set / clear 的 masked overwrite；cache、scratch 与 GPU buffers 共用 compute budget，预算不足或 cache 异常时继续使用 direct-RLE packed prepare。pool 诊断同步暴露 prepare strategy、RLE scan、cache fill / assemble / overlay、hit / miss / evict 与资源 plateau，release / replacement / dispose 后归零；默认构建仍不包含 provider、shader 或 adapter 请求。

## [0.23.17] - 2026-07-30

### Changed

- **Raster Mask WebGPU 候选改用 packed 输入与 core XOR 回读**. Worker 在 GPU ready 后直接从 immutable base RLE 与 dirty packed overrides 构造 row-aligned source，不再生成整 ROI alpha 或再次逐像素 bit-pack；shader 只回读 core XOR words，Worker 按 non-zero words 生成既有 tile history patches，避免 core-wide before / after diff。GPU 未 ready 或运行失败仍惰性使用完整 CPU morphology，默认构建继续零 adapter 请求；分段指标现在区分 prepare、upload / submit、readback、patch、fallback materialize 与三类 buffer 容量。

### Fixed

- **开启 Raster Mask WebGPU gate 的前端可以生成 production bundle**. Vite 现在按现有 `type: module` 合同输出 ES module Worker，使 Worker 内懒加载的 provider 能安全 code-split；默认关闭构建仍不包含 provider chunk 或 adapter 请求。

## [0.23.16] - 2026-07-30

### Added

- **大画布 Raster Mask morphology 改用持久客户端 Worker 会话，并提供默认关闭的 WebGPU 候选后端**. Sparse tile 现在同时维护受预算约束的 packed 当前真值，方形 / 圆形核的膨胀、腐蚀、开闭运算由 Worker 从 immutable base RLE 与 dirty overrides 精确重建 ROI，只回传可直接应用和撤销的 XOR tile patches；4K core tile 解码采用有界并发，不再填满固定 Worker 队列。实验构建仅在客户端浏览器 adapter ready、ROI 至少 `2048²`、操作为 square dilation 且字节预算允许时使用单 owner WebGPU provider，初始化中、无 adapter、预算不足、device lost、运行错误和不支持操作均在同一 Worker 精确回退 CPU。默认构建不加载 provider、不请求 adapter，切题或卸载会释放 session、Worker、device 与 buffer。

### Changed

- **核心文档图可以下载后继续编辑**. 系统全景、JWT 注销、视频 Chunk、Batch/Task 生命周期、开发与生产基础设施、部署演进、生产网络与持久化边界、审计通知、邀请注册、标注任务主链、AI 预标注与持久化作业、实时通知、视频追踪人机闭环、在线派题与 Task Lock、派生状态传播、Project 状态约定、异步导出交付和反馈双写对账，以及 Project、Batch、Task、Annotation、Review 模块全景改用内嵌 Excalidraw scene 与手写字体的 SVG；重复状态图、预标数据流、生产网络边界、通知可靠性边界、追踪审阅闭环、派题加锁和派生字段传播共享 canonical 资产，文档站仍提供点击放大和可编辑源文件下载入口。迁移验收同时按当前 Compose、API 与前端调用链修正 worker、监控、邀请、任务提交、服务池绑定与物理实例路由、Celery / AsyncJob ID 边界、预标可见性、工作台取题、标注计数回写、审核副作用、生产端口绑定、对象存储的双网络视角、Redis 恢复风险、通知事务窗口与专用重连、视频追踪局部审阅和取消后部分候选、scheduler 候选窗口与 TOCTOU、过期锁复用、自定义 TTL、Project 状态非受控写入、Project 计数直接扫描 Task、导出预检非执行快照、导出提交后派发与工件补偿，以及反馈对账的分组计数差额等文档漂移。全仓验收明确保留频繁随协议变更的 Tracker 事件状态 Mermaid 和 `docs/plans/**` 中的历史决策快照，并修正截图基建、WebCodecs Epic 与模型市场计划的完成状态漂移。

## [0.23.15] - 2026-07-25

### Added

- **视频工作台恢复 WebCodecs 精确帧解码并接入 Konva**. 开启「WebCodecs 精确解码」实验开关(刷新生效)后,暂停、逐帧与稳定 seek 会用浏览器原生 `VideoDecoder` 解码目标帧所属 chunk,按 `VideoFrame.timestamp` 精确命中(B 帧素材不串帧),解出的位图作为画布底图与当前帧 JPEG 的统一显示来源;连续播放仍由隐藏 `<video>` 负责。codec 不支持、chunk 尚未就绪、缺 sample manifest / description、signed URL 过期或字节越界等都会安全回退到原生 `<video>` / 位图路径,不阻断标注。默认关闭,不影响现有行为。
- **视频 WebCodecs 精确帧改为有状态 GOP 会话与字节预算缓存**. 同一 GOP 内逐帧前进只继续解码尚未提交的帧(不再每次从关键帧重解整段 GOP,长 GOP 逐帧不再产生平方级重复解码),后退、跨 GOP、切任务或 codec 配置变化时确定性重建 decoder;已解码位图与 chunk 字节按内存预算而非对象数量淘汰(轻量 96/32 MiB、标准 256/96 MiB、激进 512/192 MiB),暂停态还会沿最近导航方向同 GOP 预取少量帧(标准 2 / 激进 4,播放态保持零额外请求),并暴露可区分 demux / decode / bitmap / cache 阶段的性能诊断。显示合同与失败回退不变,默认关闭。
- **视频工作台精确帧诊断接入全局快照与 BUG 反馈**. 暂停态精确帧解码的状态、来源、当前帧、所属 GOP / codec、fallback 原因与资源预算、计数现在写入 `window.__videoWorkbenchDiagnostics`(更新上限 5 Hz,状态与 fallback 转换立即写入,task 切换/卸载有界清理),BUG 报告自动附带经裁剪、不含签名 URL / 字节 / 描述的诊断快照,便于排障;诊断只暴露枚举与数值,不触发界面重渲染。
- **E2E 确定性 WebCodecs 视频素材与 seed 端点**. 新增仅隔离测试库使用的 seed 端点,用 numpy 生成每帧可机器识别(背景分组亮度 + 四角 bit 编码帧号低位 + 中心场景色)的 H.264 素材,经 ffmpeg 编码成 baseline / 主 profile B 帧 / 短 GOP / 变帧率矩阵,复用生产 ffprobe 与 avcC 管线产出与真实 worker 同结构的 chunk samples 与 codec description;pending→ready 由确定性 test-only 端点切换(不依赖媒体 Celery worker),unsupported / malformed 场景在真实编码上确定性篡改 metadata,全局 cleanup 一并清理 chunk 行与 MinIO 对象。
- **WebCodecs 精确帧 E2E 与可观察属性**. 视频舞台容器暴露 data-video-frame-source / data-video-precise-state / data-video-frame-index 可观察属性;新增 Playwright spec 用确定性 H.264 fixture 覆盖 flag off 零 precise 请求、flag on 精确解码或安全回退、pending→ready 浏览器轮询，并从 Konva media canvas 采样 key / P / B / GOP / VFR 目标帧像素；普通 headless 环境缺少解码能力时明确记录 capability skip，严格 GPU 资格模式不允许用 skip 或回退代替像素证据。
- **WebCodecs 精确帧真实性能基准与 Worker 决策门**. video-bench 的 precise-frame 场景现在必须驱动三组真实视频任务，核验分辨率 / fps / codec / chunk / GOP 后采集逐操作延迟、可迁移同步 slice、long task、flag-on/off 逐帧 rAF、播放 rAF 与 decoder / VideoFrame / 字节账本；矩阵缺失、能力降级、fallback、资源越界或样本不足会明确标为 `inconclusive`，严格资格模式会非零退出，不再把静态预算表写成“不引入 Dedicated Worker”的测量证据。

### Changed

- **WebCodecs 精确帧按客户端能力作为默认关闭的实验功能发布**. Linux 服务端继续只提供 demux metadata 与 chunk bytes，实际解码和后续 GPU 处理使用运行网页的客户端资源；没有硬解 profile 的客户端会使用软件解码或安全回退。客户端硬解、跨浏览器 1080p/4K 性能与默认开启仍需独立资格验证，不把服务端 GPU 或浏览器 GPU 合成误记为视频硬解。
- **Mask 画布反馈与编辑工具条统一到其它标注工具**. 图片和视频 Mask 使用类别色、真实像素轮廓选中态与统一的画布标签，普通、选中和编辑态分别复用通用填充透明度设置，不再保留独立 Mask 覆盖透明度入口；详情卡补充画布尺寸、RLE 编码段和存储信息。视频渲染改用前景裁剪位图以减少空白区域的显存占用，编辑工具条同步采用工作台的紧凑字号、按钮和图标规格；原“淡化透明度”也明确命名为仅作用于重复 AI 候选。
- **全仓格式化改为可复现双层门禁**. 第一方 Python 统一由固定版 Ruff 检查和格式化，前端、文档与配置文件统一由 Prettier 管理；CI 先执行全仓只读格式与静态检查，再以 manual 阶段复核 pre-commit 全文件行为，不再修改分支并自动提交局部 API 修复。pre-commit 与根命令使用相同边界并明确排除 vendor、生成物和锁文件。
- **生成物更新补齐本地自动刷新与 CI 只读阻断**. 共享协议 schema 变更现在会触发 OpenAPI 快照重导；API 路由索引与快捷键、工作台设置生成页共用 pre-commit 自动暂存和 `check:codegen` 一致性检查，路由源码也会直接触发文档校验工作流。

### Fixed

- **WebCodecs B 帧增量解码、总字节预算与 GPU 基准不再产生假结论**. Chromium 需要额外输入才能排空重排队列时，会把 lookahead 已输出的未来帧异步转成 bitmap 交给既有 LRU，后续相邻帧不再因目标已被关闭而反复从关键帧 reset；后台预取不再重置前台 session，快速连续 seek 的旧媒体事件也不会把画面回滚。decoder 优先请求硬件加速并在该偏好不受支持时安全重试；已缓存目标可先于原生 seek 结算绘制。活动、待显示、退休与缓存 bitmap 共同受性能档位总预算约束。精确帧基准改用 manifest 真实末帧、确定性随机目标、时间轴百分比坐标与实际 Konva draw 截断可见延迟，分段记录 queue / codec / bitmap / paint；严格模式核验真实硬解 profile，不再把 GPU 合成当作硬件视频解码。基准同时修正折叠态播放按钮语义、无物理输出 GPU runner 的 1 Hz 帧调度、快速 scrub 的 React 事件时序、播放请求计数边界，并让 warm 延迟门真实参与严格结论。
- **Mask 原子操作冲突后可以直接恢复，Tracker 人工帧可确认覆盖**. 实例范围变化导致提交冲突时，
  “刷新范围”在错误态仍可使用，不再因编辑权限收紧形成恢复死锁；视频追踪候选包含受保护的人工
  关键帧时会在服务端拒绝后弹出二次确认，并按用户选择重新提交覆盖。
- **原生 Mask 采纳记录不能再被旧预测接口重复采纳**. 交互式采纳生成的模型溯源快照会在服务层被旧预测采纳入口拒绝，不再允许用响应中的 Prediction ID 再创建一份重复标注。
- **图片 Mask 取消后回到选择工具**. 按 `Esc` 或点击编辑工具条的取消按钮会丢弃当前缓冲并切回
  选择工具，不再意外进入矩形框工具；区域操作预览仍按第一次 `Esc` 仅取消预览的分层规则处理。
- **Mask 像素光标与已存标注加载更加稳定**. 图片笔刷光标改为直接更新画布节点，只在进出图片
  边界时触发界面状态更新；光标离开图片会立即恢复系统光标，滚轮可在图片和视频画面内直接调节
  半径。任务级 Mask Worker 不再被开发环境的严格模式模拟卸载提前销毁，已存 Mask 不会因此偶发
  显示“图像构建失败”。
- **视频单帧 Mask 与 Mask 轨迹恢复为两个独立工具**. `M` 创建只属于当前帧、归入“人工”
  分组的 `video_mask`；工具栏重新提供跨帧 `video_track_mask`，其关键帧只出现在 Mask
  轨迹分组，不再把“单帧”按钮实际落成轨迹。
- **标注详情中的“AI 待审”和“人工”分组标题保持常驻**. 即使当前分组为空，标题与 `0`
  计数仍会保留，不再因采纳或删除最后一个对象而让分组入口消失。
- **图片与视频工作台的多工具类别流不再串到矩形框**. 已有标注改类和属性编辑会按对象自身的
  工具单位读取配置；多边形、折线、旋转框、关键点与新建 Mask 完成几何后统一弹出对应类别，
  不再直接套用推荐类别。视频工具栏补回单帧 Mask，并与图片工作台共用 AI / Mask 图标语义。
- **远程 HTTP 下标注转换与 Mask 操作不再因 UUID API 缺失失败**. 转换、视频 Mask 剪贴板、
  拆分和原子操作统一使用兼容 ID 生成器，非安全上下文也能生成合法幂等键和轨迹 ID。
- **已存 Mask 的偶发空白与“图像构建失败”可自动恢复**. 位图创建失败时降级到 Canvas2D，
  Worker 瞬时失败会在替换后自动重试一次，不再要求刷新整页。
- **删除交互式 Mask 标注后不再冒出幽灵 AI 待审**. 交互候选采纳时保留的模型溯源快照
  现在明确标记为已决策记录，并从工作台与数据管理的待审统计中排除；已有快照会随迁移
  自动修正。
- **采纳原生 Mask 后可立即继续创建下一个对象**. 新建候选落库后不再自动选中并误入上一对象
  的 Mask 精修模式；SAM3 也会按模型实际低分辨率输入尺寸适配 Mask prompt，避免连续操作
  触发张量尺寸不一致的 502。
- **远程 HTTP 工作台可以采纳原生 Mask 候选**. 非安全上下文缺少 `crypto.randomUUID`
  时，备用幂等键现在始终满足服务端长度约束；请求校验失败也会直接显示具体字段与原因，
  不再只提示 `Unprocessable Entity`。
- **原生 Mask 大批候选不再拖慢画布交互**. 原生候选使用轻量 polygon 轮廓完成全量动态
  预览、缩放与 `Tab` 高亮，只为当前候选解码像素层；后端 RLE 编码改为向量化实现，避免
  Exemplar 多实例结果逐像素占用 CPU，同时落库仍保持未经转换的原始 Mask。
- **原生 Mask AI 多候选可完整预览并正常采纳**. 候选确认不再复用其他工具单位的过期类别，
  会从 `region` 类别中选择合法默认值；大量 RLE 候选会立即显示稳定外接边界，像素预览按资源预算
  异步填充，使用 `Tab` 切换时不再出现候选临时冒出后消失。
- **ML Backend 能力升级后可安全恢复接流**. 服务池成员因 `/setup` 能力指纹变化被自动禁用后，
  超级管理员现在可以先审核旧/新指纹及字段差异，再通过重新探活和候选指纹复核接受新基线；
  成员恢复、服务池启用、路由代际和审计记录原子提交，不再只能长期保持“路由阻塞”。
- **E2E 固定数据不再残留到开发库**. 本地 Playwright 现在幂等准备
  `annotation_e2e`，并自启专用 `3001/8010` 服务，不再静默复用开发环境；
  正常结束时的全局 cleanup 会收敛 fixture，截图与视觉回归也改用
  `annotation_screenshots_test`。

### Security

- **测试 seed 路由改为显式授权**. Seed、login 与 cleanup 端点只在
  `E2E_SEED_ENABLED=true` 且当前数据库名以 `_e2e` 或 `_test` 结尾时可用；
  production 始终不挂载这组路由，避免开发或 staging 配置被误用为测试数据入口。

## [0.23.11] - 2026-07-23

### Added

- **Mask 修订账本与质量内核**. Raster / Video Mask 的几何变更现在会在同一数据库事务中
  保留不可变前置版本，为版本对比、冲突安全修复和回滚提供真值依据；新的稀疏 RLE
  质量内核以前景 8 连通 / 背景 4 连通计算组件、孔洞、边界、重叠、桥接、边界噪声与
  时序漂移，大画布只物化 tile 与 halo，不创建全帧 alpha / RGBA。
- **异步 Mask 质检与持久问题**. 项目可保存带 revision 的质检阈值，并按项目、
  任务或标注范围发起 single-flight 扫描；质检运行、进度和去重 issue 都有持久记录，
  支持分页筛选、取消、解决、放弃修复与过期识别。
- **Mask 质检审阅与像素对比**. 审核工作台新增独立质检页签，可按状态、严重级别与规则
  在当前任务或整个项目范围分页导航问题，原子定位图片区域或视频帧，并将当前 Mask 与上一版本、
  精确选定的 Tracker / AI 候选或邻近关键帧做叠加、边界、XOR、新增和移除对比。区域评论可按
  不可变摘要和 Tracker 实例身份重放；对比期间冻结未提交 Mask 编辑层，大图使用基于
  RLE 区间的有界 LOD 分块，不建立整图 RGBA。
- **Tracker 候选区域决定**. 视频 Mask 质检可对精确单帧问题区域接受或拒绝 Tracker 差异，
  区域外、其它帧和其它实例保持不变；未决像素继续保留为带新摘要的 staged candidate。
  区域决定写入独立 reviewed scope 账本，记录审核员、来源任务、版本、帧、区域和候选证据。
- **可审计的 Mask 批量修复**. 质检问题可先冻结精确像素、版本、范围与分片进行 dry-run，
  再异步删除小孤岛、填充小孔洞或解决同类重叠；失败分片可续跑，修复后未被再次修改的对象可在保留期内冲突安全地回滚。
  锁定、已审、人工关键帧与版本冲突都作为逐条跳过或失败证据，SAM / Tracker 重跑只产生待审候选。
- **Mask 格式 adapter 与预检合同**. 导入、导出格式由带 adapter / manifest 版本的统一 registry 声明，
  预检返回逐任务的无损、有损或不支持结论、稳定损失码与对象 / 文件 / 字节估算。
  导入使用短时收据绑定 staged object SHA-256、mapping、options 与 plan digest，并按任务原子执行、保留可续跑结果。
- **图片 Mask 格式双向闭环**. COCO 现接受 polygon、uncompressed 与 compressed RLE，并以标准
  compressed RLE 导出；新增 Label Studio BrushLabels、逐实例 Binary PNG、Indexed PNG 和 YOLO Segmentation
  标注导入 / 导出，使用真实下游 consumer 验证像素、类别、实例 ID 与有损报告。
- **视频 Mask 格式双向闭环**. COCO Frames 与 DAVIS 现支持导入，YouTube-VOS 和 MOTS 支持导入 / 导出；
  track、类别、源帧、outside 与 occluded 语义通过显式 manifest 和映射保留。COCO Frames / MOTS 使用
  标准 compressed RLE，稀疏帧、帧号基准和 palette 重叠都必须选择明确策略并进入预检报告。

### Changed

- **图片原生 Mask 编辑正式默认开启**. 新建和既有项目现在默认允许原生 Raster Mask 写入，
  项目管理员仍可按项目关闭；部署创建总闸继续优先于项目选择，可紧急将所有项目切为只读。
- **审阅接入 Mask 质检证据**. 提交任务后自动排队当前 Mask 扫描，阻断配置下必须拥有
  与当前标注及配置一致的完成证据且无未解决 blocker 才能通过；非阻断模式保留
  警告、质检摘要与审阅备注。调度失败会明确标记两本账本，但不回滚已成功的提交。
- **Tracker 审阅认领语义**. 任务进入 review 后，已认领审核员可恢复并决定原标注员创建的
  待审 Tracker 候选；completed 任务、未认领用户和冲突中的有效分段租约仍会被拒绝。
- **导出先预检再入队**. 导出弹窗现在先显示格式损失报告；无损计划直接入队，有损计划必须二次确认，
  含不支持项的计划不可执行。缓存键同步绑定 adapter / manifest 版本与 options digest，相同未命中请求合并为一次构建。
- **Mask 标注导入按项目 adapter 能力开放**. Dashboard 不再依赖编译期隐藏开关，只展示后端
  registry 中已验证且适配当前媒体类型的格式；未知类别需映射并重新预检，有损项需显式确认。
- **Video JSON 明确标识不可移植媒体引用**. 该格式继续适合平台内轨迹检查，但导出预检会报告
  非可移植媒体引用；需要跨实例无损迁移时应选择 AAP JSON。

### Fixed

- **Mask prompt 源内容冲突返回精确原因**. refine 收据绑定的源 Mask 像素已变化时，现在优先返回
  `mask_prompt_source_changed`，不再被通用 annotation 版本冲突提前覆盖。

### Security

- **Mask 质检权限与旧结果隔离**. 项目级列表只返回当前审核员可见批次中的任务，审阅操作
  在行锁下复核可见性与 claim owner；标注版本、活性或配置改变后，旧 issue 立即变为
  只读 stale，不再参与阻断、告警接受或状态修改。
- **Mask 对比内容授权**. 当前、历史、Tracker 候选和质检区域内容只通过授权定位程序读取，
  API Key 必须具有 `annotations:read`；已逻辑到期或摘要不匹配的不可变内容不会在清理窗口内继续泄露。
- **Mask 质检评论防陈旧**. 区域评论提交时会在服务端核对 issue、task、annotation、frame、region
  与当前标注版本，已过期或锚点被篡改的请求不会写入。
- **区域决定冲突隔离**. Tracker 区域决定在同一事务内锁定 job、task、源标注、issue 与当前
  reviewed scope，并复核 manual keyframe、annotation / segment lock、候选摘要和源版本；任一冲突
  都会整组失败，普通用户不能通过 override 参数覆盖人工关键帧。
- **修复收据与回滚隔离**. 服务端只持久化短生命收据的摘要，执行和回滚均绑定 canonical digest、当前可见性与对象版本；
  超时、篡改或人工新改后的批次不会覆盖当前真值。
- **安全 archive 与格式资源边界**. 数据集 ZIP 与格式 adapter 共用安全 reader，拒绝路径穿越、绝对路径、
  重复规范化路径、大小写折叠冲突、symlink、过高压缩比和悬空 manifest 引用；PNG 同时校验 magic、位深与尺寸。
  导入与导出按实际流式字节、单 entry 和文件数持续执行可调配配额，失败时清理本地临时产物。

## [0.23.10] - 2026-07-22

### Added

- **8K 图片 Mask 分块编辑**. 图片 Mask 最大支持 8192 像素单边与 67,108,864 总像素；
  任一边超过 4096 或总像素超过 16,777,216 时，工作台自动使用稀疏 tile 后端，保留
  笔刷、橡皮、套索加减、撤销重做、保存刷新与当前视口 ROI 形态学，不分配整图 alpha 或 canvas。

### Changed

- **Mask 显示缓存硬预算**. 工作台按设备内存使用 Low / Standard / High 缓存与下载并发档位，在插入前执行
  retained bytes 准入并优先保护正在编辑或选中的对象；同一内容摘要的并发读取合并为一次请求。无法准入的
  对象进入可重试的延后状态，单个超大对象改用受限 bitmap 预览并继续按原始 RLE 做精确像素命中，避免
  active 对象绕过预算持续增长。
- **Mask 计算复用 Worker 池**. 同一任务的内容分析、高级编辑和实例操作共享按设备分档的固定 Worker，
  COCO RLE counts 改为 `Uint32Array` transferable；编辑、选中、当前和预取任务按优先级进入有界队列，
  取消、超时或单 Worker 崩溃只替换对应 slot，并在切题或离开工作台时释放全部 Worker 与会话索引。
- **Mask XOR 分块历史**. 笔刷、橡皮和已确认操作改为保留 512 像素 tile 的 1-bit XOR patch，
  笔画期间仅捕获首次触及 tile 的临时基线，不再为每次编辑生成 before / after RLE。撤销与重做
  共用同一 patch，最多保留 100 条并同时受 16 / 32 / 64 MiB 设备档位硬预算约束。
- **Mask 稀疏 tile 编辑核心**. 大画布真值由不可变 base RLE 与按需解码的 512 像素 override tile 组成；
  brush、erase、lasso、精确命中与 XOR history 均只读写相交 tile。viewport 只 pin 可见区及一圈预取，
  全图缩放使用受限 overview；保存在 Worker 中合并 dirty tile 与未访问 base 区间，不物化整图 alpha。
- **Mask 媒体边界与全图降级**. 图片持久化边界与视频、交互式 AI 的 4096 / 16,777,216
  边界分离；超出 dense 预算的 mutation、conversion、组件、孔洞与全图扫描工具会在分配前以
  `large_mask_full_scan_required` 明确拒绝。当可见 tile 无法进入设备硬预算时，工作台保留只读预览与未丢失草稿的重试路径。

## [0.23.9] - 2026-07-22

### Added

- **Mask 高级像素操作内核**. 图片与视频共用的二值 Buffer 现具备圆形 / 方形硬边写入、像素中心
  polygon 加减、4 / 8 邻域 flood fill、可命中的连通域 / hole membership，以及方形 / 圆盘 kernel
  的膨胀、腐蚀、开闭运算；所有操作返回统一的面积、拓扑、变化像素与脏区报告。
- **Mask 区域加减工作流**. 图片与视频像素编辑器新增套索添加 / 减去、4 / 8 邻域区域填充和圆形 /
  方形笔头；区域操作先显示变化像素与橙色预览，确认后才作为单步历史写入。大画布计算转入可取消的
  Worker，会话或来源版本已变化时丢弃迟到结果。
- **Mask 组件、孔洞与形态学编辑**. 高级菜单可按真实像素 membership 保留 / 删除组件、填充单个或
  批量孔洞、按面积去毛刺，并以圆盘 / 方形 kernel 执行膨胀、腐蚀、开闭运算和边界平滑；预览统一展示
  面积与拓扑前后指标，空结果需要二次确认。组件复制、拆分和多 Mask 合并复用不落库的实例计划模型。
- **Mask 实例原子操作**. 新增任务级原子 mutation 端点与 operation / lineage 账本，图片和视频可在
  一个事务内复制、拆分、合并 Mask，或执行同类 / 全类严格非重叠；范围、版本、任务 / 标注 / 分段锁、
  类别、内容引用和实际 RLE 像素代数均在服务端统一复核，任一冲突都不会部分落库。图片合并可选择替换或保留来源；视频合并仅创建当前帧副本，不删除源轨迹。
- **视频 Mask 关键帧生产力**. 选中卡、右键菜单和快捷键补齐可见关键帧导航、当前解析 Mask 复制、同轨草稿 / 新轨预览粘贴、关键帧删除、manual outside / held 恢复和当前组件拆轨；新轨粘贴和拆轨仅创建当前人工关键帧。
- **标注转换中心**. 图片与视频的 polygon、Mask 和紧致 bbox 转换统一为带逐对象损失报告的 dry-run / token / execute 工作流；支持同类型批量 copy / replace、视频 current-frame / keyframes 与显式 held 物化。预览不写 Mask 内容或占用配额，执行时以版本摘要、报告重算、幂等 operation、lineage 和单事务提交保证冲突时零部分写入。

### Changed

- **实例预览保留与重算**. 蓝色实例预览现在冻结生成时的范围与版本；冲突或网络失败保留 Buffer、选择和
  幂等键，只有用户选择「刷新范围」时才基于最新 Mask 重算。恢复动作按错误类型收窄，删除图片实例前显示二次确认；视频 Mask 轨迹清单也支持 `Shift` 多选合并。
- **Mask 帧状态来源保真**. 撤销 / 重做保留关键帧的 manual / prediction 来源、遮挡和属性；manual 与 prediction `outside` 区间分别归并，人工恢复不再改写预测区间。

### Fixed

- **Mask 高级预览与多选合并可达性**. 选择 8 邻域时，预览中的组件前后数量现在按同一邻域统计，
  不再显示实际合并但报告仍按 4 邻域计算的矛盾结果；从多选对象进入 Mask 编辑也会保留选择集合，
  「合并已选 Mask」不再因入口把多选收敛成单选而保持禁用。
- **Mask 原子提交安全边界**. 上传到提交结束期间现在统一阻止取消、切题和切 batch，预览后新锁定的受影响视频轨迹也会在提交前再次拒绝，避免用户已丢弃界面稿件但服务端仍落库。
- **Mask 内容锁序与计算预算**. 普通写入、视频单帧保存、内容上传与原子 mutation 统一 Task / RLE / upload / annotation 锁序；GC 先提交可恢复的数据库删除，再重新取得同键锁并复查引用和新上传 reservation 后删除对象。范围、派生 runs、累计代数步数和非重叠候选对均有硬上限，copy / split 会按指定的 4 / 8 连通性复核完整连通域。
- **视频 Mask 帧操作冲突边界**. 保存、删除、outside 与 held 恢复统一复核 task / annotation / segment 锁和 `If-Match`；删除最后一个关键帧、恢复纯预测 outside、过期版本和范围变化都会稳定拒绝，不再由通用 geometry PATCH 绕过。

## [0.23.8] - 2026-07-22

### Added

- **原生 Mask AI 交互协议地基**. 扩展 ML capability 受控词表与共享协议包，冻结原生 COCO RLE
  候选、Mask prompt、正负 scribble、视频纠错帧、空结果诊断和显式 fallback lineage；Tracker
  同时按真实输入声明 `video`，未实现的 Mask 交互能力继续保持不声明。
- **交互模型原生 RLE 候选**. Grounded-SAM2 和 SAM3 image 的点、框与多候选路径可显式
  返回原分辨率 COCO RLE，hole、孤岛和多连通区不再经过 polygon 简化；旧请求继续返回 polygon。
- **SAM3 PVS Mask 纠错种子**. 视频交互 Tracker 可校验并解码受控内联 RLE，在准确的窗内帧调用
  `add_new_mask`；能力目录将 Multiplex 与 PVS 拆分为独立 model 条目。
- **原生 Mask 候选预览与原子采纳**. 图片和视频单帧候选复用共享 Raster renderer、字节预算与
  alpha picking；任务级采纳接口在一个事务内创建 Prediction、lineage、decision 和 Annotation，
  视频结果直接成为当前帧 `video_track_mask` 关键帧。
- **原生候选幂等账本**. 数据库迁移新增 24 小时接受 decision，用任务与客户端 key 保证响应丢失后
  重试只产生一次标注变更；有效快照在生命周期内参与 Mask 引用扫描，过期后由清理任务回收。
- **已存 Mask 多轮 AI 精修**. 图片工作台可在选中的原生 Mask 上交替追加正负点、框和笔迹，
  接受候选后原位更新同一 annotation；Grounded-SAM2 与 SAM3 共享 Mask / scribble adapter。
- **视频追踪候选局部审核**. 审阅条可按目标与帧窗口接受或拒绝候选，未决窗口继续保留并可在
  刷新后恢复；全部候选决定后才结束审核，新发现实例在分批接受时保持同一轨迹映射。
- **视频 Mask 纠错与定向重传播**. 当前帧可先以人工 RLE 关键帧保存，再选择向前、向后或双向窗口
  生成待审候选；Grounded-SAM2 与 SAM3 PVS 消费原生 Mask seed，SAM3 Multiplex 只在用户明示确认后使用 bbox fallback。
- **Mask AI 发布可观测性**. 新增低基数操作与阶段耗时、纠错 job / staged 引用 / 幂等决定库存指标，
  Prometheus 告警覆盖失败率、冲突率、纠错排队与待审积压；平台和 ML Backend Grafana 面板可分别
  定位 upload / inference / decode / encode / commit 与 grounded-SAM2、SAM3 Multiplex / PVS 推理。
- **原生 Mask AI 生命周期决策（ADR-0053）**. 冻结瞬态候选、加密 logits 令牌、服务端原子接受、
  Tracker 局部决定、人工纠错关键帧、定向重传播与 staged 引用 TTL 的统一边界。

### Changed

- **交互候选代理返回路由 lineage**. 图片与视频单帧响应补充请求 backend、实际实例、
  服务池、目标 model 与模型版本，为后续原子接受提供可追溯输入。
- **图片 Mask 部署写能力默认开启**. reader / exporter / 浏览器退出矩阵通过后，部署总闸改为默认
  开启；项目级原生编辑 opt-in 仍默认关闭，总闸继续作为紧急 kill switch。
- **视频追踪人工帧保护**. 局部接受默认跳闸而不是覆盖人工关键帧；用户显式二次确认后才可覆盖，
  窗口外关键帧、其它目标与未决候选保持不变。
- **纠错路由与窗口冻结**. 纠错作业绑定精确 backend、model、segment lease、源版本与 RLE 摘要，
  并使用平台与 backend 能力的较小单窗上限；同轨迹仅允许一个活跃纠错作业。

### Fixed

- **SAM3 Tracker Mask 像素与空帧保真**. Multiplex 的原生 Mask 输出不再做形态学开运算或丢弃
  小连通区，无目标帧返回尺寸正确的全背景 RLE 与 `outside=true`，不再误报 bbox。
- **原生候选失败恢复**. 网络错误、版本冲突或服务端失败不再提前清空候选、prompt 与幂等键；
  成功响应才消费候选，取消、切题、切帧、切模型、切输出类型和 TTL 到期会释放会话缓存。
- **多轮 prompt 失败恢复**. 交互请求失败时保留已存 Mask、候选和本轮正负输入，工具栏可按原始
  payload 重试；成功空结果才结束上一轮候选，避免瞬时网络故障中断精修。
- **纠错作业失败恢复**. 人工关键帧保存后入队失败会释放活跃作业租约；可重试错误只重建作业，
  不重复保存关键帧。WebSocket 断线后使用有界退避轮询，取消时立即清除候选并忽略迟到状态。
- **Tracker staged Mask 引用回收**. 待审或已取消的候选超过 24 小时后会清空 staged result 并释放
  内容引用与同轨纠错租约；待审 job 转为 discarded，已取消 job 保持取消状态，不再无限阻塞 GC。
- **HTTP 指标路由基数**. 请求计数与延迟现统一按 FastAPI 路由模板聚合，未知 API 归入固定
  `/api/unmatched`，不再为含 UUID 的真实 URL 创建无界时序。

### Security

- **原生 Mask 安全代理**. 平台按同一目标 model 同时检查 prompt 与输出能力，重建 prompt
  revision，校验候选 RLE、媒体尺寸、ID 与空结果诊断；单对象 4 MiB 和整体 16 MiB
  上限在读取 backend 响应流时执行，超限返回稳定 413 reason。
- **原生 Mask 采纳授权与血缘签名**. 接口复核任务可编辑状态、assignment、任务/标注锁、项目写闸、
  类别和源版本；签名 receipt 绑定像素、prompt 摘要、模型与历史路由，跨 actor 回放和同 key 异请求
  均稳定拒绝，普通日志与审计不记录 RLE counts。
- **Mask prompt 鉴权与短期 logits**. 浏览器只提交源 annotation ID 与版本；平台复核任务、帧、锁和
  版本后解析 RLE，并以绑定 actor、backend、model、prompt revision 和候选的短期加密鉴权令牌连接多轮
  推理。输入正文、解压结果、笔迹数量和点数均有上限，日志不记录 RLE 或 logits。
- **视频局部决策并发边界**. 每次接受或拒绝都在同一事务内复核 job revision、源轨迹版本、任务与
  assignment 状态、segment lease 和标注锁；重复同一决定幂等回放，冲突返回稳定 reason 并保留候选。
- **Mask AI 日志与指标隐私守卫**. 普通日志不再记录文本提示、RLE counts、scribble 点集、logits 或
  对象 key；指标对未知 label 强制归一化，HTTP path 只取静态路由模板，避免正文泄露和高基数放大。

## [0.23.7] - 2026-07-21

### Added

- **Raster Mask 内容可观测性**. 新增低基数的内容 load / store / verify 成功与错误计数、固定错误原因分类，
  并由健康巡检和保守 GC 精确刷新活跃图片 Mask 标注与预测 Gauge；指标不携带任务、对象或标注标识。
- **图片原生 RasterMaskGeometry schema**. 新增 `raster_mask` 几何类型，用于图片任务的栅格掩码标注。
  掩码内容通过 `CocoRleMaskRef` 引用存储在 S3 的不可变 COCO RLE 对象，与视频 `video_track_mask`
  共享内容层基础设施。
- **图片掩码静态内容 API**. 新增 `GET /annotations/{annotation_id}/mask-content` 端点，
  支持获取图片掩码的 COCO RLE 内容，带 ETag 支持条件请求（304 Not Modified）。
- **图片 Mask 项目级灰度能力**. 项目新增默认关闭的原生编辑 opt-in，工作台可通过
  `GET /tasks/{task_id}/mask-capabilities` 获取有效读写能力、稳定禁用原因与内容上限。
- **图片原生 Mask 工作台**. 已有 Mask 按 cropped alpha 渲染与像素命中，支持空白创建、RLE 重载再编辑、笔画撤销/重做、逐对象状态与定向重试。
- **Mask 显式双向转换**. 单对象 polygon / multi-polygon 与 Raster Mask 可原位互转，默认不简化，并在写入前展示面积、组件、孔洞、顶点和像素 XOR 损失报告。
- **Raster Mask 发布观测与浏览器矩阵**. Prometheus 告警与 Grafana 面板覆盖内容损坏、存储不可用和活跃几何指标缺失；独立的只读与原生写入 Playwright 矩阵固化 12 条发布退出门。

### Changed

- **共享掩码验证逻辑**. `validate_mask_geometry_for_task` 扩展支持 `raster_mask` 类型，
  验证图片掩码尺寸与数据集项匹配。
- **前端类型定义**. `Geometry` union 添加 `RasterMaskGeometry` 类型，`rasterMasksApi`
  拆分为 `annotationRasterMaskContent`（图片）和 `annotationVideoMaskContent`（视频）。
- **Mask 渲染加载核心**. 图片与视频复用 cropped alpha 分析和命中检测；图片加载器按对象
  隔离 loading / ready / error，并提供 Worker 解码分析、有界并发、定向重试、LRU 与 bitmap 释放。
- **Mask 缓存与性能预算**. 缓存从对象数上限改为 128 MiB 估算字节预算，并增加稀疏、密集、孔洞和三分量 1080p 基准，记录 decode / Worker analyze / bitmap / pipeline p95 与 20 Mask 稳态缓存字节。
- **数据库迁移 0135**. 为项目增加默认关闭的原生 Raster Mask 编辑开关；回滚会删除该列，已创建的 Raster Mask 内容仍保留，应优先采用 forward-fix。

### Fixed

- **Raster Mask 持久化门禁**. 预测结果写入与预测采纳现与标注创建共用同一个写入边界，
  在创建开关关闭或媒体、尺寸、前景、引用校验失败时，不再留下 Prediction / Annotation 行或提前关联上传对象。
- **Mask 转换并发与类型一致性**. 替换 raster 内容或转换 geometry 类型缺少 `If-Match`
  时返回 428，旧版本返回稳定 409；成功转换会同步 `annotation_type`，且仅允许同一
  `region` 工具内的 polygon / multi-polygon / raster Mask 互转。
- **图片 Mask 可移植导入导出**. AAP JSON 会把图片与视频引用的 RLE 正文统一写入
  `mask_objects`，导入先验证并重建不可变对象；COCO 图片导入识别 RLE segmentation，导出从
  实际像素计算 segmentation、bbox 与 area，不再把栅格 Mask 静默跳过或降级为 bbox。
- **图片 Mask 只读前端安全**. 原生像素渲染器上线前，工作台明确阻止 `raster_mask` 进入普通
  bbox 的移动、缩放和复制路径，避免只读引用被覆盖或复制成零尺寸框。
- **静态 Mask 条件读取合同**. 图片静态读取与兼容逐帧路径共享强类型响应、任务上下文尺寸校验
  和 `If-None-Match` 处理；命中内容摘要时返回 304，不再重复下载对象正文。
- **损坏 Mask 定向恢复**. 静态内容读取的 409 错误现返回稳定 `reason / retryable / message`，工作台保留健康兄弟对象并只重拉失败 Mask。
- **图片 Mask 上传与锁定边界**. 图片内容上传在保留对象和写入存储前先执行有效写闸，包括无数据集项关联的图片任务；已锁定 annotation 的 geometry PATCH 和删除均返回稳定冲突，不再依赖前端禁用。
- **点云相邻任务预取**. 无 DatasetItem 的点云任务现从 datasets 桶签发文件 URL，工作台也不再把 PCD 当图片预取，避免切入点云工作台时产生后台 404。

### Security

- **Mask 任务级授权与灰度门禁**. 图片和视频 Mask 内容读取统一执行批次状态与标注员分派校验，
  防止同项目跨任务读取；有效写能力同时受部署 read / create 开关、项目 opt-in 和
  `region` 工具绑定约束，直接写入、预测、采纳及 AAP / COCO 导入均无法绕过。

## [0.23.5] - 2026-07-21

### Added

- **栅格 Mask 可靠性与安全地基 (ADR-0052)**. 为图像 / 视频栅格 Mask 统一 Epic 的 Phase 1，
  冻结 v0.23.6 实施所需的全部共享边界：`raster_mask` 类型名、共享 `coco_rle_ref` schema、
  泛化静态 GET API、polygon ↔ Mask 显式无损 / 有损转换报告、gzip 传输契约、编辑会话状态机语义、
  JSONB 加法扩展部署顺序与 forward-fix 回滚限制。
- **图片 polygon 的 hole / multi_polygon 渲染**. `KonvaPolygon` 现使用 even-odd 填充渲染
  `holes` 与全部 `multi_polygon` 外环，不再只画单个外环；`maskToPolygon` 在多连通 / 含孔时
  显式标记 `lossy` 并阻止有损的 polygon 提交（提示等待原生 Mask 工作台），不再静默取最大环。
- **Mask 编辑会话状态机**. 新增 `useMaskEditorSession`，统一
  `idle → loading → ready → dirty → saving → error` 相位；`sessionId + generation`
  隔离过期 GET 回包；保存走单飞 Promise，失败
  保留 buffer / history 并可 retry。`canEditMask` 单一闸门同时检查 task 只读、annotation
  `is_locked`、轨迹 lock、segment lock 与编辑器相位，供 toolbar / 快捷键 / pointer / commit 复用。

### Changed

- 首页的 SAM3 与 OCR 演示统一使用高清 WebM 和独立 WebP 海报，OCR 录制中的 AI 面板改为停靠在主图右侧；Hero 图片卡扩大为主视觉，并以悬停显现的左右按钮取代底部播放条。
- 重整模型市场“运行时观测”的信息层级：服务池由宽表改为摘要卡，集中展示路由模式、可用实例、容量、资源和数据新鲜度；实例指标与维护操作在展开面板内分组，缺失指标不再淹没关键状态。
- 图片、视频和点云工作台的用户手册截图与流程录屏统一使用暗色主题，并移除已与当前交互不符的旧截图。

### Fixed

- 修复视频 Mask 选中时按 `Delete` 会误删整条轨迹的问题；现仅删除当前关键帧，整轨删除改为 `Ctrl/⌘+Delete` 或右键菜单（与 `video_track_bbox` 语义一致）。
- 修复图片 Mask 笔迹无 undo 历史的问题；`ImageStage` 现为每一笔接入 `beginStroke / endStroke`，与视频路径一致。
- 修复 Enter 在 Mask 无变化时仍物化 held keyframe 的问题；现要求 `dirty` 才提交。
- 修复锁定 / 只读对象经 Enter 提交、笔刷模式切换或视频 pointer 落笔仍可修改 mask 的问题；`canEditMask` 现接入图片 / 视频 pointer 入口、B/E 快捷键、MaskToolbar 与 `commitMaskAsPolygon` / `commitVideoMask` 提交边界，task 只读或 annotation `is_locked` 任一为真即拒绝。
- 修复首页 Hero 在首次打开或慢网络下同时请求所有大图，导致个别卡片轮播时短暂空白的问题；现仅挂载当前与下一张，并在切换前完成预加载和解码。
- 修复新注册 ML Backend 的 singleton 服务池未随项目启用而激活，以及批量、逐帧、重试、二次推理和同步预测绕过服务池路由的问题；这些请求现统一按池选择物理实例，并遵守 drain、跨进程并发和熔断门禁。
- 修复标注员进入图片工作台时误请求管理员专用类别频率接口、重复弹出权限告警的问题。
- 修复运行时观测把 `unloaded` 或不可信驻留数据计为已驻留，并在缺少实时探活时把缓存 `connected` 状态显示为健康的问题；服务池资源计数与实例健康徽标现明确区分实时、缓存、过期和未知数据。
- 修复服务池迁移误将预标注编排和用户 AI 偏好中的 registry id 改写为 pool id，导致前端无法按全局注册表恢复模型、参数和交互式 backend 选择。校正迁移恢复这些公共字段的物理实例身份，同时保留项目启用与请求溯源的服务池身份。
- 修复服务池能力指纹与真实 `models[]` 能力响应不一致、singleton 池缺少指纹以及健康检查后能力漂移仍可接流的问题；能力合同现会稳定排序、第一次探活建立指纹，漂移成员自动禁用。
- 修复路由 generation 与 Redis 账本可漂移、追踪任务忽略路由选中实例或拒绝结果、中途取消泄漏 lease 及 heartbeat 失败仍静默继续的问题。
- 修复缺失或过期的 inflight 数据被当作零而允许卸载或移除成员的问题。纳管实例的卸载、移除和物理删除现均要求 enforce 路由、draining 状态、新鲜账本和精确 `inflight=0`，Redis 不可用时失败关闭。
- 修复服务池成员 PUT 重复插入、API `PATCH` 丢失 `If-Match` 等额外 header、通用预热按钮错发 reload、GPU 静态超售告警无法触发，以及注册管理缺少服务池和成员增删改、权重编辑与实例联动筛选的问题。

### Security

- **Mask 内容 gzip 传输 + bounded decompress**. 上传正文继续使用 `coco_rle`，HTTP 压缩由
  `Content-Encoding: gzip` 表示，对象存储压缩由 `storage_encoding: gzip` 表示；引用保持
  `coco_rle_ref` 并使用 `.json.gz` 对象 key。流式 `zlib` 解压在压缩输入超过 8 MiB、
  解压输出超过 4 MiB 或膨胀比超过 20× 时立即拒绝，关闭 zip bomb 向量；SHA-256
  仍对未压缩 canonical bytes 计算，旧未压缩引用及历史混合编码继续可读。
- **交互式帧上传 size cap**. `predict-frame` 与 `interactive-annotating-frame` 现检查
  `Content-Length` 并流式累计字节，超过 32 MiB 返回 413；解码后校验宽高 ≤ 4096、总像素
  ≤ 16M、格式 ∈ {JPEG, PNG}。此前 `await frame.read()` 无任何上限。
- **Mask 内容上传配额**. `POST /tasks/{task_id}/mask-content` 现记录上传归属，并以任务级事务锁
  串行化配额预留；每个任务最多保留 256 个尚未被 annotation 事务认领的 mask 对象，GC 删除
  对象时同步清理归属，防止并发请求绕过计数或无限累积 orphan。
- **Tracker accept 并发冲突 → 409**. `accept_tracker_job` 现在创建 job 时记录全部源 annotation
  version，accept 时按稳定顺序重锁并复核任务、assignment、segment lease、源对象存活 / 锁定 /
  版本；任一漂移返回 409，旧 job 缺少快照时失败关闭，不再 last-writer-wins。accept 成功后清除
  staged 结果，GC 仅保留仍待审核或已取消且处于宽限期的对象。
- **对象存储 I/O 不阻塞 async event loop**. `store_coco_rle` / `load_coco_rle` 及 GC
  `delete_object` 的 boto3 同步调用现统一经 `asyncio.to_thread` 包裹，不再阻塞 FastAPI 事件循环。

## [0.23.4] - 2026-07-20

### Added

- **模型市场「注册管理」与「运行时观测」结构化重设计** (ADR-0051). 在 ADR-0050 的服务池 /
  实例 / GPU 三层之上定义观测面信息架构：注册管理拆成「服务池 / 实例 / GPU 资源 / 项目绑定」
  四个结构化视图 + 问题中心；运行时观测改为可展开的服务池树表，默认展示路由健康、容量与
  流量分布，实例详情下沉到 Sheet。前端不再按 URL join `/all` + `/overview` + `/observe`。
- **四条独立状态轴**: 连通/健康、路由 (configured → effective)、容量、驻留分别判定，不再合成
  单一「在线」徽标。每条轴的来源不可互推（`connected` 缓存不冒充实时 healthy，GPU queue 不
  等于路由 inflight，CPU compute 不代表 GPU 已释放）。
- **typed topology / runtime-snapshot 读模型**: 两个端点从 `-> dict` 升级为 Pydantic
  `response_model` (`TopologyResponse` / `RuntimeSnapshotResponse`)，OpenAPI snapshot 与
  generated TS 类型不再是 `unknown`。topology 新增派生 `routable_instances` / `status` /
  `status_reason_codes`；runtime-snapshot 新增 `observed_at` / `partial` / `partial_reason` /
  `sources[]` freshness 信封。
- **服务端角色裁剪收紧**: Project Admin 经 `topology` 拿到的响应中 `routing_policy="unknown"`、
  member `weight` / `state` / `last_checked_at` / `gpu_resource_id` 为 `None`（服务端裁剪，
  非前端隐藏）。`runtime-snapshot` / `/observe` / `/gpu-resources` 对 Project Admin 返回 403。
- **诊断去重合同**: 问题按 `code + subject_type + subject_id` 稳定去重；同一问题在问题中心
  只渲染一次主记录，受影响对象在 `affected_*_ids[]` 完整列出，资源 / 实例行只显示计数 + 跳转。
- **卸载安全门**: 实例维护走 drain → quiescent (inflight=0 AND 快照新鲜) → unload 顺序。
  `routable` 实例不可一键卸载；`router_mode != enforce` 时 draining 标记为「预配置未生效」。
- **纯 view-model 层** (`runtimeTopology.ts`): 把 topology + runtime snapshot 按 ID 合并为页面
  view model，保留 unknown / stale / partial，不做业务真值猜测；含可独立测试的派生、排序、
  筛选、诊断聚合与卸载门控函数。

### Changed

- `RegisteredBackendsTab.tsx` 与 `RuntimeObservePanel.tsx` 重写为编排 shell，详情渲染下沉到
  `registry/` (5 组件) 与 `runtime/` (10 组件) 子目录。原 `min-w-[980px]` 扁平宽表与实例
  卡片墙移除；窄屏保留核心列，次要字段进展开行 / Sheet。
- GPU 资源从大卡改为表格；静态声明超售与运行时实际占用拆成两根独立 Progress 条。
- 运行时观测刷新合并为单一按钮 + 自动刷新开关 + 「数据来源」展开区（显示各来源 updated_at /
  stale / error）；部分来源失败不抹掉其它可信数据。
- 未注册 env 容器独立归组，不授予 routable / weight / traffic 字段，也不自动并池。

### Fixed

- 缺失 / 陈旧路由指标不再回落为 `0` 或 `healthy`：metrics 字段（P95 / 错误率 / 最近选择 /
  选择 / 拒绝计数）在合同中保留为 `None`，前端统一渲染「暂无路由指标」。
- 健康快照陈旧时保留上次值 + stale 标记 + 时间，不沿用实时状态色；`runtime-snapshot`
  partial 时显示「N/M 来源新鲜」+ partial_reason，不整页替换为错误块。

## [0.23.3] - 2026-07-20

### Added

- **ML Backend 服务池与真实请求路由地基** (ADR-0050). 在全局实例注册表 (ADR-0044) 之上
  新增逻辑服务池层 (`ml_backend_service_pools` + `ml_backend_pool_members`), 把「项目请求一个
  逻辑能力」与「平台选择一个物理实例」拆成两个步骤。项目、pipeline、用户偏好以 pool id 为配置
  真值; 每个现有 registry 经 alembic 迁移自动得到一个 singleton 服务池, off mode 下行为与
  v0.23.2 完全一致。详见 `docs/adr/0050-ml-backend-service-pools-and-request-routing.md`。
- **跨进程原子路由 ledger** (Redis, namespace `ml-router:v1`, 独立于 GPU 仲裁 `gpu-arbiter:v1`):
  平滑加权轮询 (SWRR) + per-instance 并发上限 + 被动熔断 (仅 transport failure 触发) + route
  lease acquire/heartbeat/finish/cancel (原子 Lua, 幂等终态, crash TTL 回收)。
- **路由能力指纹** (SHA-256): 服务池成员加入前必须 exact match canonical 能力指纹 (排除
  URL/GPU/VRAM/residency 等运行态字段, 使等价副本可互换); 漂移自动 disabled。
- **Pool + instance 双 ID 溯源**: `Prediction` / `FailedPrediction` 新增 `ml_backend_pool_id`
  (requested pool); `AsyncJob.payload` 新增 `ml_backend_pool_id`; audit 日志记录双 ID。
  多阶段聚合的 stage-level lineage 存 `PredictionMeta.extra.pipeline`。
- **项目服务池 API**: `GET /projects/:id/ml-backends/pools/available`、
  `PUT /projects/:id/ml-backends/pools/:pool_id/enablement` (pool 级启用 + 变体覆盖)。
- **超管服务池管理 API**: pool/member CRUD + drain/resume
  (`/admin/ml-integrations/service-pools/*`), 含能力不匹配 409 结构化 diff。
- **读模型** (v0.23.4 前置): `GET /admin/ml-integrations/topology` (角色裁剪)、
  `GET /admin/ml-integrations/runtime-snapshot` (仅超管; router mode + inflight + circuit +
  health + GPU 摘要)。
- **路由指标**: `ml_backend_router_selections_total` / `_rejections_total` / `_ejections_total` /
  `_routed_request_duration_seconds` / `_inflight` (label 仅稳定 UUID + 受控 outcome)。
- **路由灰度开关**: `ML_BACKEND_ROUTER_MODE` (off / observe / enforce) + lease TTL / heartbeat /
  passive-failure-threshold / eject-seconds / health-max-age 环境变量。

### Changed

- `Project.ml_backend_id` → `ml_backend_pool_id` (项目主绑定改为服务池; 内部经 singleton pool
  的 `legacy_instance_id` 解析回原 registry 实例, off mode 行为不变; 公共 schema 仍接受
  `ml_backend_id` registry id 以兼容前端 / SDK, v0.23.4 完整池管理 UI 落地)。
- `project_ml_backend` 表 → `project_ml_backend_pool` (`registry_id` → `pool_id`); 迁移保留原
  关联行 id / enabled / default_variants / 时间戳。
- `MLBackendService` resolver 方法 (list_enabled_for_project / get_project_backend /
  get_tracker_backend_for_capabilities / set_enabled / delete) 经服务池层操作; registry 创建
  (admin / env auto-upsert) 自动建 singleton pool。
- 删除 registry 前须先清理服务池层 (成员移除 + legacy 清空 + pool disable), 满足 RESTRICT FK。
- The product, documentation site, PWA installs, browser tabs, and README now share the new AI Annotation Platform icon.

## [0.23.2] - 2026-07-17

### Changed

- 全部第一方代码（9 个生产文件、17 个测试文件、1 个校验脚本）不再从 `gpu_arbiter` facade 导入，改为直接导入 `gpu_arbitration` 下按职责划分的子模块。导出视频 logger namespace 从 `app.services.export_video` 迁至 `app.services.exporting.video`（事件名、level、字段不变）。新增永久 removed-module 扫描器、`.dockerignore` 与迁移清单。

### Removed

- 物理删除 23 个旧平铺 service 兼容 facade 模块（Data Manager 6、Video 3、Export 6、GPU ledger 1、GPU orchestration 7），它们在源树、生产镜像和干净 Python 进程中均不可导入。兼容测试转为永久 removed-module 负向守卫（`find_spec is None`、五种导入形式冷进程失败、package 属性缺失）。API、WebSocket、Celery、SQL、Redis/Lua、锁序与用户行为零变化；完整迁移表见 `docs/migration/2026-07-17-v0.23.2-service-import-cutover.md`。

## [0.23.1] - 2026-07-17

### Changed

- GPU 准入签名实现 `gpu_admission_signer.py` 迁入领域包 `app.services.gpu_arbitration.signing`，原路径降级为纯兼容 facade（对象 identity、签名与冷导入双向守卫不变）；第一方生产代码、测试与校验脚本改用新路径。属 GPU 编排领域化收口的第一步，行为零变化。
- GPU rollout 持久状态与决策实现 `gpu_arbiter_rollout.py` 迁入领域包 `app.services.gpu_arbitration.rollout_state`，原路径降级为纯兼容 facade；`ml_client`、admin ML 接口与 health worker 改用新路径。`rollout_state` 是 cycle-safe 叶模块（仅依赖 config 与 rollout DB 模型），行为零变化。
- GPU tombstone 收集器最小权限 DB 边界 `gpu_collector_database.py` 迁入领域包 `app.services.gpu_arbitration.collector_database`，原路径降级为纯兼容 facade；health worker 与校验测试改用新路径。`collector_database` 是独立基础设施叶模块，行为零变化。
- 将 GPU dispatch 失败记录与汇总（`gpu_arbiter_failure_record` / `summarize_gpu_arbiter_failures`）从 `gpu_arbiter.py` 抽入 `gpu_arbitration.contracts`，并将 durable fence 原语（fence 错误、会话工厂类型、membership 行锁、generation/control-epoch/token-expiry high-water 事务与公开 fence API）抽入新模块 `gpu_arbitration.fences`。`gpu_arbiter.py` 显式 re-export 全部迁出符号，第一方调用方（workers、dispatch/membership/rollout sibling、fence/dispatch contract 测试）改用新路径。行为、SQL 文本、锁序与对象 identity 零变化。
- 将 GPU proof schema、canonical/residency 解析器、runtime subject dataclass 与错误、generation 准备、token horizon、drain health 分类、cold/eviction/eviction-cancel terminal commit 以及共享 proof-domain 原语（`_snapshot_gpu_mode_backend`、`_lock_gpu_resource_proof_domain`、`_optional_datetime_document`、`_gpu_domain_members`）从 `gpu_arbiter.py` 抽入新模块 `gpu_arbitration.proofs`（~2900 行、73 个定义）。`gpu_arbiter.py` 显式 re-export 全部迁出符号，`gpu_dispatch_authority` 与 proof recovery 测试改用新路径；私有 monkeypatch target 改到 `proofs` 模块。行为零变化。
- 将 legacy ack 与 rollout control 准备（错误、dataclass、evidence 校验、membership 别名检查、endpoint canonicalization、boot-id 挑战绑定、reset/mode 准备）从 `gpu_arbiter.py` 抽入新模块 `gpu_arbitration.control_preparation`（~900 行、16 个定义）。`gpu_arbiter.py` 显式 re-export 全部迁出符号；`gpu_membership_activation` 与 `gpu_rollout_control` 改用新路径。`control_preparation` 依赖 contracts、fences、proofs，不依赖 ml_client 或高层编排。行为零变化。
- 将 proof 评估、proof reset、repair 与 runtime observation 从 `gpu_arbiter.py` 抽入 `gpu_arbitration.reconciliation`；将 retired live probe、tombstone GC collection 抽入 `gpu_arbitration.retirement`（并在模块顶层依赖 `ml_client`，消除原函数内 import）；将 unregistered shadow dispatch 日志、backend config status 与 resource summaries 抽入 `gpu_arbitration.diagnostics`。至此 `gpu_arbiter.py` 成为纯显式兼容 facade（仅 re-export），无任何实现代码。行为、SQL、Redis/Lua、锁序与对象 identity 零变化。
- 将三个高层 GPU sibling 一对一迁入领域包：`gpu_dispatch_authority.py` → `gpu_arbitration.dispatch`、`gpu_membership_activation.py` → `gpu_arbitration.membership_activation`、`gpu_rollout_control.py` → `gpu_arbitration.rollout_control`。原路径全部降级为纯兼容 facade。第一方生产代码（deps、workers、admin ML 接口）、测试（含字符串 patch target）与校验脚本改用新路径。至此 7 个旧 GPU 实现路径全部成为 facade。行为、Celery 注册名、worker 路由与对象 identity 零变化。

## [0.23.0] - 2026-07-17

### Changed

- 文档站首屏把单张工作台海报升级为真实路由卡牌堆，自动按 AI 交互、视频、点云、Data Manager 与质检审阅循环；首卡抽出后回到底层，悬停或聚焦时暂停，并支持手动切换。工作台截图按场景关闭侧栏或固定左右各 15%。
- AI 工具组文档去掉重复总览图，按智能点、智能框、Magic Box、Exemplar、文本预标顺序展示各自工具条，并为四个交互工具分别补充无侧边栏、对齐真实车辆的 SAM3 操作 GIF；文档站首页同步提供四工具的左右滑动实录预览与独立说明。
- 文档站 OCR 场景改为真实 RapidOCR 当前题推理 GIF，并同步替换产品实证区的 OCR 展示；工作台录制统一使用 15% 左右侧栏，按场景显式开合且不再写回用户偏好。
- GPU 显存仲裁的 Redis ledger 从单体 `app/services/gpu_arbiter_store.py`（约 8.8k 行）拆分为领域 package `app/services/gpu_arbitration/ledger/`（types / keys / validation / store / scripts），并保留 `gpu_arbiter_store.py` 作为纯 re-export 兼容 facade。15 个最终 Lua 脚本的 SHA-256、Redis key、`KEYS`/`ARGV` 顺序、公开对象 identity 与签名完全不变；旧 `from app.services.gpu_arbiter_store import ...` 导入路径继续可用，仓内生产代码与测试已同步收敛到新路径。
- 打破 `gpu_arbiter ↔ ml_client` 循环依赖：将 `ml_client` 依赖的契约类型与纯策略（dispatch request/grant、错误码、claim 校验、shadow 仲裁、mode 解析等共 39 个符号）抽到 cycle-safe 的 `gpu_arbitration/contracts.py` 与 `gpu_arbitration/policy.py`，`ml_client` 改从这两个低层模块导入而不再导入 `gpu_arbiter`；`gpu_arbiter.py` 保留显式 re-export 以兼容旧 named import，同时继续承载尚待领域化的 orchestration 实现。retirement 探测仍按需局部导入 `ml_client`，此时已不构成环。
- 视频追踪三个平铺模块（`video_tracker_adapters.py` / `video_tracker_job_service.py` / `video_tracker_runner.py`）归位为领域 package `app/services/video_tracking/`（adapters / jobs / runner），原文件保留为纯 re-export 兼容 facade。同时把 task URL 解析从 API router 下沉到 `app.services.storage.resolve_task_url`，消除 tracker runner 的 service → API 反向依赖；tracker job 派发改用 `celery.send_task` 按名调度，消除 service → worker 反向依赖。Celery task 名称、signature、事件 channel/payload 与状态机均不变。
- 导出六个平铺模块（`export.py` / `export_packaging.py` / `export_cache.py` / `export_video.py` / `export_lidar.py` / `export_davis.py`）归位为领域 package `app/services/exporting/`（service / packaging / cache / video / lidar / davis），使用 `exporting` 命名以避开兼容期 `export.py`；六个原文件保留为纯 re-export 兼容 facade。导出成员路径、文件名、静态内容、manifest 语义与 cache key 均不变。
- Data Manager 与 Task Views（`data_manager.py` + 四个 `data_manager_*` 与 `task_views.py`）归位为领域 package `app/services/data_management/`，并按单向层级拆分为 9 个模块：primitive 层 `schema` / `task_metrics` / `task_filters` / `cursor`，mid 层 `entity_filters` / `entities` / `tracks`，high 层 `views` / `service`。消除原有 `data_manager ↔ task_views ↔ entity_filter` 三方循环：schema 与 task_metrics 抽成不依赖 views 的低层模块，task_filters 承载 filter/visibility primitives，entity_filters 只依赖 schema 与 task_filters 的公开接口；schema 根据项目配置直接确定 builtin view keys，不再依赖 views 的导入副作用。六个原文件保留为纯 re-export 兼容 facade，任务/对象/轨迹响应、排序、总数与 cursor 完全一致。

### Fixed

- 修复视频追踪任务按未注册的 Celery 短名称派发、导致 GPU worker 拒收且任务持续排队的问题；派发名称现与 worker 注册名及路由配置完全一致。
- 修复直接导入 Data Manager schema 时内置任务视图为空的问题；视图键现在仅由项目配置确定，不再受模块导入顺序影响。
- 修复文档站首屏以平台 Dashboard 充当标注工作台、与“人在回路”数据生产概念不符的问题；首屏现轮播真实的 AI 交互、视频、点云、数据管理与质检审阅场景。
- 修复视频 mask 导入、关键帧可见性与批量追踪种子处理，确保无损导入、outside 帧编辑和 mask 多轨延展保持正确。
- 修复视频追踪入口的模型与目标类别校验：已有轨迹可继续使用 SAM3，画布级无源追踪不会写入缺失或越界标签。
- 修复视频追踪迁移在存在无源或多源任务时无法回滚的问题；回滚会先移除旧 schema 无法表达的任务。
- 修复并发复用旧 mask 对象时可能被后台回收的问题；引用写入与回收现在按对象键协调并在删除前做最终引用检查。

<!--
日常变更（含普通 bug 修复）按 Keep a Changelog 类型分组追加到本段：
Added / Changed / Deprecated / Removed / Fixed / Security（按此顺序，空组省略）。
发版时把「## [Unreleased]」重命名为「## [x.y.z] - 日期」，再在其上方留一个空的
「## [Unreleased]」。0.23.x 版本段累积在本区；进入 0.24.x 后整体移到 docs/changelogs/0.23.x.md。
-->
