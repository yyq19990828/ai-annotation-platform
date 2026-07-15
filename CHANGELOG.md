# Changelog

本文件记录 AI 标注平台的所有重要变更。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

历史版本详情见 [`docs/changelogs/`](docs/changelogs/)：

| 版本组 | 文件 |
|--------|------|
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
| 0.9.x | [docs/changelogs/0.9.x.md](docs/changelogs/0.9.x.md) |
| 0.8.x | [docs/changelogs/0.8.x.md](docs/changelogs/0.8.x.md) |
| 0.7.x | [docs/changelogs/0.7.x.md](docs/changelogs/0.7.x.md) |
| 0.6.x | [docs/changelogs/0.6.x.md](docs/changelogs/0.6.x.md) |
| 0.5.x | [docs/changelogs/0.5.x.md](docs/changelogs/0.5.x.md) |
| 0.4.x | [docs/changelogs/0.4.x.md](docs/changelogs/0.4.x.md) |
| 0.3.x | [docs/changelogs/0.3.x.md](docs/changelogs/0.3.x.md) |
| 0.2.x | [docs/changelogs/0.2.x.md](docs/changelogs/0.2.x.md) |
| 0.1.x | [docs/changelogs/0.1.x.md](docs/changelogs/0.1.x.md) |


---

## [Unreleased]

### Added

- **ML Backend 注册表新增强类型逐卡显存声明**：超管可为全局 backend 设置稳定 `gpu_resource_id`、保守 `vram_budget_mb` 与驱逐优先级；平台从显式逐卡资源映射校验单体预算，并通过只诊断端点区分配置阻断与允许驱逐的弹性超售。单卡、同机多卡和多主机同号卡均按资源 key 隔离；管理 API 分开报告 desired/effective mode，observe 影子派发就绪时 effective 为 `observe`，enforce 在账本与 gate 握手就绪前仍为 `off`。过期或失败的 health 不会被当作 CPU/UUID 证据。
- **模型市场新增逐卡 GPU 配置与 residency 观测**：超管可编辑 backend 的物理资源、显存预算和驱逐优先级，并查看每张卡的容量、静态超售、desired → effective mode、CPU fallback 与逐池驻留。没有绑定项目的全局 backend 仍可做健康检查与卸载，操作成功文案不再将请求已接受误报为显存已释放。
- **GPU observe 影子仲裁覆盖真实加载派发口**：predict、交互预测、warmup、reload 与注册 smoke-test 在发送 backend HTTP 前使用同卡静态预算和新鲜 residency 输出非权威 `would-admit|would-evict|would-reject` 决策；legacy unload 只记录请求，不能作为显存减账证据。单卡、同机多卡和多主机同号卡始终按完整资源 key 隔离；旁路查询超时后 fail-open，不会拒绝、排队或驱逐业务请求，enforce 在 Redis 账本与 lifecycle gate 就绪前仍保持关闭。
- **受管 GPU 生命周期获得共享 wire 与非对称验签契约**：共享 ML Backend 协议新增 canonical generation/control epoch、residency、transition、八类结构化错误和 admission claims schema，并固定使用带 `kid` 的 Ed25519 / EdDSA token；平台签发进程独占私钥，backend 只持可轮换公钥 keyring。
- **YOLO 成为首个具备受管 GPU 生命周期的 Backend**：模型池现在先预留再构建，并以 borrower 与逐模型使用锁保护 LRU、可变模型状态和全池卸载；请求取消或 build 超时后仍跟踪真实 executor/builder 完成，tracker 会在截断和异常时关闭流。`/health` 暴露可信 residency，加载入口支持 EdDSA admission、generation fencing、replay 防护、drain/cancel、受管 unload、mode/reset 与 legacy 兼容。其他 Backend 与平台仲裁账本尚未接入，enforce 仍保持关闭。
- **ONNXTools 获得受保护的固定句柄池与受管生命周期纵切**：pipeline、detector、va 冷启动现在 single-flight，并以 borrower、逐句柄使用锁和真实 executor/builder 跟踪防止重复构建、推理中卸载及取消后的隐藏 GPU session。`/health` 聚合四个业务 ORT session 的真实 provider chain，manual、idle、shutdown 与受管 reset/unload 共用全池清理；Docker 依赖固定到已审计上游提交。部署完成真实 GPU 回落验证前不会在 `/setup` 宣告 managed capability，也不会进入自动驱逐集合。
- **RapidOCR 获得动态 composite 引擎池与受管 GPU 生命周期**：六种权重三件套现在通过 slot 预留、同 key single-flight、borrower 和逐引擎使用锁保护 det/cls/rec 三条 ORT session；LRU 会先完整释放空闲旧引擎再构造替代。`/health` 新增可验证 residency，predict/warmup 接入 admission，并支持 drain/cancel、generation fencing、受管 unload、mode/reset、idle 与 shutdown 全池清理。经确认的设备错误才允许 CPU replacement，部分 CUDA 构造的释放未经全池清理确认时保持 Unknown。参考镜像和模型已通过真实满池 GPU 回落及显式 CPU 推理验证；能力门槛仍由每个部署显式开启。
- **Grounded-SAM2 获得图像/视频双池受管 GPU 生命周期**：两个变体池现在共享冷构建串行锁，并通过 single-flight、容量预留、borrower 和逐条目使用锁保护 predictor、embedding cache 与 video tracker；请求取消后会继续跟踪真实 executor 和 builder。受管 unload/reset 会完整清理双池，`/health` 聚合三态 residency，predict/warmup/reload 接入 generation fencing、admission、drain/cancel 与 mode/reset。参考镜像与六份 checkpoint 已通过双池 LRU、两轮 generation 冷启及物理显存回落验证；能力门槛仍由每个部署显式开启。
- **SAM3 获得图像与两类视频三池受管 GPU 生命周期**：image、multiplex 文本追踪和 PVS 点框追踪现在通过独立池与共享冷构建锁管理，single-flight、borrower/use lock 和取消安全 executor 保护真实 owner。`/health` 聚合三池 residency，受管 reset/unload/shutdown 覆盖全部模型与 embedding cache，predict/warmup/reload 接入 admission、generation fencing、drain/cancel 与 mode/reset。参考制品完成图像及两类视频真实推理、两轮冷启与三池物理显存回落验收；部署能力门槛仍默认关闭并需显式验证。

