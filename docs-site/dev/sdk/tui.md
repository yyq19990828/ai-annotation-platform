---
title: aap tui 监控面板
audience: [dev]
type: reference
since: v0.15.2
status: beta
last_reviewed: 2026-06-11
---

# aap tui 监控面板

`aap tui` 是一个终端监控面板(基于 Textual),提供 Projects / Datasets / Jobs / ML Backends / 看板 / 绩效 六个视图,适合在服务器 / SSH 环境下盯异步任务进度、生产趋势与 backend 健康,不复刻 Web 前端。除监控外还提供两个轻量动作(v0.15.8):Projects tab 发起导出(v0.15.13 起为可选格式 / 选项的导出配置框)、Jobs tab 软取消 job,弹窗均为键盘 + 按钮双通道。

## 安装与启动

需要 `[tui]` extras(隐含 `[cli]` 依赖):

```bash
pip install 'ai-annotation-sdk[tui]'
aap tui
```

凭据解析与 CLI 一致(环境变量 `AAP_BASE_URL` / `AAP_API_KEY` 或 `aap login` 写入的 config.toml);未配置时打印提示直接退出,不进面板。

## 四个 Tab

| Tab | 内容 | 列 |
|---|---|---|
| **Projects** | 项目列表 | display_id / name / status / 进度(完成/总数) |
| **Datasets** | 数据集列表(最多 100 条) | display_id / name / data_type / 条目数 / 大小 / created_at |
| **Jobs** | 异步任务列表(最多 50 条) | kind / status / progress / created_at |
| **ML Backends** | 各项目挂载的 ML Backend 健康状态 | name / 项目 / state / model_version / GPU 利用率 / 显存 / last_checked |

每个主 tab 顶部有一条**动作按钮栏**(鼠标可点,与键盘等价);选中行后回车 / 按 `o` / 点「打开」按钮可**下钻进专属详情子页**(见下「下钻子路由」)。

## 界面布局

- 顶部 **Header**(带标题与时钟),底部 **Footer** 标准化展示当前可用按键。
- 每张表是带圆角边框的面板,边框标题随刷新更新行数计数(如 `异步任务 · 3`)。
- 每个 tab 顶部一条动作按钮栏:刷新 / 打开 / 导出(Projects)/ 取消(Jobs);按钮变体着色。
- 底栏在 Footer 之上有一行**状态栏**,展示当前平台地址、轮询间隔与上次刷新时刻,网络/认证错误也在此提示。
- 配色走内置 **nord** 主题;按 `ctrl+p` 可调出 Textual 命令面板(切主题等)。

## 按键

按键由底部 Footer 实时展示,并**按当前 tab 上下文启用**:`e`(导出)仅在 Projects tab 可用、`c`(取消)仅在 Jobs tab 可用,其余 tab 下这两个键在 Footer 中不显示;进入详情子页后主屏动作键也从子页 Footer 隐藏。

| 按键 | 动作 |
|---|---|
| `r` | 刷新当前激活的 tab |
| `o` / `回车` | 下钻打开选中行详情子页 |
| `e` | 对 Projects tab 选中项目打开**导出配置框**(按项目类型选格式 + 选项) |
| `c` | 对 Jobs tab 选中的 pending/running job 软取消(二次确认) |
| `q` | 退出 |
| `ctrl+p` | Textual 命令面板 |
| `esc` | 在详情子页内返回上一层 |

## 下钻子路由(v0.15.10)

行选中(回车 / 点击)、按 `o`、或点动作栏的「打开」按钮,会 **push 一个专属详情子页**(Textual Screen 栈),屏顶有面包屑 `aap tui ▸ …`,底部有「◀ 返回」按钮,`esc` 返回上一层:

