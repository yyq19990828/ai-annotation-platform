# Changelog

本文件记录 AI 标注平台的所有重要变更。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

历史版本详情见 [`docs/changelogs/`](docs/changelogs/)：

| 版本组 | 文件 |
|--------|------|
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

## 最新版本

<!-- 0.15.x 版本变更按版本段追加到本区；进入 0.16.x 后整体移到 docs/changelogs/0.15.x.md -->

## [0.15.12] - 2026-06-11

`aap tui` ML Backend 监控从「5s 轮询 REST」升级为「1s WebSocket 推流 + 滚动曲线」。计划见 `docs/plans/2026-06-11-v0.15.12-tui-realtime-monitoring.md`。

### Added

- **TUI ML Backend 实时详情屏**:订阅 `/ws/ml-backend-stats`(1s 推送),展示 REST `/health` 拿不到的池/预热维度 —— `loaded`(预热)、`idle_unload_seconds`(空闲卸载倒计时)、`last_request_age_seconds`、`pool` / `video_pool`;Textual `Sparkline` 渲染 GPU 利用率 / 显存 / 缓存命中率最近 60 点滚动曲线。进屏订阅(触发后端 beat 实拉)、离屏断开(订阅者计数 -1 停采);WS 不可用时降级展示 REST 快照,不崩。
- **SDK 异步 WS 消费器**(`ai_annotation.tui.ml_stats_ws`):`[tui]` extra 加 `websockets` 依赖;`MLBackendStatsSnapshot` 模型;同步 `Client` / `_http` 不动。

### Changed

- **WS `/ws/ml-backend-stats` 鉴权**:除 JWT 外也接受 `ak_` api_key(SDK/TUI 用),role 校验(super_admin / project_admin)不变;只动这一个 WS 端点。

## [0.15.11] - 2026-06-11

API Key 完善:从「phase 1 仅记录 scope」推进到真正强制 + 过期 + 轮换/编辑 + full-access。计划见 `docs/plans/2026-06-11-v0.15.11-apikey-hardening.md`。

### Added

- **过期时间(`expires_at`)**:创建 key 可选 `expires_in_days`(后端换算为绝对时间);`resolve_token` 在认证入口校验,过期 key 一律 401。迁移 `0104`。
- **Scope 真正强制**:新增 `require_scopes(...)` 依赖工厂,挂到已定义 scope 的读写路由(`annotations:read/write`、`datasets:read`、`predictions:read`)。JWT / 密码登录 principal 视为 full-access 不受约束;api_key 缺 scope → 403。其余路由本版不挂,行为不变。
- **`full-access` 通配 scope(`"*"`)**:含 `"*"` 的 key 绕过 scope 校验,等同全权。
- **轮换 / 编辑端点**:`POST /me/api-keys/{id}/rotate`(换新明文,旧的立即失效)、`PATCH /me/api-keys/{id}`(改 name / scopes / 有效期)。SDK 同步新增 `client.api_keys.rotate()` / `update()`,`ApiKey` 模型加 `expires_at`。
- **前端创建界面美化**:创建表单加「完全访问」开关(选中禁用细分 scope)+ 有效期下拉(30/90/365 天 / 永不 / 自定义);列表加「有效期」列(永不 / 到期日 / 已过期徽标)与「编辑」「轮换」操作。

### Changed

- 删除前端「v0.9.3 phase 1 仅记录 scope,未在路由层强制拦截」提示,scope 现已真实生效。

## [0.15.10] - 2026-06-11

`aap tui` 仿 WebUI 交互:行下钻进专属详情子路由 + 每个 tab 动作按钮栏。维持「只读为主 + 导出/取消 2 动作」红线,纯呈现层,不动 `client.py`、不新增网络调用 / 写能力。计划见 `docs/plans/2026-06-11-v0.15.10-tui-drilldown-routing.md`。

### Added

- **下钻子路由(Screen 栈)**:行选中 / `o` / 「打开」按钮 push 专属详情子页,屏顶面包屑 + 「◀ 返回」按钮,`esc` 返回。**项目详情**内嵌 概览 / 本项目任务(全局 jobs 客户端按 `project_id` 过滤)/ 本项目 Backend 三个 scoped 子 tab,任务 / Backend 行可再下钻;**任务详情**带「✖ 取消」按钮(仅 pending/running);Backend / 数据集详情只读展开。行内详情面板由详情子页取代。
- **动作按钮栏**:每个主 tab 顶部一条可点按钮栏(刷新 / 打开 / 导出 / 取消,变体着色),与键盘等价;导出 / 取消复用既有二次确认路径。