### Changed

- **跨 Backend GPU 显存仲裁按逐物理资源治理**：ADR-0049 按稳定 `gpu_resource_id` 分片的静态预算准入与优先级加权 LRU 驱逐，统一单卡、多卡共享和多主机同号卡语义，并冻结 residency 真值、request lease、generation fencing、锁外卸载、enforce fail-closed、错误码与阶段门禁。五个 backend 的受管代码纵切、静态 claim、observe 影子派发、持久 fencing 高水位以及 Redis allocation/lease/FIFO/transition 原子账本已经落地；账本重建以 revision + incarnation 双重 CAS、全域镜像校验和有界 deadline fail-closed。独立持久 membership/tombstone 现会在 claim 事务内建立并保留退役证据，RESTRICT fence 不会先于墓碑丢失，pending 成员以 runtime baseline 为基准受控激活，冻结墓碑在 proof-backed GC 前不可改删；签发新 fence 或复用既有 epoch 时都能按 exact membership epoch 单调持久化令牌过期上界，探活写回会在 registry→membership 行锁后重验 epoch/state。Redis v2 账本进一步把 all-domain、携带 epoch/state 的 membership-domain 与 active-domain 纳入同一资源 CAS；新准入和排队只接受 exact active epoch，retiring 成员仍可收敛已有 lease、ticket 与 transition，域变化先 fail-close 再单调扩张，响应丢失重试与旧 schema 均不会绕过门禁。`generation=null` 现只能以 non-evictable Unknown 全额计费，且不能准入、排队或参与普通 generation transition；已知 generation 不会在普通 repair 中退回 null。GPU backend 的 `/health` 现支持 header/query 双通道 challenge 精确回显，平台只把唯一响应回显与数据库时钟、backend/resource 和当前 membership 绑定为实时证据候选；旧 backend 或代理丢失回显时仍可保持 connected，严格拒绝未知 query 的实现会降级到一次普通探活，但兼容响应不能形成仲裁证明。Redis proof reset 现以独立 begin/commit 两阶段原语冻结 prepared 资源，进程重启可恢复持久 context，commit 会按封闭域一次性清理 active/retiring child；Unknown、不完整证明和超额承诺只会落 not-ready，精确重试会重新校验当前 deadline 与完整 post-state，无法用未推进 revision 的 partial corruption 回放 ready。缺失 fence、旧探活写回、配置 ABA、墓碑重入、反向锁序以及受管 runtime 后的端点、claim、预算和删除旁路均会 fail-closed。ONNXTools 仍待真实 GPU 回落验收，token horizon 锁内证明消费、retired child/tombstone GC、周期 bootstrap/repair worker、enforce 与真正驱逐仍待实施。

