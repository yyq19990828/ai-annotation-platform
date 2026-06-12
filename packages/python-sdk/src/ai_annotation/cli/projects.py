"""aap projects 子命令。"""

from __future__ import annotations

from enum import Enum

import typer
from rich.table import Table

from ai_annotation.cli._output import cli_errors, console, get_client, print_json
from ai_annotation.models import Project

app = typer.Typer(
    help="项目管理: 列出已有项目、创建新项目。",
    no_args_is_help=True,
    rich_markup_mode="rich",
    epilog="示例: [dim]aap projects create --name demo --type image[/] · [dim]aap projects list --json[/]",
)


class ProjectType(str, Enum):
    image = "image"
    video = "video"
    lidar = "lidar"


def _tasks_progress(p: Project) -> str:
    total = getattr(p, "total_tasks", None)
    done = getattr(p, "completed_tasks", None)
    if total is None or done is None:
        return "-"
    return f"{done}/{total}"


@app.command("list")
def list_(
    json_output: bool = typer.Option(False, "--json", help="输出裸 JSON"),
) -> None:
    """列出项目。"""
    with cli_errors(json_output):
        with get_client(json_output) as client:
            projects = client.projects.list()
    if json_output:
        print_json([p.model_dump(mode="json") for p in projects])
        return
    table = Table()
    table.add_column("ID")
    table.add_column("名称")
    table.add_column("类型")
    table.add_column("状态")
    table.add_column("任务进度")
    for p in projects:
        table.add_row(p.display_id, p.name, p.data_type, p.status, _tasks_progress(p))
    console.print(table)


@app.command("create")
def create(
    name: str = typer.Option(..., "--name", help="项目名称"),
    type_: ProjectType = typer.Option(..., "--type", help="数据类型"),
    json_output: bool = typer.Option(False, "--json", help="输出裸 JSON"),
) -> None:
    """创建项目。"""
    with cli_errors(json_output):
        with get_client(json_output) as client:
            project = client.projects.create(name=name, data_type=type_.value)
    if json_output:
        print_json(project.model_dump(mode="json"))
    else:
        console.print(
            f"[green]项目已创建[/green] id={project.id} display_id={project.display_id}"
        )
