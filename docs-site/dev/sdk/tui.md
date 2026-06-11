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

Projects / Jobs / ML Backends tab 在表格下方各有一个详情面板,选中行后按回车展开;Jobs 详情包含 `error_message` / `result`,导出 job 完成后还会显示 `result.download_url` 及下载提示;ML Backends 详情展开完整 `health_meta`(GPU 温度/功耗/显存、cache 命中率、host CPU/内存、`error_message`)。

## 按键

| 按键 | 动作 |
|---|---|
| `r` | 刷新当前激活的 tab |
| `e` | 对 Projects tab 选中项目发起导出(target=`aap_json`,二次确认) |
| `c` | 对 Jobs tab 选中的 pending/running job 软取消(二次确认) |
| `q` | 退出 |
| `回车` | 查看选中行详情(Projects / Jobs / ML Backends tab) |

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

```text
┌─ aap tui ────────────────────────────────────────────────────┐
│  Projects │ Datasets │ [Jobs]                                │
│ ┌──────────────────────────────────────────────────────────┐ │
│ │ kind            status       progress         created_at│ │
│ │ export          running      ███████░░░  70%  06-11 10:02│ │
│ │ link_dataset    completed ✔  ██████████ 100%  06-11 09:58│ │
│ │ predict_batch   failed       ███░░░░░░░  30%  06-11 09:41│ │
│ └──────────────────────────────────────────────────────────┘ │
│ ──────────────────────────────────────────────────────────── │
│ id: 0199cc...            ← 选中行按回车后的详情面板          │
│ status: failed                                               │
│ error_message: ...                                           │
├──────────────────────────────────────────────────────────────┤
│ http://localhost:8000 · r=刷新 e=导出 c=取消 q=退出 · jobs 每 3s 轮询 │
└──────────────────────────────────────────────────────────────┘
```

## ML Backends 轮询

ML Backend 列表是 project-scoped 的(`GET /projects/{id}/ml-backends`),TUI 通过「遍历项目逐个拉取」聚合成一张表(N+1 请求)。为控制开销,该 tab **仅在被激活时按 5 秒轮询**(其余时间不发请求);切到别的 tab 即停。`state` 着色:`connected` 绿 / `error` 红。健康指标(GPU / cache / model_version)由后端 `/health` 缓存,`last_checked` 列反映最近一次探测时间。

## 维护性说明

Textual 已转为社区维护;因此 TUI 被严格限定在 `[tui]` extras 内、只消费 SDK 公开 API,必要时可整体移除而不影响 SDK / CLI。即便加了导出 / 取消动作与 ML Backend tab,仍只依赖 Textual 公开 widget 与 SDK 公开方法,保持「可整体删除」属性。
