"""CLI 公共件: console / --json 裸输出 / 错误处理 / Client 装配。

--json 契约: 该模式下 stdout 只输出裸 JSON (无 rich 装饰 / 进度条),
错误走 stderr 纯文本; 退出码非 0 表示失败。CI / 脚本只应依赖此模式。
"""

from __future__ import annotations

import json
import sys
from contextlib import contextmanager
from typing import Any, Iterator

import httpx
import typer
from rich.console import Console

from ai_annotation import Client
from ai_annotation.config import load_config
from ai_annotation.errors import AAPError, APIStatusError, AuthenticationError

console = Console()
err_console = Console(stderr=True)
# 进度条/spinner 是瞬态 UI 而非命令输出, 走 stderr, 避免污染管道中的 stdout
progress_console = Console(stderr=True)


def print_json(data: Any) -> None:
    """--json 模式输出: 裸 JSON, 无任何 rich 装饰。"""
    typer.echo(json.dumps(data, ensure_ascii=False))


_SPARK_CHARS = "▁▂▃▄▅▆▇█"


def sparkline(values: list[float]) -> str:
    """unicode 块字符趋势条 (CLI 无 Textual 时画时间序列)。空 / 单值降级。"""
    nums = [float(v) for v in values]
    if not nums:
        return ""
    lo, hi = min(nums), max(nums)
    span = hi - lo
    if span <= 0:
        return _SPARK_CHARS[0] * len(nums)
    last = len(_SPARK_CHARS) - 1
    return "".join(_SPARK_CHARS[min(last, int((v - lo) / span * last))] for v in nums)


def print_error(message: str, json_mode: bool = False) -> None:
    """stderr 一行友好错误; --json 模式纯文本, 否则 rich 红色。"""
    if json_mode:
        print(message, file=sys.stderr)
    else:
        err_console.print(f"[red]{message}[/red]")


def confirm_destructive(message: str, yes: bool, json_mode: bool) -> None:
    """破坏性操作确认; JSON 模式禁止 prompt。"""
    if yes:
        return
    if json_mode:
        raise typer.BadParameter("--json 模式执行破坏性操作时必须传 --yes")
    typer.confirm(message, abort=True)


@contextmanager
def cli_errors(json_mode: bool = False) -> Iterator[None]:
    """把 SDK / 网络异常转为一行错误 + exit 1, 不向用户喷 traceback。"""
    try:
        yield
    except AuthenticationError as e:
        print_error(
            f"认证失败 (HTTP 401): {e.detail}; 请先运行 `aap login` 配置有效 API key",
            json_mode,
        )
        raise typer.Exit(code=1) from None
    except APIStatusError as e:
        print_error(f"请求失败 (HTTP {e.status_code}): {e.detail}", json_mode)
        raise typer.Exit(code=1) from None
    except AAPError as e:
        print_error(str(e), json_mode)
        raise typer.Exit(code=1) from None
    except httpx.HTTPError as e:
        print_error(f"网络错误: {e}", json_mode)
        raise typer.Exit(code=1) from None


def get_client(json_mode: bool = False) -> Client:
    """从配置装配 Client; 未配置时提示并 exit 1。"""
    base_url, api_key = load_config()
    if not base_url or not api_key:
        print_error(
            "未配置平台地址 / API key: 请先运行 `aap login`, "
            "或设置环境变量 AAP_BASE_URL / AAP_API_KEY",
            json_mode,
        )
        raise typer.Exit(code=1)
    return Client(base_url=base_url, api_key=api_key)