- **项目详情**(Projects 行下钻):内嵌五个 scoped 子 tab —— **概览**(项目字段 + 进度 + 「⬇ 导出」按钮)、**批次**(`batches.list(project_id)`:进度 / 审核 / 退回 / 标注员 / 审核员,v0.15.14)、**成员**(`members.list(project_id)`:用户 / 邮箱 / 角色,v0.15.14)、**任务**(对全局 jobs 列表**客户端按 `project_id` 过滤**出本项目的任务,可再下钻进单任务详情)、**Backends**(`ml_backends.list(project_id)`,可再下钻)。批次 / 成员端点在旧后端或无权限时降级为空表,不拖垮详情屏。
- **任务详情**(Jobs 行下钻):完整 `error_message` / `result`(导出 job 展示结构化摘要:文件数 / 大小 / 缓存命中 / 链接有效期);`pending` / `running` 的任务带「✖ 取消」按钮,**完成态的导出 job 带「⬇ 下载到本地」按钮**(就地输入路径即可落地,无需切到 CLI)。
- **Backend 详情**(v0.15.12 起):**实时监控屏**,见下「ML Backend 实时监控」。
- **数据集详情**:只读展开完整字段。

所有子页只调用 SDK 公开方法,导出复用主屏的导出配置框、取消复用二次确认路径,不新增写能力。

## ML Backend 实时监控(v0.15.12)

ML Backends 行下钻进 **实时详情屏**:不再是静态 REST 快照,而是订阅后端 WebSocket `/ws/ml-backend-stats`(Celery beat 每 **1s** 推送),看到 REST `/health` 拿不到的池/预热维度并实时刷新:

- **实时字段**:`state`、模型是否预热(`loaded`)、空闲卸载倒计时(`idle_unload_seconds`)、上次请求年龄(`last_request_age_seconds`)、`pool` / `video_pool` 占用。
- **滚动曲线**(Textual `Sparkline`,保留最近 60 个 1s 采样点):GPU 利用率 % / 显存占用 % / 缓存命中率 %。
- **生命周期**:进屏订阅(触发后端 beat 实拉,闲时零开销)、离屏断开(后端订阅者计数 -1 后停采)。
- **鉴权**:WS 自 v0.15.12 起接受 `ak_` api_key(此前仅 JWT),但仍要求该 key 所属用户是 **super_admin / project_admin**(运维向);普通标注员的 key 会被拒。
- **降级**:WS 连不上 / 鉴权失败 / 后端旧版本时,顶部仍展示最近一次 REST 快照,状态行提示降级,不崩。

主屏 ML Backends tab 维持 5s REST 轮询的总览列表(避免同时对 N 个 backend 各开一条 WS),实时只在详情屏。

## 看板与绩效(v0.15.15)

把 v0.15.12 的 `Sparkline` 曲线能力从「单设备实时」推广到「项目生产趋势 + 团队绩效」,两个只读视图(非 web 仪表盘交互):

- **📊 看板**:`client.projects.stats()` 的可见项目聚合 —— 顶部标量(总量 / 完成 / AI 率 / 待审)+ 4 条最近 12 周 `Sparkline` 趋势(数据总量 / 完成量 / AI 率 / 待审)。统计是周级数据,`r` 手动刷新,不做高频轮询。
- **🏆 绩效**:`client.dashboard.people()` 全员绩效排行(姓名 / 角色 / 产出分 / 质量分 / 退回率 / 7 日趋势)。**角色门控**:进屏经 `client.me()` 解析角色,仅 **super_admin** 自动拉全局榜单;`project_admin` 须按项目切分(提示用 CLI `aap dashboard people --project <id>`),其余角色显示无权限说明 —— **前置判角色而非吃 403**。`me()` 不可用(老后端)时降级为「角色未知」,看板 tab 不受影响。

## 动作(导出 / 取消)

监控之外,TUI 提供两个就地动作,只调用 SDK 公开 API。所有弹窗均为**键盘 + 按钮双通道**(`y`/`n`·`esc` 与「确认」/「取消」按钮等价,破坏性动作默认聚焦「取消」):

