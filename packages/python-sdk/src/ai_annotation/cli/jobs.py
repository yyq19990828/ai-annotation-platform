"""aap jobs 子命令 + 共享的 wait_job 进度跟随。"""

from __future__ import annotations

import typer
from rich.progress import BarColumn, Progress, TaskProgressColumn, TextColumn, TimeElapsedColumn

from ai_annotation import Client
from ai_annotation.cli._output import cli_errors, console, get_client, print_json, progress_console
from ai_annotation.models import Job

app = typer.Typer(help="异步任务", no_args_is_help=True)


def wait_job(client: Client, job_id: str, json_mode: bool = False) -> Job:
    """轮询 job 到终态; 非 --json 模式显示 rich 进度条并打印完成行。

    failed / cancelled 抛 JobFailedError, 由上层 cli_errors 统一转红色错误。
    """
    if json_mode:
        return client.jobs.wait(job_id)
    with Progress(
        TextColumn("[progress.description]{task.description}"),
        BarColumn(),
        TaskProgressColumn(),
        TimeElapsedColumn(),
        console=progress_console,
    ) as progress:
        task = progress.add_task(f"等待 job {job_id}", total=100)

        def _on_progress(job: Job) -> None:
            progress.update(
                task, completed=job.progress_pct, description=f"{job.kind} · {job.status}"
            )

        job = client.jobs.wait(job_id, on_progress=_on_progress)
        progress.update(task, completed=100)
    console.print(f"[green]job {job.id} completed[/green] (kind={job.kind})")
    return job


@app.command("wait")
def wait(
    job_id: str = typer.Argument(..., help="async job ID"),
    json_output: bool = typer.Option(False, "--json", help="输出裸 JSON"),
) -> None:
    """等待异步任务到终态, 跟随进度。"""
    with cli_errors(json_output):
        with get_client(json_output) as client:
            job = wait_job(client, job_id, json_output)
    if json_output:
        print_json(job.model_dump(mode="json"))