### Changed

- 主屏新增 `o`(打开)绑定;进入详情子页后主屏动作键(`r`/`o`/`e`/`c`)从子页 Footer 隐藏且不触发,避免误操作。

## [0.15.9] - 2026-06-11

SDK 呈现层打磨:`aap tui` 从「能用」深度优化到「好用 + 好看」,`aap` CLI 帮助系统细化。纯呈现层改动,不动 `client.py`、不新增网络调用。计划见 `docs/plans/2026-06-11-v0.15.9-sdk-tui-cli-polish.md`。

### Added

- **TUI 标准 Header / Footer**:顶部 Header(标题 + 时钟),底部 Footer 标准化展示按键;手写按键串从状态栏移除,状态栏改为承载平台地址 / 轮询间隔 / **上次刷新时刻**与瞬态提示。
- **TUI 上下文感知按键**:`e`(导出)仅在 Projects tab、`c`(取消)仅在 Jobs tab 可用,切 tab 时 Footer 实时重算并隐藏不适用的键(`check_action`)。
- **TUI 视觉优化**:表格圆角边框 + 标题 + **实时行数计数**(如 `异步任务 · 3`)、斑马纹、聚焦高亮;详情面板带边框标题;tab 标签加图标;`ConfirmModal` 加标题与半透明遮罩;内置 **nord** 主题;job 完成翻转额外弹一次通知。
- **CLI 帮助细化**:所有命令支持 `-h`(等价 `--help`);顶层命令按 配置与交互 / 资源管理 / 标注流水线 / 监控 四组分栏;启用 rich 帮助渲染;每个子命令补可复制示例 epilog;顶层补 env 变量与快速上手说明。

## [0.15.8] - 2026-06-11

SDK / CLI / TUI 功能补完:`aap tui` 从只读监控扩展出轻量动作与 ML Backend 健康监控。SDK 新增只读 `client.ml_backends` 资源与 `client.jobs.cancel()`,CLI 对齐补 `aap ml-backends` / `aap jobs cancel`。计划见 `docs/plans/2026-06-11-v0.15.8-sdk-tui-actions.md`。

### Added

- **SDK ML Backend 只读监控**:新增 `client.ml_backends.list(project_id)` / `get(project_id, backend_id)` 与 `MLBackend` / `HealthMeta` / `GpuInfo` / `HostInfo` / `CacheStats` 模型(顶层导出);暴露 backend `state`(connected/error)与 `/health` 缓存的 GPU / cache / model_version 指标。
- **SDK 取消 job**:`client.jobs.cancel(job_id)` 软取消(协作式,worker 下一条边界落 cancelled);仅 pending/running 且可取消 kind 有效。
- **CLI**:`aap ml-backends list --project <id>` / `get <id> --project <id>`(只读表格 + `--json`);`aap jobs cancel <id>`。
- **TUI**:新增 **ML Backends** tab(遍历项目聚合,project-scoped;仅激活时 5s 轮询,state 着色 + health_meta 详情);Projects tab `e` 发起导出、Jobs tab `c` 软取消,均经二次确认弹窗(`y`/`n`·esc),终态 job 的取消键禁用。
- **前端「API 密钥」自助入口**:个人设置页(`/settings`)新增「API 密钥」分区,所有登录用户可自助创建 / 吊销个人 key(此前入口仅在管理员可见的「用户与权限」页)。`ApiKeysModal` 主体抽成 `ApiKeysPanel` 由弹窗与设置页共用。

## [0.15.7] - 2026-06-11

项目级工作台规范与性能档位。Project `rendering_config` 从图片渲染覆盖扩展到跨模态工作台行为;用户偏好新增通用性能档位,标准档保持旧硬编码性能参数。计划见 `docs/plans/2026-06-11-v0.15.7-project-level-settings-and-perf-tiers.md`。

### Added

- **项目级工作台规范**:项目设置「渲染配置」改为「工作台规范」,新增 3D 新框默认尺寸、关键帧复制覆盖策略和 AI 传播默认模型;项目值优先于个人记忆 / 个人偏好。
- **性能档位**:`workbench.common.performanceTier` 新增轻量 / 标准 / 激进三档,控制视频帧预览缓存、`ImageBitmap` / WebCodecs 缓存、预取窗口和点云抽稀上限;标准档等于旧默认值。

### Changed

