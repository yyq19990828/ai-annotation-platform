"""aap CLI 入口: 命令组装 (v0.15.2)。

需要 cli extras: pip install 'ai-annotation-sdk[cli]'。
"""

from __future__ import annotations

import typer

from ai_annotation import __version__
from ai_annotation.cli import datasets, export, jobs, login, predictions, projects

app = typer.Typer(name="aap", help="AI 标注平台命令行工具", no_args_is_help=True)
app.command(name="login")(login.login)
app.add_typer(projects.app, name="projects")
app.add_typer(datasets.app, name="datasets")
app.add_typer(predictions.app, name="predictions")
app.add_typer(jobs.app, name="jobs")
app.add_typer(export.app, name="export")


def _version_callback(value: bool) -> None:
    if value:
        typer.echo(__version__)
        raise typer.Exit()


@app.callback()
def _main(
    version: bool = typer.Option(
        False, "--version", callback=_version_callback, is_eager=True, help="显示版本号"
    ),
) -> None:
    """AI 标注平台 CLI。"""


@app.command()
def tui() -> None:
    """启动 TUI 面板 (需要安装 tui extras)。"""
    try:
        from ai_annotation.tui.app import run  # type: ignore[import-not-found]
    except ImportError:
        typer.echo("TUI 依赖未安装, 请先: pip install 'ai-annotation-sdk[tui]'")
        raise typer.Exit(code=1) from None
    run()