### Fixed

- **项目管理员不再能通过项目旧路由改写全局 ML Backend**：全局 backend 的 URL、鉴权、名称与调用参数已与 GPU 资源声明一并收口到超级管理员；项目管理员仍可在项目设置中启用或停用已注册 backend，不会再影响其他项目共享的端点。
- **YOLO 与 ONNXTools 冷启动取消不再遗留池外 GPU owner**：模型或句柄 builder 现在会等底层 executor、失败清理和状态提交全部结束后才释放 reservation；重复取消也无法打断 unload 真值提交。失败或取消后的未知驻留会阻止继续冷建，直到受管全池清理重新建立可信空状态，避免隐藏对象突破物理显存上限。
- **YOLO 受管生命周期在重复取消和进程 shutdown 时不再提前丢失真实 owner**：取消冷启动请求会在不再次让出事件循环的情况下登记仍运行的 builder，borrower 释放与 shutdown 即使连续收到取消也会先等待 active、builder、waiter、borrower 和全池清理完成，再向调用方重抛取消，避免健康状态短暂早于真实 GPU 工作归零。
- **Grounded-SAM2 的淘汰取消与失败清理不再丢失 GPU artifact owner**：替换 builder 在首次调度前取消时，被摘除的 LRU victim 仍由独立 cleanup owner 接管；attachment cleanup 失败会隔离保留强引用供后续 force cleanup 重试，只有所有失败 artifact 与 CUDA 清理均可信完成后才恢复空驻留，避免隐藏显存被误报为已释放。
- **SAM3 全池卸载不再遗留 BF16 权重转换缓存**：vendor 原先把 autocast 永久进入进程上下文，真实推理后即使三池逻辑上已空，PyTorch 仍会持有数 GiB 的转换权重。图像、multiplex 与 PVS 现均使用请求级 autocast，严格清理同时清空 cast cache，卸载驻留真值与物理显存恢复一致。
- **ML Backend 设备失效观测不再误报可回退性和实际 provider**：共享 torch 设备 latch 现在线程安全且向 CPU 单调，Grounded-SAM2 与 YOLO 只在识别为设备错误且 CPU replacement 成功后提交回退；CUDA runtime 查询本身失败时，两者的 `/health` 仍可用，YOLO 也会在 CPU replacement 后尝试释放 CUDA allocator 缓存。SAM3 image、Multiplex 与 PVS 明确为 GPU-only，模型加载检测到 GPU 不可用时返回可重试的结构化 503。RapidOCR 与 ONNXTools 改为读取已加载业务 session 的实际 primary provider，ONNXTools composite 的检测与分类 session 共用同一份功能探测后的 provider 偏好；空池、缺失或混合 provider 返回 `null`（unknown 语义）。注册表快照与实时 `/observe` 均透传 `compute`，Runtime Observe 与 PerfHUD 的前端消费共用同一 CPU fallback 判定，不再误报显式 CPU、实时空状态或 GPU-only backend。

## [0.22.3] - 2026-07-14

### Added
- **ML Backend 有效计算设备可观测地基**：五个 ML 后端镜像（yolo / grounded-sam2 / sam3 / rapidocr / onnxtools）在 `/health` 暴露顶层 `compute: {configured_device, effective_device | effective_provider}`，并建立共享 torch 设备探测与初始 ORT provider 功能探测。平台将该字段传入注册表 `health_meta` 与 PerfHUD 实时快照，管理端可显示 GPU 配置与 CPU 生效路径的偏离。该交付建立了 ADR-0049 所需的诊断传输链；具体 fallback 是否成立以各 backend 能力为准，不由一次启动探测推断。