- 3D 点云点击放置新框时优先使用项目 `box3dDefaultSize`,未配置时回退 `4.0 / 1.8 / 1.6` 米。
- 视频关键帧复制对话框在项目配置 `propagateOverwrite` 时锁定覆盖选项,且不把项目锁定值写回用户粘性记忆。
- AI 传播默认模型解析顺序调整为:项目默认模型(在可用列表内) → 用户上次选择 → 项目已绑定真实 ML backend 时首个非 mock 模型 → `mock_bbox`。

## [0.15.6] - 2026-06-11

点云工作台设置补完。`workbench.pointcloud.*` 填充点大小、点掩膜模式、网格/坐标轴显隐和相机阻尼;`workbench.common.crossFrameOverlayK` 收编邻帧叠加 K。计划见 `docs/plans/2026-06-11-v0.15.6-pointcloud-workbench-settings.md`。

### Added

- **点云设置字段**:工作台设置抽屉与个人设置页新增点大小、3D 视角持久化、相机上色、上色对比度 / 亮度 / Gamma、深度提示、点选模式、显示地面网格、显示坐标轴、相机灵敏度;默认值全部等于旧硬编码行为。
- **图片自动适应设置**:`workbench.image.autoFitOnResize` 控制图片画布在边栏开合 / 容器尺寸变化后是否自动重新 fit,默认开启。
- **旧 localStorage 收编**:首次加载时把 `workbench.pointMaskSelectMode` / `workbench.crossFrameOverlayK` 迁入账号级 preferences,并用 `workbench.{userId}.pcd.migrated` 标记避免重复 seed。
- **3D 视角快照**:`workbench.layout.pointcloudCamera` 保存点云主视图 `position/target/up/mode`,由 `persistCameraView` 开关控制是否写入 / 恢复。

### Changed

- 3D 工具条中的点大小滑块、点掩膜模式下拉、相机上色 / 深度提示和邻帧叠加档位改为读写同一份 preferences;抽屉、个人设置页与工具条实时同步。
- `PointCloudScene` 增加网格、坐标轴、OrbitControls 阻尼 setter 和相机快照读写接口,设置变化无需重建 Three.js 场景。
- 点云 2D 相机面板拖拽从默认贴边位开始时先冻结当前位置,避免轻拖跳出画布;「重置相机布局」只清空 2D 相机面板布局,不重置 3D 主视角。

## [0.15.5] - 2026-06-11

视频工作台设置切片。`workbench.video.*` 增加默认播放速率和大步进帧数;关键帧传播与 AI Tracker 传播对话框按用户记住上次选择;WebCodecs 实验开关进入视频任务的工作台设置抽屉。计划见 `docs/plans/2026-06-11-v0.15.5-video-workbench-settings.md`。

### Added

- **视频设置字段**:工作台设置抽屉与个人设置页新增默认播放速率、大步进帧数;默认值保持 1x 和 10 帧。
- **传播对话框粘性记忆**:关键帧传播记住数量 / 方向 / 覆盖选项;AI Tracker 传播记住范围 / 方向 / 模型 / SAM 尺寸,取消或提交失败不回写。
- **WebCodecs 设置入口**:视频任务抽屉新增「实验特性」分组,直接读写既有 `video.experimental.webcodecs` localStorage 开关,刷新后生效。

### Changed

- 时间轴聚焦时 `Shift+←/→` 的大步进支持 5 / 10 / 30 帧或采样网格;`grid` 模式在采样开启时跳一个采样单元,否则回退 10 帧。

## [0.15.4] - 2026-06-11

图片工作台设置切片。`workbench.image.*` 增加画框后行为、吸附阈值、缩放步长、淡化/标签/Mask 覆盖显示偏好;`workbench.common.*` 增加删除确认和最近类别数量。计划见 `docs/plans/2026-06-11-v0.15.4-image-workbench-settings.md`。

### Added

- **图片设置字段**:工作台设置抽屉与个人设置页新增画框后行为、吸附阈值、滚轮缩放步长、淡化透明度、框标签显隐和 Mask 覆盖透明度;默认值全部等于旧硬编码行为。
- **通用设置首批**:新增删除确认策略和最近类别数量;`multi_only` 仅多选删除前确认,`always` 单删/多删都确认。
- **SAM 输出形态记忆**:文本 / Exemplar 输出形态按账号写入本地记忆;项目级默认仍优先。

### Changed

- `afterBoxCreate=reuse_active` 时,手画 bbox 会沿用当前类别直接落库;没有当前类别时仍回退到类别选择器。
- 最近类别列表按配置上限读取和写回,缩小上限无需迁移旧 localStorage。

## [0.15.3] - 2026-06-11

