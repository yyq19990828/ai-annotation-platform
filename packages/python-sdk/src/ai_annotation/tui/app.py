"""aap tui 监控面板 (Textual, v0.15.2 MVP)。

只读监控三视图: Projects / Datasets / Jobs; jobs 默认 3s 轮询。
SDK Client 是同步 httpx —— 所有网络调用放 thread worker, 经 call_from_thread 回 UI 线程。
TUI 是 Client 公开 API 的纯消费方, 不碰 _http / 内部实现。
"""

from __future__ import annotations

import sys
from datetime import datetime
from typing import Any

from rich.text import Text
from textual.app import App, ComposeResult
from textual.binding import Binding
from textual.widgets import DataTable, Static, TabbedContent, TabPane

from ai_annotation.config import load_config
from ai_annotation.models import Dataset, Job, Project

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


class AapTuiApp(App[None]):
    """监控面板主 App。client 由构造方注入 (测试可传 stub)。"""

    TITLE = "aap tui"
    CSS = """
    DataTable {
        height: 1fr;
    }
    .detail {
        height: auto;
        max-height: 12;
        padding: 0 1;
        border-top: solid $accent;
    }
    #status-bar {
        dock: bottom;
        height: 1;
        padding: 0 1;
        background: $panel;
        color: $text-muted;
    }
    """
    BINDINGS = [
        Binding("r", "refresh", "刷新"),
        Binding("q", "quit", "退出"),
    ]

    def __init__(self, client: Any, base_url: str = "", poll_interval: float = 3.0):
        super().__init__()
        self._client = client
        self._poll_interval = poll_interval
        self._hint = f"{base_url} · r=刷新 q=退出 · jobs 每 {poll_interval:g}s 轮询"
        # row key (str(id)) → 模型, 供详情面板查找
        self._projects: dict[str, Project] = {}
        self._jobs: dict[str, Job] = {}
        # 上一轮 job 状态, 用于检测 → completed 翻转
        self._job_prev: dict[str, str] = {}

    def compose(self) -> ComposeResult:
        with TabbedContent(id="tabs"):
            with TabPane("Projects", id="tab-projects"):
                yield DataTable(id="projects-table", cursor_type="row")
                yield Static("选中行后按回车查看详情", id="project-detail", classes="detail")
            with TabPane("Datasets", id="tab-datasets"):
                yield DataTable(id="datasets-table", cursor_type="row")
            with TabPane("Jobs", id="tab-jobs"):
                yield DataTable(id="jobs-table", cursor_type="row")
                yield Static(
                    "选中行后按回车查看 error / result 详情", id="job-detail", classes="detail"
                )
        yield Static(self._hint, id="status-bar")

    def on_mount(self) -> None:
        self.query_one("#projects-table", DataTable).add_columns(
            "display_id", "name", "status", "进度(完成/总数)"
        )
        self.query_one("#datasets-table", DataTable).add_columns(
            "display_id", "name", "data_type", "条目数", "大小", "created_at"
        )
        self.query_one("#jobs-table", DataTable).add_columns(
            "kind", "status", "progress", "created_at"
        )
        self._refresh_projects()
        self._refresh_datasets()
        self._refresh_jobs()
        self.set_interval(self._poll_interval, self._refresh_jobs)

    # ---- 刷新调度 (UI 线程发起, 网络调用在 thread worker) ----

    def action_refresh(self) -> None:
        """r: 刷新当前激活 tab。"""
        active = self.query_one("#tabs", TabbedContent).active
        if active == "tab-projects":
            self._refresh_projects()
        elif active == "tab-datasets":
            self._refresh_datasets()
        else:
            self._refresh_jobs()

    def _refresh_projects(self) -> None:
        self.run_worker(self._load_projects, thread=True, exclusive=True, group="projects")

    def _refresh_datasets(self) -> None:
        self.run_worker(self._load_datasets, thread=True, exclusive=True, group="datasets")

    def _refresh_jobs(self) -> None:
        self.run_worker(self._load_jobs, thread=True, exclusive=True, group="jobs")

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

    # ---- 渲染 (UI 线程) ----

    def _set_status(self, msg: str) -> None:
        bar = self.query_one("#status-bar", Static)
        bar.update(f"{msg} · {self._hint}" if msg else self._hint)

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

    def _render_datasets(self, datasets: list[Dataset]) -> None:
        table = self.query_one("#datasets-table", DataTable)
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
        if flipped:
            self._set_status(f"{len(flipped)} 个 job 刚完成")

    # ---- 行选中 → 详情面板 ----

    def on_data_table_row_selected(self, event: DataTable.RowSelected) -> None:
        key = event.row_key.value
        if key is None:
            return
        if event.control.id == "projects-table":
            project = self._projects.get(key)
            if project is not None:
                self.query_one("#project-detail", Static).update(_format_fields(project))
        elif event.control.id == "jobs-table":
            job = self._jobs.get(key)
            if job is not None:
                self.query_one("#job-detail", Static).update(_job_detail(job))


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
