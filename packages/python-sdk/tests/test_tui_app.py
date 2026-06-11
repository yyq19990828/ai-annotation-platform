"""TUI 面板 headless 测试: Textual Pilot 驱动 + stub client (不发真实网络)。"""

from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

import pytest
from textual.widgets import DataTable, Static, TabbedContent, TabPane

from ai_annotation.models import Dataset, Job, JobPage, Page, Project
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

    def list(self, **kw):
        if len(self._pages) > 1:
            return self._pages.pop(0)
        return self._pages[0]


class _StubClient:
    def __init__(self, projects, datasets, job_pages):
        self.projects = _StubProjects(projects)
        self.datasets = _StubDatasets(datasets)
        self.jobs = _StubJobs(job_pages)

    def close(self):
        pass


def _make_app(job_statuses=("running",)) -> AapTuiApp:
    pages = [JobPage(items=[_job(s)], total=1) for s in job_statuses]
    client = _StubClient([_project()], [_dataset()], pages)
    return AapTuiApp(client, base_url=BASE)


async def _settle(app, pilot):
    """等 thread worker 落地并刷新一帧。"""
    await app.workers.wait_for_complete()
    await pilot.pause()


async def test_renders_three_tabs_and_status_bar():
    app = _make_app()
    async with app.run_test(size=(100, 30)) as pilot:
        await _settle(app, pilot)
        assert [t.id for t in app.query(TabPane)] == [
            "tab-projects",
            "tab-datasets",
            "tab-jobs",
        ]
        bar = app.query_one("#status-bar", Static)
        assert BASE in str(bar.renderable)


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
        assert "完成" in str(bar.renderable)


async def test_quit_key():
    app = _make_app()
    async with app.run_test(size=(100, 30)) as pilot:
        await _settle(app, pilot)
        await pilot.press("q")
    assert app.return_code == 0
