"""aap CLI 骨架 (v0.15.2)。完整命令集 (login / projects / datasets / ...) 由后续版本补齐。

需要 cli extras: pip install 'ai-annotation-sdk[cli]'。
"""

from __future__ import annotations

import typer

from ai_annotation import __version__

app = typer.Typer(name="aap", help="AI 标注平台命令行工具", no_args_is_help=True)


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
