---
title: aap tui 监控面板
audience: [dev]
type: reference
since: v0.15.2
status: beta
last_reviewed: 2026-06-11
---

# aap tui 监控面板

`aap tui` 是一个只读终端监控面板(基于 Textual),提供 Projects / Datasets / Jobs 三个视图,适合在服务器 / SSH 环境下盯异步任务进度,不复刻 Web 前端。

## 安装与启动

需要 `[tui]` extras(隐含 `[cli]` 依赖):

```bash
pip install 'ai-annotation-sdk[tui]'
aap tui
```

凭据解析与 CLI 一致(环境变量 `AAP_BASE_URL` / `AAP_API_KEY` 或 `aap login` 写入的 config.toml);未配置时打印提示直接退出,不进面板。

## 三个 Tab

| Tab | 内容 | 列 |
|---|---|---|
| **Projects** | 项目列表 | display_id / name / status / 进度(完成/总数) |
| **Datasets** | 数据集列表(最多 100 条) | display_id / name / data_type / 条目数 / 大小 / created_at |
| **Jobs** | 异步任务列表(最多 50 条) | kind / status / progress / created_at |

Projects 与 Jobs tab 在表格下方各有一个详情面板,选中行后按回车展开;Jobs 详情包含 `error_message` / `result`,导出 job 完成后还会显示 `result.download_url` 及下载提示。

## 按键

| 按键 | 动作 |
|---|---|
| `r` | 刷新当前激活的 tab |
| `q` | 退出 |
| `回车` | 查看选中行详情(Projects / Jobs tab) |

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
│ http://localhost:8000 · r=刷新 q=退出 · jobs 每 3s 轮询      │
└──────────────────────────────────────────────────────────────┘
```

## 维护性说明

Textual 已转为社区维护;因此 TUI 被严格限定在 `[tui]` extras 内、只消费 SDK 公开 API,必要时可整体移除而不影响 SDK / CLI。
