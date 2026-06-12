"""aap batches 子命令: 列出项目批次 (只读)。"""

from __future__ import annotations

import typer
from rich.table import Table

from ai_annotation.cli._output import cli_errors, console, get_client, print_json

app = typer.Typer(
    help="批次: 列出项目下的批次 (进度 / 责任人 / 退回数)。",
    no_args_is_help=True,
    rich_markup_mode="rich",
    epilog="示例: [dim]aap batches list P-1[/] · [dim]aap batches list P-1 --status active[/]",
)


@app.command("list")
def list_(
    project_id: str = typer.Argument(..., help="项目 ID"),
    status: str | None = typer.Option(None, "--status", help="按批次状态过滤"),
    json_output: bool = typer.Option(False, "--json", help="输出裸 JSON"),
) -> None:
    """列出项目批次。"""
    with cli_errors(json_output):
        with get_client(json_output) as client:
            batches = client.batches.list(project_id, status=status)
    if json_output:
        print_json([b.model_dump(mode="json") for b in batches])
        return
    table = Table()
    table.add_column("ID")
    table.add_column("名称")
    table.add_column("状态")
    table.add_column("进度")
    table.add_column("审核")
    table.add_column("退回")
    table.add_column("标注员")
    table.add_column("审核员")
    for b in batches:
        annotator = b.annotator.name if b.annotator else "-"
        reviewer = b.reviewer.name if b.reviewer else "-"
        table.add_row(
            b.display_id,
            b.name,
            b.status,
            f"{b.completed_tasks}/{b.total_tasks}",
            str(b.review_tasks),
            str(b.rejected_tasks),
            annotator,
            reviewer,
        )
    console.print(table)