工作台设置体系地基(epic v0.15.3-0.15.7 第一版)。`WorkbenchPreferences` 从平铺字段重构为 **通用/图片/视频/点云** 四子树,工作台内立起「设置抽屉」(齿轮菜单入口、改动实时预览),Settings 页「标注偏好」同步改为注册表驱动的分组渲染。**本版不新增任何用户可感知设置项**,只做结构 + 归位,所有默认值与原硬编码一致。计划见 `docs/plans/2026-06-11-v0.15.3-preferences-schema-and-settings-shell.md`。

### Added

- **工作台设置抽屉**:齿轮菜单 →「工作台设置」,按「通用 + 当前模态」分组,改动本地立即生效(画布实时预览)+ 300ms 防抖 PATCH;被项目锁定的字段禁用 + 「项目锁定」badge。
- **字段注册表** `workbenchSettingsFields.ts`:设置 UI 单一来源(key/分类/控件/可锁定),抽屉与 Settings 页共用 `SettingsFieldControl` 渲染;后续版本新增设置项 = 注册表加一行。

### Changed

- **偏好四分树**:`workbench.{smoothImage,cssImageFilter,controlPointsSize,snapToGrid}` → `workbench.image.*`;`longTaskSampleRate` → `workbench.common.*`;`layout` 保持顶层。存量 JSONB 由迁移 0103 就地改写(up/down 可逆、幂等);`ProjectRenderingConfig` 保持平铺,合并逻辑映射到 `image.*` 子树。
- Settings 页「标注偏好」改为注册表驱动的四分组(空分组不渲染),与抽屉读写同一份数据。

### Notes

- 部署窗口期:已打开的旧前端 tab PATCH 平铺键会被服务端 legacy 提升器接住(v0.16 移除);旧 tab GET 到新形态后渲染默认值,刷新即愈。

## [0.15.2] - 2026-06-11

Python SDK / CLI / TUI + ML Backend starter 教程。把平台已有 OpenAPI、API key、ML Backend 协议产品化为外部集成入口;ML Backend starter 模板判定为时过早,降级为「教程 + 现有示例打磨」。计划见 `docs/plans/2026-06-07-v0.15.2-sdk-cli-and-ml-backend-starter.md`。

### Added

- **Python SDK `ai-annotation-sdk`**(`packages/python-sdk/`,beta,版本随平台 minor):`from ai_annotation import Client`,覆盖 8 个稳定工作流——`projects.list/create/get`、`datasets.create/upload_files/upload_zip/link_project`、`tasks.list/get/next`、`annotations.list/create/update/delete`、`predictions.import_file`、`jobs.list/get/wait`、`exports.create/wait/download`、`api_keys.list/create/revoke`。核心仅依赖 httpx + pydantic;模型 `extra="allow"` 前向兼容;统一异常层级(`APIStatusError` 按状态码细分 + `JobFailedError`/`JobTimeoutError`);幂等 GET 对 429/5xx 指数退避重试。
- **CLI `aap`**(`[cli]` extra,Typer + Rich):`login`(连通验证后写 `~/.config/ai-annotation/config.toml`,chmod 0600)、`projects list/create`、`datasets create/upload/link`、`predictions import`、`jobs wait`、`export project`;rich 表格/进度条,**所有命令提供 `--json` 可脚本化契约**(裸 JSON、无装饰,CI/脚本只依赖它);env `AAP_BASE_URL`/`AAP_API_KEY` 覆盖配置。
- **TUI 面板 `aap tui`**(`[tui]` extra,Textual):Projects / Datasets / Jobs 三 tab 只读监控;jobs 默认 3s 轮询,progress 文本进度条 + 状态着色,running→completed 翻转高亮;`r` 刷新、回车看详情(导出 job 显式给出 download_url)、`q` 退出。同步 Client 全部走 thread worker,事件循环零阻塞。
- **ML Backend starter 教程**:`docs-site/dev/ml-backend/starter.md`——「从 echo 示例出发接入一个真实模型」tutorial(贯穿 OCR backend 改造示例),进阶指向 mock-v2 与 `aap_protocol_v2`;独立 starter 模板按计划判定暂不立项(协议尚在快速收敛期)。
- **示例升级 + contract test 保活**:echo 示例升级为协议 v2.1 最小合规骨架(protocol_version/compat/models[] 目录/运行时观测字段);mock-v2 补齐 v0.14.13–0.14.15 字段(default_variants、`POST /warmup`、`context.model_variants`、422 `variant_not_supported` / 503 `model_unavailable` 演示);两示例各配 contract tests 并接入 CI(`examples-pytest` job),防示例与协议脱节。

### Notes

