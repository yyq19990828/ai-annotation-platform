"""aap members 子命令。"""

from __future__ import annotations

from enum import Enum

import typer
from rich.table import Table

from ai_annotation.cli._output import (
    cli_errors,
    confirm_destructive,
    console,
    get_client,
    print_json,
)

app = typer.Typer(
    help="成员: 列出、添加或移除项目成员。",
    no_args_is_help=True,
    rich_markup_mode="rich",
    epilog="示例: [dim]aap members list P-1[/]",
)


class MemberRole(str, Enum):
    annotator = "annotator"
    reviewer = "reviewer"


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


@app.command("add")
def add(
    project_id: str = typer.Argument(..., help="项目 ID"),
    user_id: str = typer.Option(..., "--user-id", help="用户 ID"),
    role: MemberRole = typer.Option(..., "--role", help="项目角色"),
    json_output: bool = typer.Option(False, "--json", help="输出裸 JSON"),
) -> None:
    """添加项目成员。"""
    with cli_errors(json_output):
        with get_client(json_output) as client:
            member = client.members.add(project_id, user_id, role.value)
    if json_output:
        print_json(member.model_dump(mode="json"))
    else:
        console.print(f"[green]成员已添加[/green] id={member.id}")


@app.command("remove")
def remove(
    project_id: str = typer.Argument(..., help="项目 ID"),
    member_id: str = typer.Argument(..., help="成员 ID"),
    yes: bool = typer.Option(False, "--yes", "-y", help="跳过确认"),
    json_output: bool = typer.Option(False, "--json", help="输出裸 JSON"),
) -> None:
    """移除项目成员。"""
    confirm_destructive(f"确认移除成员 {member_id}?", yes, json_output)
    with cli_errors(json_output):
        with get_client(json_output) as client:
            client.members.remove(project_id, member_id)
    if json_output:
        print_json({"removed": True, "project_id": project_id, "member_id": member_id})
    else:
        console.print(f"[green]成员已移除[/green] {member_id}")
