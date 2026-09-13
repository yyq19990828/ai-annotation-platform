from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.schemas.project_performance import PerformanceScope
from app.services.project_performance import (
    _annotation_source_label,
    _decision_snapshot,
    _first_rate_metric,
    _qualified_time,
    _round_snapshots,
    ResolvedScope,
    resolve_scope,
)
from app.api.v1.tasks._shared import _record_first_review_fact


def test_date_only_to_is_an_exclusive_local_midnight():
    scope = resolve_scope(
        "2026-09-13",
        "2026-09-14",
        "Asia/Shanghai",
        now=datetime(2026, 9, 14, 3, tzinfo=timezone.utc),
    )

    assert scope.start == datetime(2026, 9, 12, 16, tzinfo=timezone.utc)
    assert scope.end == datetime(2026, 9, 13, 16, tzinfo=timezone.utc)


def test_ninety_calendar_days_accept_dst_fallback_and_previous_instant_scope():
    now = datetime(2026, 11, 3, tzinfo=timezone.utc)
    current = resolve_scope(
        "2026-08-04",
        "2026-11-02",
        "America/New_York",
        now=now,
    )
    previous_start = current.start - (current.end - current.start)
    previous = resolve_scope(
        previous_start.isoformat(),
        current.start.isoformat(),
        "America/New_York",
        now=now,
    )

    assert current.end - current.start == timedelta(days=90, hours=1)
    assert previous.end == current.start
    assert previous.end - previous.start == current.end - current.start


def test_scope_rejects_more_than_ninety_complete_local_days():
    with pytest.raises(HTTPException) as exc_info:
        resolve_scope(
            "2026-08-03",
            "2026-11-03",
            "America/New_York",
            now=datetime(2026, 11, 4, tzinfo=timezone.utc),
        )

    assert exc_info.value.status_code == 422


def test_decision_uses_the_matching_submit_round_snapshot():
    task_id = uuid4()
    contributor = uuid4()
    other_contributor = uuid4()
    submit = SimpleNamespace(
        target_id=str(task_id),
        detail_json={
            "review_round_id": str(uuid4()),
            "contributor_ids": [str(contributor)],
        },
    )
    matching_decision = SimpleNamespace(
        target_id=str(task_id),
        detail_json={"review_round_id": submit.detail_json["review_round_id"]},
    )
    other_round = SimpleNamespace(
        target_id=str(task_id),
        detail_json={
            "review_round_id": str(uuid4()),
            "contributor_ids": [str(other_contributor)],
        },
    )
    other_decision = SimpleNamespace(
        target_id=str(task_id),
        detail_json={"review_round_id": str(uuid4())},
    )

    snapshots = _round_snapshots([submit, other_round])

    assert _decision_snapshot(matching_decision, snapshots) == {contributor}
    assert _decision_snapshot(other_decision, snapshots) == set()


def test_first_review_rate_is_percent_with_raw_cohort_counts():
    metric = _first_rate_metric(1, 2)

    assert metric.value == 50.0
    assert metric.unit == "percent"
    assert metric.numerator == 1
    assert metric.denominator == 2


def test_unknown_first_review_cohort_never_becomes_a_hundred_percent_pass():
    metric = _first_rate_metric(0, 0, partial=True)

    assert metric.value is None
    assert metric.coverage == "partial"


def test_import_marker_keeps_imported_work_separate_from_manual_source():
    assert _annotation_source_label("manual", "true") == "imported"
    assert _annotation_source_label("manual", None) == "manual"


def test_first_review_fact_is_write_once_and_legacy_rows_stay_unknown():
    first_at = datetime(2026, 9, 13, tzinfo=timezone.utc)
    task = SimpleNamespace(
        first_review_eligible=True,
        first_reviewed_at=None,
        first_review_result=None,
        first_review_contributor_ids=None,
    )

    assert _record_first_review_fact(
        task,
        reviewed_at=first_at,
        result="rejected",
        contributor_ids=["u1"],
    )
    assert not _record_first_review_fact(
        task,
        reviewed_at=first_at.replace(day=14),
        result="approved",
        contributor_ids=["u2"],
    )
    assert task.first_review_result == "rejected"
    assert task.first_review_contributor_ids == ["u1"]

    legacy = SimpleNamespace(
        first_review_eligible=None,
        first_reviewed_at=None,
        first_review_result=None,
        first_review_contributor_ids=None,
    )
    assert not _record_first_review_fact(
        legacy,
        reviewed_at=first_at,
        result="approved",
        contributor_ids=["u1"],
    )
    assert legacy.first_reviewed_at is None


def test_qualified_time_clips_crossing_sessions_and_unions_overlaps():
    user_id = uuid4()
    scope = ResolvedScope(
        start=datetime(2026, 9, 13, 0, tzinfo=timezone.utc),
        end=datetime(2026, 9, 13, 1, tzinfo=timezone.utc),
        timezone_name="UTC",
        as_of=datetime(2026, 9, 13, 2, tzinfo=timezone.utc),
    )
    events = [
        SimpleNamespace(
            user_id=user_id,
            kind="annotate",
            started_at=datetime(2026, 9, 12, 23, 50, tzinfo=timezone.utc),
            ended_at=datetime(2026, 9, 13, 0, 20, tzinfo=timezone.utc),
            collection_coverage="qualified",
        ),
        SimpleNamespace(
            user_id=user_id,
            kind="annotate",
            started_at=datetime(2026, 9, 13, 0, 10, tzinfo=timezone.utc),
            ended_at=datetime(2026, 9, 13, 0, 30, tzinfo=timezone.utc),
            collection_coverage="qualified",
        ),
    ]

    result = _qualified_time(events, scope)

    assert result.minutes[user_id]["annotate"] == 30.0
    assert result.coverage[user_id]["annotate"] == "complete"
    assert result.total_minutes["annotate"] == 30.0


def test_scope_serializes_the_frozen_api_keys():
    scope = resolve_scope(
        "2026-09-13T00:00:00Z",
        "2026-09-14T00:00:00Z",
        "UTC",
        now=datetime(2026, 9, 14, 1, tzinfo=timezone.utc),
    )

    payload = PerformanceScope.model_validate(scope.output()).model_dump(by_alias=True)

    assert set(payload) == {"from", "to", "timezone", "as_of"}
