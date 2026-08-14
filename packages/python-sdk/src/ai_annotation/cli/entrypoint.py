"""Console-script shim that keeps core-only installs readable."""

from __future__ import annotations

import sys


def main() -> None:
    try:
        from ai_annotation.cli.main import app
    except ModuleNotFoundError as exc:
        if exc.name not in {"rich", "typer"}:
            raise
        print(
            "aap CLI 依赖未安装；请运行: pip install 'ai-annotation-sdk[cli]'",
            file=sys.stderr,
        )
        raise SystemExit(1) from None
    app()