- 生成策略调整:OpenAPI 快照 3.5 万行,全量 codegen 维护成本与「生成层泄漏」风险均高——首版改为**手写 typed 层 + OpenAPI 快照 contract test**(断言 SDK 使用的全部 24 个 method+path 存在于 snapshot),公开 API 仅限 wrapper。
- 生产 backend 重复样板(presigned 下载、observability 采样,~525 行)下沉 `aap_protocol_v2` 留待后续择机,不阻塞本版。
- SDK / CLI / TUI 测试(respx mock + CliRunner + Textual Pilot)接入 CI `python-sdk-pytest` job。

## [0.15.1] - 2026-06-10

跨帧插值 + 多目标批量 propagate。在 v0.15.0 的 ego 地基上,把 v0.14.1 的「`Shift+→` 逐帧手搬框」升级成「ego 运动补偿 + 关键帧插值 + 批量」,减少长 scene 的逐帧重复劳动。计划见 `docs/plans/2026-06-06-v0.15.1-crossframe-interpolation-and-batch-propagate.md`。

### Added

- **运动补偿 propagate**:`Shift+→`/`Alt+→` 跨帧延续 box_3d 时,若源/目标帧均有 ego pose,由「世界位置不变」反算目标帧 PSR——静止物在下一帧自动套住目标;无 pose 的 scene 退化为 v0.14.1 原样复制(零回归),响应带 `motion_compensated` 标记,前端轻提示一次。几何核心 `services/ego_transform.py` 纯函数(euler 与前端 three.js 锁步)+ 重点单测。
- **多目标批量 propagate**:`POST /tasks/{id}/annotations/propagate-batch`(annotation_ids=null → 全部 active box_3d),整批一个事务;3D 工作台 `Ctrl+Shift+→/←` 或「跨帧工具」面板触发。
- **关键帧区间插值**:`POST /tasks/{id}/annotations/interpolate-range`(body `{group_id, to_task_id}`)——同 group 链两端框之间,中间帧自动生成插值框(世界系线性内插中心 + slerp 朝向 + 线性尺寸);生成框 `source="interpolated"` 便于审核过滤;已有同 group 的中间帧幂等跳过;中间帧锁态整批拒。前端「跨帧工具」面板提供「延续到帧(建链)→ 微调 → 插值填充」工作流。
- **邻帧 overlay ego 对齐**:`GET /scenes/{id}/trajectory` 进前端(`useSceneTrajectory` + `egoAlign.ts`),邻帧参考框先变换到当前帧 ego 系再叠加——静止物历史/未来框与当前帧重合,偏移即目标真实运动。

### Notes

- `point_mask_3d` 跨帧明确不做(点索引跨帧无意义);Kalman / 非线性运动模型留后续。
- 真实数据验证:scene-0061(39 帧)首尾两帧静止物插值 37 帧,世界中心偏差 < 1e-15 m。

## [0.15.0] - 2026-06-10

ego_pose / 时间戳数据地基。给 scene 加"车体随时间的位姿轨迹 + 逐帧时间戳"(nuScenes `ego_pose` / `sample_data.timestamp` 的平台等价物),本版只立地基、回填、透出,不做跨帧 UX(消费留 v0.15.1)。计划见 `docs/plans/2026-06-06-v0.15.0-ego-pose-temporal-foundation.md`。

### Added

- **`scene_frame_poses` 表**(迁移 0102):grain = `(scene_id, frame_index)` 一帧一行,存 ego→global 的 `ego_translation [x,y,z]` / `ego_rotation [w,x,y,z]` + LIDAR_TOP 微秒时间戳;FK CASCADE + 复合唯一约束。历史 scene / 非 nuScenes 来源无行,消费方按"无轨迹"降级。
- **trajectory API**:`GET /api/v1/scenes/{id}/trajectory` 返回按 `frame_index` 升序的逐帧位姿;无位姿 scene → 200 + `poses: []`。
- **manifest 透出**:`GET /tasks/{id}/point-cloud/manifest` 新增 `ego_pose` 字段(本帧 translation / rotation / timestamp_us,无则 null);本版前端仅调试可见,不消费。
- **importer 回填**:`import_nuscenes_scene.py` 落 scene 后逐帧 upsert ego pose + 时间戳(读 `ego_pose.json` + `sample_data.timestamp`,幂等)。
- **backfill 脚本**:`scripts/backfill_frame_poses.py --dataset-id <uuid|display_id> --nuscenes-root <root>` 给 v0.15.0 之前导入的 nuScenes dataset 补 pose 行,按 `scene.source_metadata.scene_token` 反查原元数据,可重跑。