### Changed
- **视频时间轴两态提升信息密度与窗口辨识度**：展开面板不再为章节、书签、问题、AI 预测、所选轨迹、AI 影响范围与循环区间保留空行，并把播放、逐帧和缩放控件压缩到底部状态栏，不再用大号图标单独占据一整行；缩放 / 适配按钮固定在底栏最右侧，展开 / 收起通过尊重系统动态偏好的平滑过渡衔接，两态也保持同一贴底位置。紧凑态继续呈现语义摘要，并把状态信息移到独立一行，为主时间条保留更多宽度。展开、收起态均显示当前 / 总时长和明确的全片窗口读数，未缩放时也保留完整窗口选区，缩放后可直接判断当前窗口位于全片的哪一段。
- **视频追踪的目标种子改为逐目标摘要**：种子区现在每个目标单独一行，直接列出点数、框数和具体所在帧，同时标记后续操作会归入的当前目标；多目标与跨帧纠偏不再只显示难以对应的汇总数。
- **视频追踪模型选择器只显示当前项目真正可执行的模型**：模型列表现在按项目已启用、已连接且能力可达的 ML Backend 过滤，并在模型名后显示提供它的后端；组合追踪只有同一后端同时提供文本发现与点框追踪时才出现。后端也会在排队前拒绝不可执行的真实模型，不再创建随后必然失败的任务。
- **视频工作台明确分离画布发现、单轨延展与多选延展**：顶部入口改为「发现目标」，单条轨迹卡与右键菜单改为「延展此轨迹」，多选入口改为「批量延展」；追踪面板首屏显示操作作用范围，提交按钮随之变化。文本发现模型与「+ 新目标」只保留在画布级入口，单轨操作不再混入新建多目标语义。
- **视频 AI 追踪面板改为紧凑的画布检查器**：方向、范围、模型、种子与影响摘要现按任务层级分区，追踪进度和候选审阅共用同一视觉语言；配置面板停靠在中间画布右上角，避免遮挡主要标注区域。入口迁移到顶部 AI 单题按钮左侧并采用相同样式，两个 AI 面板保持互斥；打开后的面板也共用相同的紫色语义边框、渐变头部与表单分区骨架，并与单题面板一样支持画布内拖动、右下角缩放及位置/尺寸偏好恢复。
- **视频 AI 追踪的 `mock · 测试框` 不再出现在生产界面**：mock 模型只是无 ML backend 时验证流程的开发兜底，此前项目没绑后端时仍会露给用户。现生产构建里彻底隐藏它（无论是否绑后端），仅开发构建保留以便本地无 GPU 验证；绑了真实后端的项目行为不变。

### Fixed
- **图片与视频画布的缩放浮条贴齐可用区域右侧**：浮条此前仍为已收窄的反馈按钮触发区保留额外空档，看起来悬在画布中间；现在直接以画布容器右边缘为锚点，侧栏宽度变化时也会跟随画布边界。
- **工作台右下角反馈按钮不再干扰画布与视频时间轴**：BUG / Issue 悬浮按钮的自动唤出区此前远大于实际入口，操作右侧缩放浮条或时间轴控件时可能意外出现并抢占点击；现在只在右下角窄触发带唤出，出现后由按钮自身维持展开，画布控件与时间轴可以保持贴底而不与其冲突。
- **折叠时间轴上的活动区间恢复可见反馈**：循环区间、章节圈选草稿和 AI 影响范围此前虽然已生效，却会被紧凑态样式隐藏；现在拖动和受控范围在展开、折叠两态下都能立即确认。
- **视频追踪的「追踪方向」标题不再被分段按钮遮挡**：方向字段现在显式重置原生 `fieldset / legend` 间距并使用正常行高，中文字形下沿可完整显示。
- **SAM3 文本追踪跨分窗不再从第二窗开始无输出**：multiplex 每个分窗都会新建会话，此前平台虽传入上一窗实例种子，SAM3 文本分支却没有消费，窗首文本暂时未检出时整窗会返回空。后续分窗现在把上一窗所有实例的有效外接框作为正提示与文本一起下发，单实例、多实例及 Mask 轨迹都能继续追踪。
- **视频 AI 追踪对话框选 SAM3 系模型时不再显示无效的「尺寸」档位**：SAM 尺寸档位（tiny/small/base_plus/large）是 SAM2 checkpoint 概念，此前对所有非 mock 模型都显示，选 SAM3 文本检测 / 点框交互 / 发现追踪时也能选——但这些模型用各自 SAM3 权重、忽略该档位，误导用户以为能调 SAM3 模型大小。现「尺寸」选择器只对 `sam2_video` 显示，提交时也只对它透传 `sam_variant`。

