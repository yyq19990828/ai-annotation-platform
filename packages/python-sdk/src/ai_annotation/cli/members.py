"""aap members 子命令: 列出项目成员 (只读)。"""

from __future__ import annotations

import typer
from rich.table import Table

from ai_annotation.cli._output import cli_errors, console, get_client, print_json

app = typer.Typer(
    help="成员: 列出项目成员 (用户 / 邮箱 / 角色)。",
    no_args_is_help=True,
    rich_markup_mode="rich",
    epilog="示例: [dim]aap members list P-1[/]",
)


@app.command("list")
def list_(
    project_id: str = typer.Argument(..., help="项目 ID"),
    json_output: bool = typer.Option(False, "--json", help="输出裸 JSON"),
) -> None:
    """列出项目成员。"""
    with cli_errors(json_output):
        with get_client(json_output) as client:
            members = client.members.list(project_id)
    if json_output:
        print_json([m.model_dump(mode="json") for m in members])
        return
    table = Table()
    table.add_column("用户")
    table.add_column("邮箱")
    table.add_column("角色")
    table.add_column("加入时间")
    for m in members:
        joined = m.assigned_at.strftime("%Y-%m-%d") if m.assigned_at else "-"
        table.add_row(m.user_name, m.user_email, m.role, joined)
    console.print(table)
