"""aap export 子命令: create → wait → download 全流程。"""

from __future__ import annotations

from pathlib import Path

import typer

from ai_annotation.cli._output import cli_errors, console, get_client, print_json
from ai_annotation.cli.jobs import wait_job

app = typer.Typer(help="标注导出", no_args_is_help=True)


@app.command("project")
def project(
    project_id: str = typer.Argument(..., help="项目 ID"),
    target: str = typer.Option(..., "--target", help="导出格式, 如 aap_json / coco"),
    out: Path = typer.Option(..., "--out", help="导出包输出路径"),
    json_output: bool = typer.Option(False, "--json", help="输出裸 JSON"),
) -> None:
    """导出项目标注: 创建导出 job → 等待完成 → 下载到 --out。"""
    with cli_errors(json_output):
        with get_client(json_output) as client:
            job_id = client.exports.create(project_id, targets=[target])
            if not json_output:
                console.print(f"导出 job 已创建: {job_id}")
            job = wait_job(client, job_id, json_output)
            dest = client.exports.download(job, out)
    if json_output:
        print_json({"job_id": str(job_id), "status": job.status, "out": str(dest)})
    else:
        console.print(f"[green]导出完成[/green] → {dest}")