## [0.22.2] - 2026-07-13

### Added
- **视频 AI 追踪新增「发现追踪」(combo):按文本自动发现目标再逐对象记忆追踪**:选 SAM3「发现追踪 (combo)」并填文本(如 car)后,一个作业内先用 multiplex 在起始帧按文本检测出画面里的多个目标,再把每个目标当作独立种子交给 PVS 逐对象 memory 追踪——兼得「文本自动发现」与「跨帧干净身份」,发现的目标各建独立新轨迹(需指定目标类别)。仅在 sam3 backend 同时声明文本检测与点框交互能力时可选。
- **视频 AI 追踪支持多选批量:一次延展多条已有轨迹**:在轨迹清单或选中卡里多选 ≥2 条轨迹后,新增「AI 追踪」批量入口一次发起——各源轨迹在同一个作业里被并行追踪,各自回填各自轨迹,只产生一条审阅记录、一次接受(而非按轨迹逐条 fan-out)。对话框摘要显示「延展 N 条轨迹」及类别(同类显类名、混类显「N 类」)。
- **DEV 截图 seed 使用可追溯的真实场景和期望状态**：`screenshots` profile 从固定来源拉取真实道路图片、城市交通视频、PCL 室内点云与 RapidOCR 示例，经确定性裁剪/转码/无效深度过滤后，按显式媒体路径创建 4 个项目、14 个任务和多状态批次；`--repair` 仅重建能够证明由截图 seed 管理的对象。DEV 媒体改走同源 `/minio` 代理，远程浏览器不再依赖直连 9000 端口或 Docker 私网 IP。
- **截图 seed 按场景能力绑定 ML Backend**：live 模式通过 `/health` 与 `/setup` 为图片交互、视频追踪和 OCR 项目选择可用 backend，并精确创建项目启用关联和主绑定；无 GPU 环境可启动同协议 stub，catalog 会对连接状态、能力快照、tracker 路由及 OCR 输出契约 fail-closed。
- **截图场景改由 seed catalog 和真实角色驱动**：Playwright 在导航前统一校验项目、任务、批次、ML Backend 与场景能力，标注员和审核员页面使用真实成员关系；截图时钟、语言、时区、DPR、动画和资源就绪条件现已固定，并提供不覆盖资产的全场景验证模式。
- **截图资产建立可校验清单与视觉回归基线**：完整矩阵成功后才会原子重建含场景来源、seed、浏览器、SHA-256 和尺寸的 manifest，Markdown、`img` 与 `AutoImage` 引用统一进入严格门禁；8 个高价值真实场景使用同一 catalog 和协议 stub 做 Chromium 像素回归，流程临时产物与重复 GIF 不再进入仓库。
- **ML Backend 性能基准文档（RTX 3090）**：新增超管文档《ML Backend 性能基准》，实测 grounded-sam2 / sam3 / yolo / rapidocr 各任务的纯推理 / 端到端延迟、重新加载耗时、显存足迹、并发标注吞吐、视频轨迹转播（含 sam3 16 帧分窗口耗时拆解）与模型变体（yolo11 尺寸 / SAM2 档位 / GroundingDINO T·B / OCR mobile·server）对照，供客户做硬件规划与 backend / 模型选型参考。

