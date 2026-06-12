"""aap dashboard 子命令: 全员绩效 / 自助绩效 (只读)。"""

from __future__ import annotations

import typer
from rich.table import Table

from ai_annotation.cli._output import (
    cli_errors,
    console,
    get_client,
    print_json,
    sparkline,
)

app = typer.Typer(
    help="看板: 全员绩效 (people, 管理员) / 自助绩效 (me)。",
    no_args_is_help=True,
    rich_markup_mode="rich",
    epilog="示例: [dim]aap dashboard people[/] · [dim]aap dashboard me[/]",
)


def _fmt_rate(v: float | None) -> str:
    if v is None:
        return "-"
    return f"{v * 100:.0f}%" if v <= 1 else f"{v:.0f}%"


@app.command("people")
def people(
    project: str | None = typer.Option(None, "--project", help="项目范围 (project_admin 必填)"),
    role: str | None = typer.Option(None, "--role", help="按角色过滤: annotator / reviewer / both"),
    period: str | None = typer.Option(None, "--period", help="统计周期: today / 7d / 4w / 1m"),
    json_output: bool = typer.Option(False, "--json", help="输出裸 JSON"),
) -> None:
    """全员绩效卡片 (super_admin / project_admin)。"""
    with cli_errors(json_output):
        with get_client(json_output) as client:
            rows = client.dashboard.people(role=role, project=project, period=period)
    if json_output:
        print_json([p.model_dump(mode="json") for p in rows])
        return
    table = Table()
    table.add_column("姓名")
    table.add_column("角色")
    table.add_column("产出分")
    table.add_column("质量分")
    table.add_column("退回率")
    table.add_column("7日趋势")
    for p in rows:
        table.add_row(
            p.name,
            p.role,
            str(p.throughput_score),
            str(p.quality_score),
            _fmt_rate(p.rejected_rate),
            sparkline(p.sparkline_7d),
        )
    console.print(table)


@app.command("me")
def me_performance(
    period: str | None = typer.Option(None, "--period", help="统计周期 (默认 4w)"),
    json_output: bool = typer.Option(False, "--json", help="输出裸 JSON"),
) -> None:
    """当前用户自助绩效 (自身趋势 + 团队均线对标)。"""
    with cli_errors(json_output):
        with get_client(json_output) as client:
            perf = client.dashboard.me_performance(period=period)
    if json_output:
        print_json(perf.model_dump(mode="json"))
        return
    console.print(
        f"[green]{perf.name}[/green] · 产出 {perf.throughput} · 质量 {perf.quality_score}"
    )
    console.print(f"产出趋势(4周): {sparkline(perf.trend_throughput)}")
    console.print(f"团队均线(4周): {sparkline(perf.team_trend_throughput)}")
    if perf.first_pass_yield is not None:
        console.print(f"一次通过率: {_fmt_rate(perf.first_pass_yield)}")