- **导出**(Projects tab 按 `e`,v0.15.13 起对齐 Web):打开**导出配置框**而非固定格式——按 `project.data_type` 自适应给出格式目录(image:COCO / YOLO det/obb/seg / AAP JSON;video:Video JSON / YOLO 逐帧 / AAP JSON / MOT / KITTI;lidar:AAP JSON / KITTI 3D / nuScenes / Point Mask),可多选;另有「包含属性数据」开关、video 项目的帧模式(keyframes / all_frames)、lidar 项目的 3D 坐标系(iso / source)、输出路径,以及可选「完成后自动下载」。确认后 `client.exports.create(...)` 创建的 job 进入 Jobs tab 由轮询接管;**完成后可直接在任务详情屏点「⬇ 下载到本地」落地**,无需切到 CLI。
- **取消**(Jobs tab 按 `c`):对选中且处于 `pending` / `running` 的 job 调用 `client.jobs.cancel()`。取消是**协作式软取消**——后端写取消标记,worker 在下一条任务边界才落 `cancelled` 终态,因此状态栏提示「已请求取消」,最终终态由轮询反映。对终态 job 按 `c` 不弹框、不发请求,状态栏提示不可取消。

## Jobs 轮询与状态着色

- Jobs tab **每 3 秒自动轮询**一次(Projects / Datasets 只在启动和按 `r` 时刷新);底部状态栏显示当前连接的平台地址与轮询间隔。
- 状态着色:`pending` 灰 / `running` 黄 / `completed` 绿 / `failed` 红 / `cancelled` 暗。
- 当某个 job 从 running / pending **翻转为 completed** 时,该行整行绿色高亮并在状态后追加 `✔`,状态栏同时提示「N 个 job 刚完成」。
- 网络 / 认证错误不弹窗,统一显示在底部状态栏。

Jobs tab 大致布局(文本示意,实际效果请安装后运行 `aap tui` 体验;调试 UI 可用 Textual 自带的 `textual run --dev` / `textual console` 工具链):

主屏 Jobs tab + 下钻任务详情子页(文本示意,实际效果请安装后运行 `aap tui` 体验;调试 UI 可用 Textual 自带的 `textual run --dev` / `textual console` 工具链):

```text
┌ aap tui — 标注平台监控面板 ──────────────────────────── 10:02:31 ┐  ← Header + 时钟
│ 📁 Projects │ 🗂 Datasets │ ⚙ Jobs │ 🖥 ML Backends            │
│ [🔄 刷新] [↳ 打开] [✖ 取消]                                    │  ← 动作按钮栏 (可点)
│ ╭─ 异步任务 · 3 ─────────────────────────────────────────────╮ │  ← 边框标题 + 行数
│ │ kind            status       progress         created_at  │ │
│ │ export          running      ███████░░░  70%  06-11 10:02  │ │  ← 回车/o 下钻 ↓
│ │ link_dataset    completed ✔  ██████████ 100%  06-11 09:58  │ │
│ ╰────────────────────────────────────────────────────────────╯ │
│ http://localhost:8000 · jobs 每 3s 轮询 · 刷新 10:02:31         │  ← 状态栏
│ r 刷新   o 打开   c 取消   q 退出                    ^p palette │  ← Footer (上下文按键)
└──────────────────────────────────────────────────────────────┘

  ↓ 回车下钻 → 任务详情子页 (Screen 栈)

┌ aap tui ▸ 任务 export (running) ───────────────────────────────┐  ← 面包屑
│ ╭─ 任务详情 ─────────────────────────────────────────────────╮ │
│ │ id: 0199cc...  kind: export  status: running  progress:40% │ │
│ ╰────────────────────────────────────────────────────────────╯ │
│ [◀ 返回] [✖ 取消]                                              │  ← 子页动作按钮
│ esc 返回                                             ^p palette │  ← 子页 Footer
└──────────────────────────────────────────────────────────────┘
```

## ML Backends 轮询

ML Backend 列表是 project-scoped 的(`GET /projects/{id}/ml-backends`),TUI 通过「遍历项目逐个拉取」聚合成一张表(N+1 请求)。为控制开销,该 tab **仅在被激活时按 5 秒轮询**(其余时间不发请求);切到别的 tab 即停。`state` 着色:`connected` 绿 / `error` 红。健康指标(GPU / cache / model_version)由后端 `/health` 缓存,`last_checked` 列反映最近一次探测时间。

## 维护性说明

Textual 已转为社区维护;因此 TUI 被严格限定在 `[tui]` extras 内、只消费 SDK 公开 API,必要时可整体移除而不影响 SDK / CLI。即便加了导出 / 取消动作与 ML Backend tab,仍只依赖 Textual 公开 widget 与 SDK 公开方法,保持「可整体删除」属性。
