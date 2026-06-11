"""aap tui 监控面板 (Textual)。

监控四视图: Projects / Datasets / Jobs / ML Backends; jobs 默认 3s 轮询。
轻量动作 (v0.15.8): Projects tab `e` 发起导出, Jobs tab `c` 软取消 job, 均经二次确认弹窗。
下钻子路由 (v0.15.10): 行选中 / `o` / 「打开」按钮 push 专属详情 Screen (面包屑 + 返回);
项目详情屏内嵌 概览 / 本项目任务 / 本项目 Backend 三个 scoped 子 tab。每个主 tab 顶部有动作按钮栏。
SDK Client 是同步 httpx —— 所有网络调用放 thread worker, 经 call_from_thread 回 UI 线程。
TUI 是 Client 公开 API 的纯消费方, 不碰 _http / 内部实现; 任务列表对全局 jobs 客户端按 project_id 过滤。
"""

from __future__ import annotations

import sys
from datetime import datetime
from typing import Any

from rich.text import Text
from textual.app import App, ComposeResult
from textual.binding import Binding
from textual.containers import Horizontal, Vertical, VerticalScroll
from textual.screen import ModalScreen, Screen
from textual.widgets import (
    Button,
    DataTable,
    Footer,
    Header,
    Static,
    TabbedContent,
    TabPane,
)

from ai_annotation.config import load_config
from ai_annotation.models import Dataset, Job, MLBackend, Project

# job 状态 → 着色 (pending 灰 / running 黄 / completed 绿 / failed 红 / cancelled 暗)
_STATUS_STYLE = {
    "pending": "grey50",
    "running": "yellow",
    "completed": "green",
    "failed": "red",
    "cancelled": "dim",
}

# running/pending → completed 翻转时的整行高亮样式
_FLIP_STYLE = "bold black on green"

# ML Backend state → 着色 (connected 绿 / error 红)
_ML_STATE_STYLE = {"connected": "green", "error": "red"}

# 仅 pending/running 的 job 可在 TUI 发起取消 (其余终态后端必拒, 不发请求)
_CANCELLABLE_STATUS = frozenset({"pending", "running"})


def _fmt_dt(dt: datetime | None) -> str:
    return dt.strftime("%m-%d %H:%M:%S") if dt else "-"


def _fmt_size(n: int) -> str:
    if n >= 1 << 30:
        return f"{n / (1 << 30):.1f}GB"
    if n >= 1 << 20:
        return f"{n / (1 << 20):.1f}MB"
    if n >= 1 << 10:
        return f"{n / (1 << 10):.1f}KB"
    return f"{n}B"


