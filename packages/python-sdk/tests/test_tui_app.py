"""TUI 面板 headless 测试: Textual Pilot 驱动 + stub client (不发真实网络)。"""

from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

import pytest
from textual.widgets import DataTable, Static, TabbedContent, TabPane

from ai_annotation.models import Dataset, HealthMeta, Job, JobPage, MLBackend, Page, Project
from ai_annotation.tui.app import AapTuiApp

# pyproject 未配 asyncio_mode=auto, 用模块级 marker 驱动 async 测试
pytestmark = pytest.mark.asyncio

BASE = "http://testserver"
JOB_ID = uuid4()


def _project() -> Project:
    # total_tasks / completed_tasks 是服务端附加字段, 靠 extra="allow" 透传
    return Project(
        id=uuid4(),
        display_id="P-1",
        name="demo-project",
        type_key="detection",
        data_type="image",
        status="active",
        total_tasks=10,
        completed_tasks=3,
    )


def _dataset() -> Dataset:
    return Dataset(
        id=uuid4(),
        display_id="D-1",
        name="demo-dataset",
        data_type="image",
        file_count=5,
        total_size=2048,
    )


def _job(status: str, **extra) -> Job:
    return Job(
        id=JOB_ID,
        kind="export",
        status=status,
        progress_pct=40,
        created_at=datetime(2026, 6, 11, tzinfo=timezone.utc),
        **extra,
    )


def _ml_backend(project_id, state="connected") -> MLBackend:
    return MLBackend(
        id=uuid4(),
        project_id=project_id,
        name="sam2-backend",
        url="http://gpu-host:9000",
        state=state,
        health_meta=HealthMeta(
            model_version="v1.2",
            gpu_info={"gpu_utilization_percent": 73, "memory_used_mb": 8000, "memory_total_mb": 24000},
        ),
        last_checked_at=datetime(2026, 6, 11, tzinfo=timezone.utc),
    )


class _StubProjects:
    def __init__(self, items):
        self._items = items

    def list(self, **kw):
        return self._items


class _StubDatasets:
    def __init__(self, items):
        self._items = items

    def list(self, **kw):
        return Page[Dataset](items=self._items, total=len(self._items), limit=50, offset=0)


class _StubJobs:
    """每次 list 前进一页, 停在最后一页 — 模拟轮询时状态推进。"""

    def __init__(self, pages):
        self._pages = list(pages)
        self.cancelled: list = []

    def list(self, **kw):
        if len(self._pages) > 1:
            return self._pages.pop(0)
        return self._pages[0]

    def cancel(self, job_id):
        self.cancelled.append(job_id)


class _StubExports:
    def __init__(self):
        self.created: list = []

    def create(self, project_id, targets):
        self.created.append((project_id, targets))
        return str(uuid4())


class _StubMLBackends:
    """按 project 返回 backend (聚合时逐项目调用)。"""

    def __init__(self, by_project):
        self._by_project = by_project

    def list(self, project_id):
        return self._by_project.get(project_id, [])


class _StubClient:
    def __init__(self, projects, datasets, job_pages, ml_by_project=None):
        self.projects = _StubProjects(projects)
        self.datasets = _StubDatasets(datasets)
        self.jobs = _StubJobs(job_pages)
        self.exports = _StubExports()
        self.ml_backends = _StubMLBackends(ml_by_project or {})

    def close(self):
        pass


def _make_app(job_statuses=("running",), with_ml=False) -> AapTuiApp:
    pages = [JobPage(items=[_job(s)], total=1) for s in job_statuses]
    project = _project()
    ml_by_project = {project.id: [_ml_backend(project.id)]} if with_ml else {}
    client = _StubClient([project], [_dataset()], pages, ml_by_project)
    return AapTuiApp(client, base_url=BASE)


async def _settle(app, pilot):
    """等 thread worker 落地并刷新一帧。"""
    await app.workers.wait_for_complete()
    await pilot.pause()


async def test_renders_four_tabs_and_status_bar():
    app = _make_app()
    async with app.run_test(size=(100, 30)) as pilot:
        await _settle(app, pilot)
        assert [t.id for t in app.query(TabPane)] == [
            "tab-projects",
            "tab-datasets",
            "tab-jobs",
            "tab-ml-backends",
        ]
        bar = app.query_one("#status-bar", Static)
        assert BASE in str(bar.render())