### Changed
- **文档站首页改为可验证的真实产品场景叙事**：产品实证区现展示 SAM3 Magic Box 从粗框、候选到人工确认的短流程，并复用 OCR、项目预标注与模型市场截图解释完整 AI 生产链路；移动端与减弱动效环境使用静态海报，文档入口同时补齐独立的部署与运维路径。
- **用户手册截图已按真实 seed 场景全量刷新**：正式矩阵现包含 60 张自动 PNG、3 张手工 PNG 和 12 个多帧流程 GIF，图片、视频、点云与 OCR 工作台均展示固定来源的真实媒体；发布门禁同时校验当前 seed revision、文档引用、文件摘要、孤儿和重复内容，视频场景会主动恢复统一布局并清理残留追踪候选。
- **视频工作台工具栏改按单帧与轨迹分组**：选择工具保持独立，SAM 工具归入单帧子组，手工轨迹与 AI 追踪集中到轨迹组；矩形框轨迹改用叠帧方框图标，不再与 SAM 智能点混淆。
- **视频 AI 追踪发起后对话框内即时显示进度**:此前点「开始追踪」对话框立即关闭,追踪进度只散落在轨迹卡的作业徽标和结果就绪后的审阅条上,发起到出结果之间对话框内毫无反馈。现对话框就地转为「追踪中…」轻量进行态(有分窗回报时显示「第 c/t 窗」),结果就绪自动让位给候选审阅条,失败则收起;「后台继续」可随时关闭对话框而不影响后台追踪,对齐图片侧交互式 AI 的即时反馈。

### Fixed
- **远程 DEV 工作台不再因 WebSocket 误连而持续重连**：远程浏览器此前会把默认 `localhost:8000` 解释为访问者本机，视频项目还会因实时与媒体链路不可达退回总览。现在远程 DEV 默认通过当前页面同源 `/ws` 和 `/minio` 代理连接，本机调试仍保留直连 API，显式 `VITE_WS_HOST` 配置优先。
- **视频 AI 追踪对话框不再与右侧「选中卡」视觉相撞**:顶部居中的追踪工具条打开时,右侧浮动的选中标注卡会自动收起为紧凑标签让位(仍显示类别标题作上下文),对话框关闭后复位到用户原本的展开/折叠状态,不改动其持久化偏好。

<!--
日常变更（含普通 bug 修复）按 Keep a Changelog 类型分组追加到本段：
Added / Changed / Deprecated / Removed / Fixed / Security（按此顺序，空组省略）。
发版时把「## [Unreleased]」重命名为「## [x.y.z] - 日期」，再在其上方留一个空的
「## [Unreleased]」。0.22.x 版本段累积在本区；进入 0.23.x 后整体移到 docs/changelogs/0.22.x.md。
-->

## [0.22.1] - 2026-07-13

### Added
- **DEV 截图 seed 增加可审计素材与 catalog 地基**：版本化清单固定上游来源、摘要、大小和媒体公开状态，下载器提供原子缓存、离线模式与安全解压；非生产环境可通过稳定逻辑键解析截图用户/项目/任务，并在 ML Backend 主绑定、启用关联、连接状态或能力快照缺失时明确失败。
- **视频 AI 追踪对话框新增「本次影响」摘要**:发起前即显示本次会延展选中轨迹还是新建轨迹、各新建几条;文本检测模式额外提示新目标将继承源轨迹类别,避免「选中 car 轨迹却按文本检测行人」时类别被误标。
- **视频 AI 追踪新增画布级入口,可不选轨迹直接检测新目标**:左侧工具栏 AI 工具组新增「AI 追踪」按钮,无需先选中轨迹即可发起——用文本(如 car)或点/框种子让 tracker 一次检测并追踪画面里的多个新目标(各建独立新轨迹),新目标类别显式指定、不再借用选中轨迹类别。原「选中轨迹发起延展」路径(Ctrl+B / 右键 / 卡片)完全保留。

### Changed
- **视频「AI 追踪」功能对外命名统一**:工作台此前混用「AI 传播 / 发起传播 / AI 追踪传播」指代同一个视频追踪能力,既与另一套纯几何的「标注传播」撞名,又让「传播」盖过了实际的多目标追踪语义。现统一为「AI 追踪」(主按钮「开始追踪」、时间轴泳道「AI 追踪」、方向与错误提示同步),交互与后端行为不变。