def _progress_cell(pct: int) -> str:
    filled = max(0, min(10, pct // 10))
    return f"{'█' * filled}{'░' * (10 - filled)} {pct:>3}%"


def _format_fields(model: Any) -> str:
    """模型字段平铺为 key: value 多行文本 (详情面板用), 长值截断。"""
    lines = []
    for k, v in model.model_dump(mode="json").items():
        s = str(v)
        if len(s) > 200:
            s = s[:200] + "…"
        lines.append(f"{k}: {s}")
    return "\n".join(lines)


def _ml_util(b: MLBackend) -> str:
    gpu = b.health_meta.gpu_info if b.health_meta else None
    pct = gpu.gpu_utilization_percent if gpu else None
    return f"{pct}%" if pct is not None else "-"


def _ml_mem(b: MLBackend) -> str:
    gpu = b.health_meta.gpu_info if b.health_meta else None
    if not gpu or gpu.memory_used_mb is None or gpu.memory_total_mb is None:
        return "-"
    return f"{gpu.memory_used_mb}/{gpu.memory_total_mb}MB"


def _ml_backend_detail(b: MLBackend) -> str:
    lines = [
        f"id: {b.id}",
        f"name: {b.name}",
        f"url: {b.url}",
        f"state: {b.state}",
        f"last_checked_at: {_fmt_dt(b.last_checked_at)}",
    ]
    if b.error_message:
        lines.append(f"error_message: {b.error_message}")
    hm = b.health_meta
    if hm:
        if hm.model_version:
            lines.append(f"model_version: {hm.model_version}")
        gpu = hm.gpu_info
        if gpu:
            lines.append(
                f"gpu: {gpu.device_name or '-'} · util {_ml_util(b)} · mem {_ml_mem(b)}"
                f" · temp {gpu.gpu_temperature_celsius or '-'}℃ · power {gpu.gpu_power_watts or '-'}W"
            )
        if hm.host:
            lines.append(
                f"host: cpu {hm.host.container_cpu_percent or '-'}%"
                f" · mem {hm.host.container_memory_percent or '-'}%"
            )
        if hm.cache:
            lines.append(
                f"cache: hit_rate {hm.cache.hit_rate or '-'}"
                f" · size {hm.cache.size or '-'}/{hm.cache.capacity or '-'}"
            )
    return "\n".join(lines)


class ConfirmModal(ModalScreen[bool]):
    """二次确认弹窗: y 确认 / n·esc 取消; dismiss(bool) 回传给 push_screen 回调。"""

    BINDINGS = [
        Binding("y", "confirm", "确认"),
        Binding("n", "cancel", "取消"),
        Binding("escape", "cancel", "取消"),
    ]
    CSS = """
    ConfirmModal {
        align: center middle;
        background: $background 60%;
    }
    #confirm-box {
        width: 64;
        height: auto;
        padding: 1 2;
        border: round $warning;
        border-title-color: $warning;
        border-title-align: center;
        background: $panel;
    }
    #confirm-hint {
        color: $text-muted;
        margin-top: 1;
        text-align: center;
    }
    """

    def __init__(self, prompt: str):
        super().__init__()
        self._prompt = prompt

    def compose(self) -> ComposeResult:
        with Vertical(id="confirm-box") as box:
            box.border_title = "确认操作"
            yield Static(self._prompt, id="confirm-prompt")
            yield Static("[b]y[/b] 确认 · [b]n[/b] / [b]esc[/b] 取消", id="confirm-hint")

    def action_confirm(self) -> None:
        self.dismiss(True)

    def action_cancel(self) -> None:
        self.dismiss(False)


def _job_detail(job: Job) -> str:
    lines = [
        f"id: {job.id}",
        f"kind: {job.kind}",
        f"status: {job.status}",
        f"progress: {job.progress_pct}%",
        f"created_at: {_fmt_dt(job.created_at)}",
    ]
    if job.error_message:
        lines.append(f"error_message: {job.error_message}")
    if job.result:
        lines.append(f"result: {job.result}")
        if job.result.get("download_url"):
            lines.append(f"导出包地址: {job.result['download_url']}")
            lines.append("提示: 用 client.exports.download(job_id, dest) 下载到本地")
    return "\n".join(lines)


# 详情子屏共用样式: 面包屑 dock 顶, 正文可滚占 1fr, 动作栏 + Footer 包进 dock 底容器
_DETAIL_CSS = """
.breadcrumb {
    dock: top;
    height: 1;
    padding: 0 1;
    background: $panel;
    color: $accent;
    text-style: bold;
}
.detail-body {
    height: 1fr;
    padding: 1 2;
    border: round $secondary 40%;
    border-title-color: $secondary;
}
.screen-bottom {
    dock: bottom;
    height: 2;
}
.action-bar {
    height: 1;
    padding: 0 1;
    align: left middle;
}
.action-bar Button {
    height: 1;
    min-width: 0;
    border: none;
    padding: 0 1;
    margin-right: 1;
}
"""


class DetailScreen(Screen[None]):
    """通用只读详情子路由: 面包屑 + 正文 + 动作栏 (可选写动作经回调)。

    actions: [(button_id, label, variant)]; 点击经 on_action(button_id) 回调宿主处理。
    """

    BINDINGS = [Binding("escape", "back", "返回"), Binding("q", "back", "返回")]
    CSS = _DETAIL_CSS

    def __init__(
        self,
        crumb: str,
        body: str,
        title: str = "详情",
        actions: list[tuple[str, str, str]] | None = None,
        on_action: Any = None,
    ):
        super().__init__()
        self._crumb = crumb
        self._body = body
        self._dtitle = title
        self._actions = actions or []
        self._on_action = on_action

    def compose(self) -> ComposeResult:
        yield Static(f"aap tui ▸ {self._crumb}", classes="breadcrumb")
        with VerticalScroll(classes="detail-body") as box:
            box.border_title = self._dtitle
            yield Static(self._body, id="detail-body")
        with Vertical(classes="screen-bottom"):
            with Horizontal(classes="action-bar"):
                yield Button("◀ 返回", id="back", variant="primary")
                for bid, label, variant in self._actions:
                    yield Button(label, id=bid, variant=variant)  # type: ignore[arg-type]
            yield Footer()

    def action_back(self) -> None:
        self.dismiss()

    def on_button_pressed(self, event: Button.Pressed) -> None:
        if event.button.id == "back":
            self.dismiss()
        elif self._on_action is not None and event.button.id is not None:
            self._on_action(event.button.id)


class ProjectDetailScreen(Screen[None]):
    """项目下钻子路由: 概览 / 本项目任务 / 本项目 Backend 三个 scoped 子 tab。

    任务列表对全局 jobs.list() 客户端按 project_id 过滤; backend 走 project-scoped 接口。
    导出动作复用宿主 App 的确认 + 导出路径。
    """

    BINDINGS = [
        Binding("escape", "back", "返回"),
        Binding("r", "refresh", "刷新"),
        Binding("e", "export", "导出"),
    ]
    CSS = (
        _DETAIL_CSS
        + """
    ProjectDetailScreen DataTable {
        height: 1fr;
        border: round $accent 30%;
        border-title-color: $accent;
        border-title-align: left;
        padding: 0 1;
    }
    """
    )

    def __init__(self, client: Any, project: Project):
        super().__init__()
        self._client = client
        self._project = project
        self._jobs: dict[str, Job] = {}
        self._backends: dict[str, MLBackend] = {}
        self._cursor: dict[str, str] = {}

    def compose(self) -> ComposeResult:
        p = self._project
        yield Static(
            f"aap tui ▸ 项目 {p.display_id} · {p.name}", classes="breadcrumb"
        )
        with TabbedContent(id="pd-tabs"):
            with TabPane("📋 概览", id="pd-overview"):
                yield Static(
                    _project_overview(p), id="pd-overview-body", classes="detail-body"
                )
            with TabPane("⚙ 任务", id="pd-jobs"):
                yield DataTable(id="pd-jobs-table", cursor_type="row", zebra_stripes=True)
            with TabPane("🖥 Backends", id="pd-backends"):
                yield DataTable(
                    id="pd-backends-table", cursor_type="row", zebra_stripes=True
                )
        with Vertical(classes="screen-bottom"):
            with Horizontal(classes="action-bar"):
                yield Button("◀ 返回", id="back", variant="primary")
                yield Button("⬇ 导出", id="export", variant="success")
                yield Button("🔄 刷新", id="refresh", variant="default")
            yield Footer()

    def on_mount(self) -> None:
        jt = self.query_one("#pd-jobs-table", DataTable)
        jt.add_columns("kind", "status", "progress", "created_at")
        jt.border_title = "本项目任务"
        bt = self.query_one("#pd-backends-table", DataTable)
        bt.add_columns("name", "state", "model_version", "GPU", "显存", "last_checked")
        bt.border_title = "本项目 Backend"
        self.query_one("#pd-overview-body", Static).border_title = "概览"
        self._load()

    def _load(self) -> None:
        self.run_worker(self._load_worker, thread=True, exclusive=True, group="pd-load")

    def _load_worker(self) -> None:
        pid = str(self._project.id)
        try:
            jobs = [
                j
                for j in self._client.jobs.list(limit=100).items
                if str(j.project_id) == pid
            ]
            backends = list(self._client.ml_backends.list(self._project.id))
        except Exception as exc:  # noqa: BLE001 — 错误回主屏状态栏
            self.app.call_from_thread(self.app._set_status, f"项目详情加载失败: {exc}")
            return
        self.app.call_from_thread(self._populate, jobs, backends)

    def _populate(self, jobs: list[Job], backends: list[MLBackend]) -> None:
        self._jobs = {str(j.id): j for j in jobs}
        jt = self.query_one("#pd-jobs-table", DataTable)
        jt.clear()
        for j in jobs:
            status_style = _STATUS_STYLE.get(j.status, "")
            jt.add_row(
                j.kind,
                Text(j.status, style=status_style),
                _progress_cell(j.progress_pct),
                _fmt_dt(j.created_at),
                key=str(j.id),
            )
        jt.border_title = f"本项目任务 · {len(jobs)}"
        self._backends = {str(b.id): b for b in backends}
        bt = self.query_one("#pd-backends-table", DataTable)
        bt.clear()
        for b in backends:
            state_style = _ML_STATE_STYLE.get(b.state, "")
            model_version = (b.health_meta.model_version if b.health_meta else None) or "-"
            bt.add_row(
                b.name,
                Text(b.state, style=state_style),
                model_version,
                _ml_util(b),
                _ml_mem(b),
                _fmt_dt(b.last_checked_at),
                key=str(b.id),
            )
        bt.border_title = f"本项目 Backend · {len(backends)}"

    def action_back(self) -> None:
        self.dismiss()

    def action_refresh(self) -> None:
        self._load()

    def action_export(self) -> None:
        self.app._confirm_and_export(self._project)

    def on_button_pressed(self, event: Button.Pressed) -> None:
        bid = event.button.id
        if bid == "back":
            self.dismiss()
        elif bid == "export":
            self.app._confirm_and_export(self._project)
        elif bid == "refresh":
            self._load()

    def on_data_table_row_highlighted(self, event: DataTable.RowHighlighted) -> None:
        if event.control.id is not None and event.row_key.value is not None:
            self._cursor[event.control.id] = event.row_key.value

    def on_data_table_row_selected(self, event: DataTable.RowSelected) -> None:
        key = event.row_key.value
        if key is None:
            return
        if event.control.id == "pd-jobs-table":
            job = self._jobs.get(key)
            if job is not None:
                self.app.push_job_detail(job)
        elif event.control.id == "pd-backends-table":
            backend = self._backends.get(key)
            if backend is not None:
                self.app.push_screen(
                    DetailScreen(
                        f"项目 {self._project.display_id} ▸ Backend {backend.name}",
                        _ml_backend_detail(backend),
                        title="Backend 详情",
                    )
                )


def _project_overview(p: Project) -> str:
    """项目概览正文: 关键字段 + 进度 (total/completed 是服务端附加字段, 可能缺失)。"""
    total = getattr(p, "total_tasks", None)
    done = getattr(p, "completed_tasks", None)
    lines = [
        f"display_id: {p.display_id}",
        f"name: {p.name}",
        f"type_key: {p.type_key}",
        f"data_type: {p.data_type}",
        f"status: {p.status}",
        f"created_at: {_fmt_dt(p.created_at)}",
    ]
    if total is not None and done is not None:
        pct = int(done / total * 100) if total else 0
        lines.append(f"进度: {done}/{total}  {_progress_cell(pct)}")
    return "\n".join(lines)


class AapTuiApp(App[None]):
    """监控面板主 App。client 由构造方注入 (测试可传 stub)。"""

    TITLE = "aap tui"
    SUB_TITLE = "标注平台监控面板"
    # 内置 nord 主题做基线配色, 不自造调色板; 全程走主题变量 ($accent/$panel/$text-muted)
    theme = "nord"
    CSS = """
    DataTable {
        height: 1fr;
        border: round $accent 30%;
        border-title-color: $accent;
        border-title-align: left;
        padding: 0 1;
    }
    DataTable:focus {
        border: round $accent;
    }
    .action-bar {
        height: 1;
        padding: 0 1;
        align: left middle;
    }
    .action-bar Button {
        height: 1;
        min-width: 0;
        border: none;
        padding: 0 1;
        margin-right: 1;
    }
    #bottom-bar {
        dock: bottom;
        height: 2;
    }
    #status-bar {
        height: 1;
        padding: 0 1;
        background: $panel;
        color: $text-muted;
    }
    """
    BINDINGS = [
        Binding("r", "refresh", "刷新", tooltip="刷新当前 tab"),
        Binding("o", "open", "打开", tooltip="下钻选中行详情"),
        Binding("e", "export", "导出", tooltip="导出选中项目 (仅 Projects)"),
        Binding("c", "cancel_job", "取消", tooltip="取消选中 job (仅 Jobs)"),
        Binding("q", "quit", "退出"),
    ]

    def __init__(self, client: Any, base_url: str = "", poll_interval: float = 3.0):
        super().__init__()
        self._client = client
        self._base_url = base_url
        self._poll_interval = poll_interval
        self._hint = f"{base_url} · jobs 每 {poll_interval:g}s 轮询"
        # 最近一次成功渲染的时刻 (状态栏展示), 给「数据是否新鲜」的反馈
        self._last_refresh = ""
        # row key (str(id)) → 模型, 供下钻详情查找
        self._projects: dict[str, Project] = {}
        self._datasets: dict[str, Dataset] = {}
        self._jobs: dict[str, Job] = {}
        self._ml_backends: dict[str, MLBackend] = {}
        # 上一轮 job 状态, 用于检测 → completed 翻转
        self._job_prev: dict[str, str] = {}
        # 各表当前高亮行 key (table id → key), 供动作键定位选中行
        self._cursor: dict[str, str] = {}

    def compose(self) -> ComposeResult:
        yield Header(show_clock=True)
        with TabbedContent(id="tabs"):
            with TabPane("📁 Projects", id="tab-projects"):
                with Horizontal(classes="action-bar"):
                    yield Button("🔄 刷新", id="proj-refresh", variant="default")
                    yield Button("↳ 打开", id="proj-open", variant="primary")
                    yield Button("⬇ 导出", id="proj-export", variant="success")
                yield DataTable(id="projects-table", cursor_type="row", zebra_stripes=True)
            with TabPane("🗂 Datasets", id="tab-datasets"):
                with Horizontal(classes="action-bar"):
                    yield Button("🔄 刷新", id="ds-refresh", variant="default")
                    yield Button("↳ 打开", id="ds-open", variant="primary")
                yield DataTable(id="datasets-table", cursor_type="row", zebra_stripes=True)
            with TabPane("⚙ Jobs", id="tab-jobs"):
                with Horizontal(classes="action-bar"):
                    yield Button("🔄 刷新", id="jobs-refresh", variant="default")
                    yield Button("↳ 打开", id="jobs-open", variant="primary")
                    yield Button("✖ 取消", id="jobs-cancel", variant="error")
                yield DataTable(id="jobs-table", cursor_type="row", zebra_stripes=True)
            with TabPane("🖥 ML Backends", id="tab-ml-backends"):
                with Horizontal(classes="action-bar"):
                    yield Button("🔄 刷新", id="ml-refresh", variant="default")
                    yield Button("↳ 打开", id="ml-open", variant="primary")
                yield DataTable(
                    id="ml-backends-table", cursor_type="row", zebra_stripes=True
                )
        # 底栏: status-bar(动态信息) 在上, Footer(上下文感知按键) 在下
        with Vertical(id="bottom-bar"):
            yield Static(self._hint, id="status-bar")
            yield Footer()

    def on_mount(self) -> None:
        projects_table = self.query_one("#projects-table", DataTable)
        projects_table.add_columns("display_id", "name", "status", "进度(完成/总数)")
        projects_table.border_title = "项目"
        datasets_table = self.query_one("#datasets-table", DataTable)
        datasets_table.add_columns(
            "display_id", "name", "data_type", "条目数", "大小", "created_at"
        )
        datasets_table.border_title = "数据集"
        jobs_table = self.query_one("#jobs-table", DataTable)
        jobs_table.add_columns("kind", "status", "progress", "created_at")
        jobs_table.border_title = "异步任务"
        ml_table = self.query_one("#ml-backends-table", DataTable)
        ml_table.add_columns(
            "name", "项目", "state", "model_version", "GPU", "显存", "last_checked"
        )
        ml_table.border_title = "ML Backend"
        self._refresh_projects()
        self._refresh_datasets()
        self._refresh_jobs()
        self._refresh_ml_backends()
        self.set_interval(self._poll_interval, self._refresh_jobs)
        # ML Backends N+1 聚合较重, 仅在该 tab 激活时按 5s 轮询 (见 _tick_ml_backends)
        self.set_interval(5.0, self._tick_ml_backends)

    # ---- 上下文感知按键: e 仅 Projects / c 仅 Jobs, 否则 Footer 灰掉 ----

    def check_action(self, action: str, _parameters: tuple[object, ...]) -> bool | None:
        """Textual 钩子: 返回 False 时该 binding 在 Footer 不展示且不触发。"""
        # 子屏 (详情路由) 激活时, 主屏动作键不该出现在子屏 footer, 也不该触发
        if len(self.screen_stack) > 1 and action in (
            "refresh",
            "open",
            "export",
            "cancel_job",
        ):
            return False
        try:
            active = self.query_one("#tabs", TabbedContent).active
        except Exception:  # noqa: BLE001 — 挂载早期 tabs 可能还不在
            return True
        if action == "export":
            return active == "tab-projects"
        if action == "cancel_job":
            return active == "tab-jobs"
        return True

    def on_tabbed_content_tab_activated(self) -> None:
        # 切 tab 后让 Footer 重算 e/c 的可用性
        self.refresh_bindings()

    # ---- 刷新调度 (UI 线程发起, 网络调用在 thread worker) ----

    def action_refresh(self) -> None:
        """r: 刷新当前激活 tab。"""
        active = self.query_one("#tabs", TabbedContent).active
        if active == "tab-projects":
            self._refresh_projects()
        elif active == "tab-datasets":
            self._refresh_datasets()
        elif active == "tab-ml-backends":
            self._refresh_ml_backends()
        else:
            self._refresh_jobs()

    def _refresh_projects(self) -> None:
        self.run_worker(self._load_projects, thread=True, exclusive=True, group="projects")

    def _refresh_datasets(self) -> None:
        self.run_worker(self._load_datasets, thread=True, exclusive=True, group="datasets")

    def _refresh_jobs(self) -> None:
        self.run_worker(self._load_jobs, thread=True, exclusive=True, group="jobs")

    def _refresh_ml_backends(self) -> None:
        self.run_worker(
            self._load_ml_backends, thread=True, exclusive=True, group="ml-backends"
        )

    def _tick_ml_backends(self) -> None:
        """定时器: 仅当 ML Backends tab 激活时才发起 N+1 聚合刷新。"""
        if self.query_one("#tabs", TabbedContent).active == "tab-ml-backends":
            self._refresh_ml_backends()

    # ---- thread workers: 阻塞网络调用, 结果经 call_from_thread 回 UI ----

    def _load_projects(self) -> None:
        try:
            projects = self._client.projects.list()
        except Exception as exc:  # noqa: BLE001 — 网络/认证错误统一进状态栏
            self.call_from_thread(self._set_status, f"projects 加载失败: {exc}")
            return
        self.call_from_thread(self._render_projects, projects)

    def _load_datasets(self) -> None:
        try:
            page = self._client.datasets.list(limit=100)
        except Exception as exc:  # noqa: BLE001
            self.call_from_thread(self._set_status, f"datasets 加载失败: {exc}")
            return
        self.call_from_thread(self._render_datasets, page.items)

    def _load_jobs(self) -> None:
        try:
            page = self._client.jobs.list(limit=50)
        except Exception as exc:  # noqa: BLE001
            self.call_from_thread(self._set_status, f"jobs 加载失败: {exc}")
            return
        self.call_from_thread(self._render_jobs, page.items)

    def _load_ml_backends(self) -> None:
        """ml-backends 列表是 project-scoped: 遍历项目逐个聚合 (N+1, 单 worker 内串行)。"""
        try:
            projects = self._client.projects.list()
            rows: list[tuple[Project, MLBackend]] = []
            for p in projects:
                for b in self._client.ml_backends.list(p.id):
                    rows.append((p, b))
        except Exception as exc:  # noqa: BLE001
            self.call_from_thread(self._set_status, f"ml-backends 加载失败: {exc}")
            return
        self.call_from_thread(self._render_ml_backends, rows)

    # ---- 渲染 (UI 线程) ----

    def _hint_line(self) -> str:
        return f"{self._hint} · 刷新 {self._last_refresh}" if self._last_refresh else self._hint

    def _set_status(self, msg: str) -> None:
        bar = self.query_one("#status-bar", Static)
        hint = self._hint_line()
        bar.update(f"{msg} · {hint}" if msg else hint)

    def _mark_refreshed(self) -> None:
        """记录刷新时刻并重绘状态栏默认行 (瞬态消息由其后的 _set_status 覆盖)。"""
        self._last_refresh = datetime.now().strftime("%H:%M:%S")
        self._set_status("")

    @staticmethod
    def _count_title(label: str, n: int) -> str:
        return f"{label} · {n}"

    def _render_projects(self, projects: list[Project]) -> None:
        table = self.query_one("#projects-table", DataTable)
        self._projects = {str(p.id): p for p in projects}
        table.clear()
        for p in projects:
            # total_tasks/completed_tasks 是服务端附加字段 (extra="allow"), 可能缺失
            total = getattr(p, "total_tasks", None)
            done = getattr(p, "completed_tasks", None)
            progress = f"{done}/{total}" if total is not None else "-"
            table.add_row(p.display_id, p.name, p.status, progress, key=str(p.id))
        table.border_title = self._count_title("项目", len(projects))
        self._mark_refreshed()

    def _render_datasets(self, datasets: list[Dataset]) -> None:
        table = self.query_one("#datasets-table", DataTable)
        self._datasets = {str(d.id): d for d in datasets}
        table.clear()
        for d in datasets:
            table.add_row(
                d.display_id,
                d.name,
                d.data_type,
                str(d.file_count),
                _fmt_size(d.total_size),
                _fmt_dt(d.created_at),
                key=str(d.id),
            )
        table.border_title = self._count_title("数据集", len(datasets))
        self._mark_refreshed()

    def _render_jobs(self, jobs: list[Job]) -> None:
        table = self.query_one("#jobs-table", DataTable)
        # running/pending → completed 翻转的行整行高亮
        flipped = {
            str(j.id)
            for j in jobs
            if j.status == "completed"
            and self._job_prev.get(str(j.id)) in ("pending", "running")
        }
        self._job_prev = {str(j.id): j.status for j in jobs}
        self._jobs = {str(j.id): j for j in jobs}
        table.clear()
        for j in jobs:
            key = str(j.id)
            if key in flipped:
                style = _FLIP_STYLE
                status_text = f"{j.status} ✔"
            else:
                style = ""
                status_text = j.status
            status_style = style or _STATUS_STYLE.get(j.status, "")
            table.add_row(
                Text(j.kind, style=style),
                Text(status_text, style=status_style),
                Text(_progress_cell(j.progress_pct), style=style),
                Text(_fmt_dt(j.created_at), style=style),
                key=key,
            )
        table.border_title = self._count_title("异步任务", len(jobs))
        self._mark_refreshed()
        if flipped:
            self._set_status(f"{len(flipped)} 个 job 刚完成")
            self.notify(f"{len(flipped)} 个 job 刚完成", severity="information")

    def _render_ml_backends(self, rows: list[tuple[Project, MLBackend]]) -> None:
        table = self.query_one("#ml-backends-table", DataTable)
        self._ml_backends = {str(b.id): b for _, b in rows}
        table.clear()
        for project, b in rows:
            state_style = _ML_STATE_STYLE.get(b.state, "")
            model_version = (b.health_meta.model_version if b.health_meta else None) or "-"
            table.add_row(
                b.name,
                project.display_id,
                Text(b.state, style=state_style),
                model_version,
                _ml_util(b),
                _ml_mem(b),
                _fmt_dt(b.last_checked_at),
                key=str(b.id),
            )
        table.border_title = self._count_title("ML Backend", len(rows))
        self._mark_refreshed()

    # ---- 下钻: 打开选中行的详情子路由 (回车 / o / 「打开」按钮) ----

    def action_open(self) -> None:
        """o: 对当前激活 tab 的高亮行 push 详情子屏。"""
        active = self.query_one("#tabs", TabbedContent).active
        table_id = {
            "tab-projects": "projects-table",
            "tab-datasets": "datasets-table",
            "tab-jobs": "jobs-table",
            "tab-ml-backends": "ml-backends-table",
        }.get(active)
        if table_id is None:
            return
        key = self._cursor.get(table_id)
        if key is None:
            self._set_status("请先选中一行再打开")
            return
        self._open_row(table_id, key)

    def _open_row(self, table_id: str, key: str) -> None:
        """按表 + row key push 对应详情子屏。"""
        if table_id == "projects-table":
            project = self._projects.get(key)
            if project is not None:
                self.push_screen(ProjectDetailScreen(self._client, project))
        elif table_id == "datasets-table":
            dataset = self._datasets.get(key)
            if dataset is not None:
                self.push_screen(
                    DetailScreen(
                        f"数据集 {dataset.display_id} · {dataset.name}",
                        _format_fields(dataset),
                        title="数据集详情",
                    )
                )
        elif table_id == "jobs-table":
            job = self._jobs.get(key)
            if job is not None:
                self.push_job_detail(job)
        elif table_id == "ml-backends-table":
            backend = self._ml_backends.get(key)
            if backend is not None:
                self.push_screen(
                    DetailScreen(
                        f"Backend {backend.name}",
                        _ml_backend_detail(backend),
                        title="Backend 详情",
                    )
                )

    def push_job_detail(self, job: Job) -> None:
        """push job 详情子屏; pending/running 时带「取消」动作按钮。"""
        actions: list[tuple[str, str, str]] = []
        if job.status in _CANCELLABLE_STATUS:
            actions = [("cancel", "✖ 取消", "error")]
        self.push_screen(
            DetailScreen(
                f"任务 {job.kind} ({job.status})",
                _job_detail(job),
                title="任务详情",
                actions=actions,
                on_action=lambda _bid: self._confirm_and_cancel(job),
            )
        )

    def on_button_pressed(self, event: Button.Pressed) -> None:
        """主屏各 tab 动作栏按钮 → 派发到对应 action (与键盘等价)。"""
        bid = event.button.id or ""
        if bid.endswith("-refresh"):
            self.action_refresh()
        elif bid.endswith("-open"):
            self.action_open()
        elif bid == "proj-export":
            self.action_export()
        elif bid == "jobs-cancel":
            self.action_cancel_job()

    # ---- 动作: 导出 (Projects) / 取消 (Jobs), 均经二次确认 ----

    def action_export(self) -> None:
        """e: 对 Projects tab 选中项目发起导出 (target=aap_json)。"""
        if self.query_one("#tabs", TabbedContent).active != "tab-projects":
            self._set_status("导出仅在 Projects tab 可用")
            return
        key = self._cursor.get("projects-table")
        project = self._projects.get(key) if key else None
        if project is None:
            self._set_status("请先在 Projects 选中一个项目")
            return
        self._confirm_and_export(project)

    def action_cancel_job(self) -> None:
        """c: 对 Jobs tab 选中且处于 pending/running 的 job 发起软取消。"""
        if self.query_one("#tabs", TabbedContent).active != "tab-jobs":
            self._set_status("取消仅在 Jobs tab 可用")
            return
        key = self._cursor.get("jobs-table")
        job = self._jobs.get(key) if key else None
        if job is None:
            self._set_status("请先在 Jobs 选中一个任务")
            return
        self._confirm_and_cancel(job)

    def _confirm_and_export(self, project: Project) -> None:
        """对给定项目弹确认 → 导出 (主屏动作键 / 项目详情屏共用)。"""

        def _on_confirm(ok: bool | None) -> None:
            if ok:
                self.run_worker(
                    lambda: self._do_export(project), thread=True, group="action"
                )

        self.push_screen(
            ConfirmModal(f"导出项目 {project.display_id} {project.name} (target=aap_json)?"),
            _on_confirm,
        )

    def _confirm_and_cancel(self, job: Job) -> None:
        """对给定 job 弹确认 → 软取消 (主屏动作键 / 任务详情屏共用)。终态 job 直接提示。"""
        if job.status not in _CANCELLABLE_STATUS:
            self._set_status(f"job 处于 {job.status}, 不可取消 (仅 pending/running 可取消)")
            return

        def _on_confirm(ok: bool | None) -> None:
            if ok:
                self.run_worker(
                    lambda: self._do_cancel(job), thread=True, group="action"
                )

        self.push_screen(
            ConfirmModal(f"取消 job {job.kind} ({job.status})? 取消是协作式, 终态稍后落定。"),
            _on_confirm,
        )

    def _do_export(self, project: Project) -> None:
        try:
            job_id = self._client.exports.create(project.id, targets=["aap_json"])
        except Exception as exc:  # noqa: BLE001
            self.call_from_thread(self._set_status, f"导出发起失败: {exc}")
            return
        self.call_from_thread(
            self._set_status, f"导出 job 已创建 ({job_id}), 见 Jobs tab"
        )
        self.call_from_thread(self._refresh_jobs)

    def _do_cancel(self, job: Job) -> None:
        try:
            self._client.jobs.cancel(job.id)
        except Exception as exc:  # noqa: BLE001
            self.call_from_thread(self._set_status, f"取消失败: {exc}")
            return
        self.call_from_thread(self._set_status, f"已请求取消 job {job.id}")
        self.call_from_thread(self._refresh_jobs)

    # ---- 行高亮跟踪 (供动作键定位) + 行选中 (回车/点击) → 下钻详情 ----

    def on_data_table_row_highlighted(self, event: DataTable.RowHighlighted) -> None:
        if event.control.id is not None and event.row_key.value is not None:
            self._cursor[event.control.id] = event.row_key.value

    def on_data_table_row_selected(self, event: DataTable.RowSelected) -> None:
        if event.control.id is not None and event.row_key.value is not None:
            self._open_row(event.control.id, event.row_key.value)


def run() -> None:
    """`aap tui` 入口: 配置缺失时打印提示退出, 不进 app。"""
    from ai_annotation.client import Client

    base_url, api_key = load_config()
    if not base_url or not api_key:
        print(
            "未配置 base_url / api_key: 请先 `aap login`, "
            "或设置 AAP_BASE_URL / AAP_API_KEY 环境变量",
            file=sys.stderr,
        )
        raise SystemExit(1)
    client = Client(base_url=base_url, api_key=api_key)
    try:
        AapTuiApp(client, base_url=base_url).run()
    finally:
        client.close()