async def test_tables_show_stub_rows():
    app = _make_app()
    async with app.run_test(size=(100, 30)) as pilot:
        await _settle(app, pilot)
        projects = app.query_one("#projects-table", DataTable)
        assert projects.row_count == 1
        assert projects.get_row_at(0)[:4] == ["P-1", "demo-project", "active", "3/10"]
        datasets = app.query_one("#datasets-table", DataTable)
        assert datasets.get_row_at(0)[1] == "demo-dataset"
        jobs = app.query_one("#jobs-table", DataTable)
        assert jobs.row_count == 1
        row = jobs.get_row_at(0)
        assert row[0].plain == "export"
        assert row[1].plain == "running"
        assert "40%" in row[2].plain


async def test_refresh_reflects_status_flip():
    app = _make_app(job_statuses=("running", "completed"))
    async with app.run_test(size=(100, 30)) as pilot:
        await _settle(app, pilot)
        jobs = app.query_one("#jobs-table", DataTable)
        assert jobs.get_row_at(0)[1].plain == "running"
        # 切到 Jobs tab 后 r 触发立即刷新 (与 3s 轮询同一条加载路径)
        app.query_one("#tabs", TabbedContent).active = "tab-jobs"
        await pilot.pause()
        await pilot.press("r")
        await _settle(app, pilot)
        assert "completed" in jobs.get_row_at(0)[1].plain
        # 翻转行高亮 + 状态栏提示
        assert "✔" in jobs.get_row_at(0)[1].plain
        bar = app.query_one("#status-bar", Static)
        assert "完成" in str(bar.render())


async def test_ml_backends_tab_renders_and_colors():
    app = _make_app(with_ml=True)
    async with app.run_test(size=(120, 30)) as pilot:
        await _settle(app, pilot)
        table = app.query_one("#ml-backends-table", DataTable)
        assert table.row_count == 1
        row = table.get_row_at(0)
        assert row[0] == "sam2-backend"
        assert row[1] == "P-1"
        assert row[2].plain == "connected"
        assert row[2].style == "green"
        assert row[3] == "v1.2"
        assert "73%" in row[4]


async def test_ml_backend_detail_on_enter():
    app = _make_app(with_ml=True)
    async with app.run_test(size=(120, 30)) as pilot:
        await _settle(app, pilot)
        app.query_one("#tabs", TabbedContent).active = "tab-ml-backends"
        await pilot.pause()
        table = app.query_one("#ml-backends-table", DataTable)
        table.focus()
        await pilot.press("enter")
        await pilot.pause()
        detail = str(app.query_one("#ml-detail", Static).render())
        assert "model_version: v1.2" in detail
        assert "util 73%" in detail


async def test_export_action_confirm_triggers_create():
    app = _make_app()
    async with app.run_test(size=(100, 30)) as pilot:
        await _settle(app, pilot)
        # 默认在 Projects tab, 首行已高亮
        await pilot.press("e")
        await pilot.pause()
        await pilot.press("y")  # 确认
        await _settle(app, pilot)
        assert len(app._client.exports.created) == 1
        assert app._client.exports.created[0][1] == ["aap_json"]


async def test_export_action_cancel_does_not_create():
    app = _make_app()
    async with app.run_test(size=(100, 30)) as pilot:
        await _settle(app, pilot)
        await pilot.press("e")
        await pilot.pause()
        await pilot.press("n")  # 放弃
        await _settle(app, pilot)
        assert app._client.exports.created == []


async def test_cancel_action_confirm_triggers_cancel():
    app = _make_app(job_statuses=("running",))
    async with app.run_test(size=(100, 30)) as pilot:
        await _settle(app, pilot)
        app.query_one("#tabs", TabbedContent).active = "tab-jobs"
        await pilot.pause()
        app.query_one("#jobs-table", DataTable).focus()
        await pilot.press("c")
        await pilot.pause()
        await pilot.press("y")
        await _settle(app, pilot)
        assert app._client.jobs.cancelled == [JOB_ID]


async def test_cancel_action_blocked_on_terminal_job():
    app = _make_app(job_statuses=("completed",))
    async with app.run_test(size=(100, 30)) as pilot:
        await _settle(app, pilot)
        app.query_one("#tabs", TabbedContent).active = "tab-jobs"
        await pilot.pause()
        app.query_one("#jobs-table", DataTable).focus()
        await pilot.press("c")
        await pilot.pause()
        # 终态 job 不弹确认框、不发请求, 状态栏给提示
        assert app._client.jobs.cancelled == []
        assert "不可取消" in str(app.query_one("#status-bar", Static).render())


async def test_quit_key():
    app = _make_app()
    async with app.run_test(size=(100, 30)) as pilot:
        await _settle(app, pilot)
        await pilot.press("q")
    assert app.return_code == 0
