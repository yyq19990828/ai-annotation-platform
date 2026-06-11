---
title: aap tui 监控面板
audience: [dev]
type: reference
since: v0.15.2
status: beta
last_reviewed: 2026-06-11
---

# aap tui 监控面板

`aap tui` 是一个终端监控面板(基于 Textual),提供 Projects / Datasets / Jobs / ML Backends 四个视图,适合在服务器 / SSH 环境下盯异步任务进度与 backend 健康,不复刻 Web 前端。除监控外还提供两个轻量动作(v0.15.8):Projects tab 发起导出、Jobs tab 软取消 job,均经二次确认弹窗。

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
| `e` | 对 Projects tab 选中项目发起导出(target=`aap_json`,二次确认) |
| `c` | 对 Jobs tab 选中的 pending/running job 软取消(二次确认) |
| `q` | 退出 |
| `ctrl+p` | Textual 命令面板 |
| `esc` | 在详情子页内返回上一层 |

## 下钻子路由(v0.15.10)

行选中(回车 / 点击)、按 `o`、或点动作栏的「打开」按钮,会 **push 一个专属详情子页**(Textual Screen 栈),屏顶有面包屑 `aap tui ▸ …`,底部有「◀ 返回」按钮,`esc` 返回上一层:

- **项目详情**(Projects 行下钻):内嵌三个 scoped 子 tab —— **概览**(项目字段 + 进度 + 「⬇ 导出」按钮)、**任务**(对全局 jobs 列表**客户端按 `project_id` 过滤**出本项目的任务,可再下钻进单任务详情)、**Backends**(`ml_backends.list(project_id)`,可再下钻)。
- **任务详情**(Jobs 行下钻):完整 `error_message` / `result`(导出完成显示 `download_url` 与下载提示);`pending` / `running` 的任务带「✖ 取消」按钮。
- **Backend / 数据集详情**:只读展开完整 `health_meta` / 字段。

所有子页只调用 SDK 公开方法,导出 / 取消复用主屏的二次确认路径,不新增写能力。

## 动作(导出 / 取消)

监控之外,TUI 提供两个就地动作,均**先弹二次确认框**(`y` 确认 / `n`·`esc` 取消),只调用 SDK 公开 API:

- **导出**(Projects tab 按 `e`):对选中项目调用 `client.exports.create(..., targets=["aap_json"])`,创建的导出 job 进入 Jobs tab 由轮询接管进度;完成后在 Jobs 详情看 `download_url`。当前固定 `aap_json` 格式,需要其他格式 / 落地下载用 CLI `aap export project`。
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
