"""aap datasets 子命令。"""

from __future__ import annotations

from pathlib import Path

import typer
from rich.progress import BarColumn, Progress, TaskProgressColumn, TextColumn

from ai_annotation.cli._output import (
    cli_errors,
    console,
    get_client,
    print_error,
    print_json,
    progress_console,
)
from ai_annotation.cli.jobs import wait_job

app = typer.Typer(
    help="数据集管理: 创建数据集、上传文件 (目录 / ZIP)、关联到项目建任务。",
    no_args_is_help=True,
    rich_markup_mode="rich",
    epilog=(
        "示例: [dim]aap datasets create --name imgs[/] · "
        "[dim]aap datasets upload D-1 ./images/[/] · "
        "[dim]aap datasets upload D-1 pack.zip --zip[/] · "
        "[dim]aap datasets link D-1 P-1[/]"
    ),
)


@app.command("create")
def create(
    name: str = typer.Option(..., "--name", help="数据集名称"),
    data_type: str = typer.Option("image", "--data-type", help="数据类型"),
    json_output: bool = typer.Option(False, "--json", help="输出裸 JSON"),
) -> None:
    """创建数据集。"""
    with cli_errors(json_output):
        with get_client(json_output) as client:
            dataset = client.datasets.create(name=name, data_type=data_type)
    if json_output:
        print_json(dataset.model_dump(mode="json"))
    else:
        console.print(
            f"[green]数据集已创建[/green] id={dataset.id} display_id={dataset.display_id}"
        )


@app.command("upload")
def upload(
    dataset_id: str = typer.Argument(..., help="数据集 ID"),
    path: Path = typer.Argument(..., exists=True, help="文件 / 目录 / ZIP 包路径"),
    zip_: bool = typer.Option(False, "--zip", help="按 ZIP 整包上传 (后端解压入库)"),
    json_output: bool = typer.Option(False, "--json", help="输出裸 JSON"),
) -> None:
    """上传文件到数据集: 目录逐文件上传, --zip 则整包上传。"""
    if zip_:
        if not path.is_file():
            print_error(f"--zip 需要 ZIP 文件路径, 而不是目录: {path}", json_output)
            raise typer.Exit(code=1)
        with cli_errors(json_output):
            with get_client(json_output) as client:
                result = client.datasets.upload_zip(dataset_id, path)
        if json_output:
            print_json(result.model_dump(mode="json"))
        else:
            console.print(
                f"[green]ZIP 上传完成[/green]: added={result.added} "
                f"deduped={result.deduped} skipped={result.skipped} "
                f"errors={len(result.errors)}"
            )
        return

    files = (
        [path] if path.is_file() else sorted(p for p in path.rglob("*") if p.is_file())
    )
    if not files:
        print_error(f"目录中没有可上传的文件: {path}", json_output)
        raise typer.Exit(code=1)
    with cli_errors(json_output):
        with get_client(json_output) as client:
            if json_output:
                items = client.datasets.upload_files(dataset_id, files)
            else:
                with Progress(
                    TextColumn("[progress.description]{task.description}"),
                    BarColumn(),
                    TaskProgressColumn(),
                    console=progress_console,
                ) as progress:
                    task = progress.add_task("上传", total=len(files))
                    items = client.datasets.upload_files(
                        dataset_id,
                        files,
                        on_progress=lambda done, total, name: progress.update(
                            task, completed=done, description=f"上传 {name}"
                        ),
                    )
    if json_output:
        print_json([i.model_dump(mode="json") for i in items])
    else:
        console.print(f"[green]上传完成[/green]: {len(items)} 个文件")


@app.command("link")
def link(
    dataset_id: str = typer.Argument(..., help="数据集 ID"),
    project_id: str = typer.Argument(..., help="项目 ID"),
    json_output: bool = typer.Option(False, "--json", help="输出裸 JSON"),
) -> None:
    """关联数据集到项目; 异步建任务时自动等待 job 完成。"""
    job = None
    with cli_errors(json_output):
        with get_client(json_output) as client:
            result = client.datasets.link_project(dataset_id, project_id)
            if result.async_job_id is not None:
                if not json_output:
                    console.print(f"异步建任务中 (job {result.async_job_id}) ...")
                job = wait_job(client, str(result.async_job_id), json_output)
    if json_output:
        print_json(
            {
                "link": result.model_dump(mode="json"),
                "job": job.model_dump(mode="json") if job is not None else None,
            }
        )
    elif job is None:
        console.print(f"[green]关联完成[/green]: created_tasks={result.created_tasks}")
