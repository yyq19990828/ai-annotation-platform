"""aap tasks 工作流命令。"""

from enum import Enum

import typer

from ai_annotation.cli._output import cli_errors, console, get_client, print_json

app = typer.Typer(
    help="任务流转: 提交、跳过、撤回、重开与审核。",
    no_args_is_help=True,
    rich_markup_mode="rich",
)


class SkipReason(str, Enum):
    image_corrupt = "image_corrupt"
    no_target = "no_target"
    unclear = "unclear"
    other = "other"


class RejectReason(str, Enum):
    missing = "missing"
    extra = "extra"
    wrong_label = "wrong_label"
    wrong_geometry = "wrong_geometry"


def _print_result(result, json_output: bool) -> None:
    if json_output:
        print_json(result.model_dump(mode="json"))
    else:
        console.print(f"[green]{result.status}[/green] task={result.task_id}")


@app.command("submit")
def submit(
    task_id: str = typer.Argument(..., help="任务 ID"),
    json_output: bool = typer.Option(False, "--json", help="输出裸 JSON"),
) -> None:
    """提交任务进入审核。"""
    with cli_errors(json_output):
        with get_client(json_output) as client:
            result = client.tasks.submit(task_id)
    _print_result(result, json_output)


@app.command("skip")
def skip(
    task_id: str = typer.Argument(..., help="任务 ID"),
    reason: SkipReason = typer.Option(..., "--reason", help="跳过原因"),
    note: str | None = typer.Option(None, "--note", help="补充说明"),
    json_output: bool = typer.Option(False, "--json", help="输出裸 JSON"),
) -> None:
    """跳过任务并转审核。"""
    with cli_errors(json_output):
        with get_client(json_output) as client:
            result = client.tasks.skip(task_id, reason.value, note)
    _print_result(result, json_output)


def _simple_action(task_id: str, action: str, json_output: bool) -> None:
    with cli_errors(json_output):
        with get_client(json_output) as client:
            result = getattr(client.tasks, action)(task_id)
    _print_result(result, json_output)


@app.command("withdraw")
def withdraw(
    task_id: str = typer.Argument(..., help="任务 ID"),
    json_output: bool = typer.Option(False, "--json", help="输出裸 JSON"),
) -> None:
    """撤回未被认领的审核任务。"""
    _simple_action(task_id, "withdraw", json_output)


@app.command("reopen")
def reopen(
    task_id: str = typer.Argument(..., help="任务 ID"),
    json_output: bool = typer.Option(False, "--json", help="输出裸 JSON"),
) -> None:
    """重开已完成任务。"""
    _simple_action(task_id, "reopen", json_output)


@app.command("accept-rejection")
def accept_rejection(
    task_id: str = typer.Argument(..., help="任务 ID"),
    json_output: bool = typer.Option(False, "--json", help="输出裸 JSON"),
) -> None:
    """接受退回并开始重做。"""
    _simple_action(task_id, "accept_rejection", json_output)


@app.command("review-claim")
def review_claim(
    task_id: str = typer.Argument(..., help="任务 ID"),
    json_output: bool = typer.Option(False, "--json", help="输出裸 JSON"),
) -> None:
    """认领审核任务。"""
    with cli_errors(json_output):
        with get_client(json_output) as client:
            result = client.tasks.claim_review(task_id)
    if json_output:
        print_json(result.model_dump(mode="json"))
    else:
        console.print(
            f"[green]已认领审核[/green] task={result.task_id} reviewer={result.reviewer_id}"
        )


@app.command("review-approve")
def review_approve(
    task_id: str = typer.Argument(..., help="任务 ID"),
    expected_qc_digest: str | None = typer.Option(
        None, "--expected-qc-digest", help="预期 QC digest"
    ),
    warning_issue_ids: list[str] | None = typer.Option(
        None, "--warning-issue-id", help="确认的 warning issue ID，可重复"
    ),
    note: str | None = typer.Option(None, "--note", help="审核备注"),
    json_output: bool = typer.Option(False, "--json", help="输出裸 JSON"),
) -> None:
    """通过审核。"""
    fields = {
        key: value
        for key, value in {
            "expected_qc_digest": expected_qc_digest,
            "warning_issue_ids": warning_issue_ids,
            "note": note,
        }.items()
        if value is not None
    }
    with cli_errors(json_output):
        with get_client(json_output) as client:
            result = client.tasks.approve_review(task_id, **fields)
    _print_result(result, json_output)


@app.command("review-reject")
def review_reject(
    task_id: str = typer.Argument(..., help="任务 ID"),
    reason_type: RejectReason = typer.Option(
        ..., "--reason-type", help="结构化退回原因"
    ),
    reason: str = typer.Option(..., "--reason", help="详细原因"),
    json_output: bool = typer.Option(False, "--json", help="输出裸 JSON"),
) -> None:
    """退回审核任务。"""
    with cli_errors(json_output):
        with get_client(json_output) as client:
            result = client.tasks.reject_review(task_id, reason_type.value, reason)
    _print_result(result, json_output)
