"""aap tui 监控面板 (Textual)。

监控四视图: Projects / Datasets / Jobs / ML Backends; jobs 默认 3s 轮询。
轻量动作 (v0.15.8): Projects tab `e` 发起导出, Jobs tab `c` 软取消 job, 均经二次确认弹窗。
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
from textual.containers import Vertical
from textual.screen import ModalScreen
from textual.widgets import DataTable, Static, TabbedContent, TabPane

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
    }
    #confirm-box {
        width: 60;
        height: auto;
        padding: 1 2;
        border: thick $accent;
        background: $panel;
    }
    #confirm-hint {
        color: $text-muted;
        margin-top: 1;
    }
    """

    def __init__(self, prompt: str):
        super().__init__()
        self._prompt = prompt

    def compose(self) -> ComposeResult:
        with Vertical(id="confirm-box"):
            yield Static(self._prompt, id="confirm-prompt")
            yield Static("y 确认 · n / esc 取消", id="confirm-hint")

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
        Binding("e", "export", "导出"),
        Binding("c", "cancel_job", "取消 job"),
        Binding("q", "quit", "退出"),
    ]

    def __init__(self, client: Any, base_url: str = "", poll_interval: float = 3.0):
        super().__init__()
        self._client = client
        self._poll_interval = poll_interval
        self._hint = (
            f"{base_url} · r=刷新 e=导出 c=取消 q=退出 · jobs 每 {poll_interval:g}s 轮询"
        )
        # row key (str(id)) → 模型, 供详情面板查找
        self._projects: dict[str, Project] = {}
        self._jobs: dict[str, Job] = {}
        self._ml_backends: dict[str, MLBackend] = {}
        # 上一轮 job 状态, 用于检测 → completed 翻转
        self._job_prev: dict[str, str] = {}
        # 各表当前高亮行 key (table id → key), 供动作键定位选中行
        self._cursor: dict[str, str] = {}

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
                    "选中行后按回车查看 error / result 详情 · c 取消选中 job",
                    id="job-detail",
                    classes="detail",
                )
            with TabPane("ML Backends", id="tab-ml-backends"):
                yield DataTable(id="ml-backends-table", cursor_type="row")
                yield Static(
                    "选中行后按回车查看 health_meta 详情", id="ml-detail", classes="detail"
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
        self.query_one("#ml-backends-table", DataTable).add_columns(
            "name", "项目", "state", "model_version", "GPU", "显存", "last_checked"
        )
        self._refresh_projects()
        self._refresh_datasets()
        self._refresh_jobs()
        self._refresh_ml_backends()
        self.set_interval(self._poll_interval, self._refresh_jobs)
        # ML Backends N+1 聚合较重, 仅在该 tab 激活时按 5s 轮询 (见 _tick_ml_backends)
        self.set_interval(5.0, self._tick_ml_backends)

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

        def _on_confirm(ok: bool | None) -> None:
            if ok:
                self.run_worker(
                    lambda: self._do_export(project),
                    thread=True,
                    group="action",
                )

        self.push_screen(
            ConfirmModal(f"导出项目 {project.display_id} {project.name} (target=aap_json)?"),
            _on_confirm,
        )

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

    # ---- 行高亮跟踪 (供动作键定位) + 行选中 → 详情面板 ----

    def on_data_table_row_highlighted(self, event: DataTable.RowHighlighted) -> None:
        if event.control.id is not None and event.row_key.value is not None:
            self._cursor[event.control.id] = event.row_key.value

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
        elif event.control.id == "ml-backends-table":
            backend = self._ml_backends.get(key)
            if backend is not None:
                self.query_one("#ml-detail", Static).update(_ml_backend_detail(backend))


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