## [0.22.0] - 2026-07-13

### Added
- **视频工作台新增原生栅格 Mask 轨迹与 DAVIS 导出**：标注员可用 `M` 在当前帧创建或编辑逐像素 Mask 关键帧，笔刷 / 橡皮支持逐 stroke 撤销重做，帧间按 hold 语义显示并以 alpha 精确选择；SAM2 / SAM3 tracker 可直接产出 Mask 候选，接受前后保持同一 RLE。Mask 使用内容寻址存储并支持 AAP JSON 无损迁移、Video JSON、COCO RLE、bbox-only 外接框降级及标准 DAVIS Full-Resolution palette PNG；导出包内不同 target 可保留各自帧编号规则。

### Fixed
- **视频 Mask 笔刷现在按视频固有分辨率保存**：视频工作台此前错误复用了尚未初始化的图片舞台尺寸，编辑 buffer 会退化成 1×1；绘制后虽然显示“未保存”，实际没有像素、确认也不会提交。上传后创建轨迹时，等价的元组尺寸也会被误判不匹配并返回 500。现视频任务从 manifest 取得宽高，服务端同时接受规范化后的尺寸序列，笔刷叠加与 Mask 轨迹保存恢复正常。
- **视频追踪任务刷新后不再卡在「运行中」**：页面刷新时若登录态尚未恢复，运行中的追踪任务不会重连进度通道，UI 会一直显示 running、不冒出「完成待接受」，直到用户手动切走再切回。现登录态到位后会自动补连尚未连接的运行中任务。
- **跨任务切换不再把上一个任务的 AI 候选挂到新任务画布**：在追踪候选预览请求在途时切到新任务，回来的候选此前会写成孤儿，并可能因视频项目跨任务共用 track / annotation id 而渲染到新任务、令接受 / 丢弃按钮打到旧任务的作业。现按任务归属校验后再写入。
- **大任务打开 Data Manager「匹配详情」不再拉全表**：匹配抽屉的标注 / 预测候选 / 追踪作业三路查询此前无分页、全量物化进内存再切片，含数万条标注的任务即使只取一页也会内存尖峰、阻塞事件循环。现把分页下推到 SQL（预测候选也只对当前页做昂贵的形状转换），返回结构、总数与排序不变。
- **等值属性不再被误判为「不一致」**：Scene 轨迹聚合此前用 `repr()` 比较字典 / 列表型属性值，键顺序不同的等值对象（如导入 JSON 与编辑器写回）会被错标 `inconsistent_attributes` 并丢掉该字段的公共值。现改用规范化 JSON（键排序）比较。
- **失效的内置任务视图现在能说明原因**：当内置视图引用了已删除的属性字段而失效时，前端此前只拿到空数量、拿不到失效字段名。现内置视图与保存视图一致回传 `invalid_fields`。
- **COCO 逐帧分割导出不再静默把未知类名并进 0 号类别**：类名缺失 / 被删 / 为空的标注此前会静默落到 `category_id=0`——删类后的旧标注会污染训练集，项目未定义类时还会产生让 `pycocotools` 加载即 `KeyError` 的悬空引用。现改为跳过该标注，并在导出摘要与日志中汇总被跳过的数量与类名。
- **Data Manager 图表柱条在主题切换后正确换色**：任务状态柱条颜色此前被 `useMemo` 空依赖缓存，浅色主题打开图表再切深色时柱条仍是浅色、与深色卡片对比失衡。现跟随主题重算。
- **从 Data Manager 跳入工作台后不再被 URL 焦点反复拉回**：带 `?focus=…&frame=…` 进入工作台后，用户改选别的标注 / 帧，随后任何标注增删改触发的刷新此前会把选中与帧位置拉回 URL 初值。现 URL 焦点仅在首次命中时应用一次。
- **`project_task_views` ORM 补齐 0119 新增的复合索引**：`ix_project_task_views_scope_visibility` 此前只存在于迁移、未声明进 ORM，导致测试建表缺索引、`alembic --autogenerate` 与生产库反向漂移。现已在模型侧对齐。
