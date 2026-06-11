"""aap ml-backends 子命令 (只读监控)。"""

from __future__ import annotations

import typer
from rich.table import Table

from ai_annotation.cli._output import cli_errors, console, get_client, print_json
from ai_annotation.models import MLBackend

app = typer.Typer(help="ML Backend 健康监控 (只读)", no_args_is_help=True)


def _gpu_util(b: MLBackend) -> str:
    gpu = b.health_meta.gpu_info if b.health_meta else None
    pct = gpu.gpu_utilization_percent if gpu else None
    return f"{pct}%" if pct is not None else "-"


def _model_version(b: MLBackend) -> str:
    return (b.health_meta.model_version if b.health_meta else None) or "-"


@app.command("list")
def list_(
    project_id: str = typer.Option(..., "--project", help="项目 ID"),
    json_output: bool = typer.Option(False, "--json", help="输出裸 JSON"),
) -> None:
    """列出某项目挂载的 ML Backend 及健康状态。"""
    with cli_errors(json_output):
        with get_client(json_output) as client:
            backends = client.ml_backends.list(project_id)
    if json_output:
        print_json([b.model_dump(mode="json") for b in backends])
        return
    table = Table()
    table.add_column("名称")
    table.add_column("状态")
    table.add_column("model_version")
    table.add_column("GPU")
    table.add_column("url")
    for b in backends:
        color = "green" if b.state == "connected" else "red"
        table.add_row(
            b.name, f"[{color}]{b.state}[/{color}]", _model_version(b), _gpu_util(b), b.url
        )
    console.print(table)


@app.command("get")
def get(
    backend_id: str = typer.Argument(..., help="ML Backend ID"),
    project_id: str = typer.Option(..., "--project", help="项目 ID"),
    json_output: bool = typer.Option(False, "--json", help="输出裸 JSON"),
) -> None:
    """查看单个 ML Backend 详情 (含 health_meta)。"""
    with cli_errors(json_output):
        with get_client(json_output) as client:
            backend = client.ml_backends.get(project_id, backend_id)
    if json_output:
        print_json(backend.model_dump(mode="json"))
    else:
        console.print(backend.model_dump(mode="json"))
