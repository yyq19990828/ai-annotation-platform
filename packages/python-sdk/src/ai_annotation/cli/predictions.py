"""aap predictions 子命令。"""

from __future__ import annotations

from pathlib import Path

import typer

from ai_annotation.cli._output import cli_errors, console, get_client, print_json

app = typer.Typer(
    help="预测结果导入: 把外部模型产出 (aap_json / coco / yolo) 导入项目。",
    no_args_is_help=True,
    rich_markup_mode="rich",
    epilog=(
        "示例: [dim]aap predictions import P-1 preds.json[/] · "
        "[dim]aap predictions import P-1 preds.json --format coco --dry-run[/]"
    ),
)


@app.command("import")
def import_(
    project_id: str = typer.Argument(..., help="项目 ID"),
    file: Path = typer.Argument(..., exists=True, dir_okay=False, help="预测结果文件"),
    format_: str = typer.Option("aap_json", "--format", help="aap_json / coco / yolo"),
    dry_run: bool = typer.Option(False, "--dry-run", help="只校验不落库"),
    json_output: bool = typer.Option(False, "--json", help="输出裸 JSON"),
) -> None:
    """导入外部预测结果到项目。"""
    with cli_errors(json_output):
        with get_client(json_output) as client:
            result = client.predictions.import_file(
                project_id, file, format=format_, dry_run=dry_run
            )
    if json_output:
        print_json(result.model_dump(mode="json"))
        return
    prefix = "[yellow](dry-run)[/yellow] " if result.dry_run else ""
    console.print(
        f"{prefix}导入完成: imported={result.imported} "
        f"skipped={result.skipped} errors={len(result.errors)}"
    )
    for err in result.errors[:5]:
        console.print(f"[red]- {err}[/red]")
