import httpx
import pytest

from ai_annotation.errors import PermissionDeniedError
from ai_annotation.models import MyPerformance, PersonStat, ProjectStats

from .conftest import API


def test_projects_stats(client, respx_mock):
    respx_mock.get(f"{API}/projects/stats").mock(
        return_value=httpx.Response(
            200,
            json={
                "total_data": 100,
                "completed": 60,
                "ai_rate": 0.4,
                "pending_review": 8,
                "total_data_series": [10, 50, 100],
                "completed_series": [5, 30, 60],
                "ai_rate_series": [0.1, 0.3, 0.4],
                "pending_review_series": [2, 5, 8],
            },
        )
    )
    s = client.projects.stats()
    assert isinstance(s, ProjectStats)
    assert s.total_data == 100
    assert s.ai_rate == 0.4
    assert s.completed_series == [5, 30, 60]


def test_dashboard_people(client, respx_mock):
    route = respx_mock.get(f"{API}/dashboard/admin/people").mock(
        return_value=httpx.Response(
            200,
            json={
                "items": [
                    {
                        "user_id": "u1",
                        "name": "甲",
                        "email": "a@x.io",
                        "role": "annotator",
                        "status": "online",
                        "project_count": 2,
                        "main_metric": 30,
                        "main_metric_label": "本周完成",
                        "throughput_score": 82,
                        "quality_score": 91,
                        "activity_score": 70,
                        "sparkline_7d": [3, 5, 4, 8, 6, 9, 7],
                        "rejected_rate": 0.05,
                        "alerts": [],
                    }
                ],
                "total": 1,
                "period": "7d",
            },
        )
    )
    people = client.dashboard.people(period="7d")
    assert route.called
    assert route.calls.last.request.url.params["period"] == "7d"
    assert len(people) == 1
    assert isinstance(people[0], PersonStat)
    assert people[0].throughput_score == 82


def test_dashboard_people_project_scope(client, respx_mock):
    route = respx_mock.get(f"{API}/dashboard/admin/people").mock(
        return_value=httpx.Response(200, json={"items": [], "total": 0, "period": "7d"})
    )
    client.dashboard.people(project="P-1")
    assert route.calls.last.request.url.params["project"] == "P-1"


def test_dashboard_people_forbidden(client, respx_mock):
    respx_mock.get(f"{API}/dashboard/admin/people").mock(
        return_value=httpx.Response(403, json={"detail": "forbidden"})
    )
    with pytest.raises(PermissionDeniedError):
        client.dashboard.people()


def test_dashboard_me_performance(client, respx_mock):
    respx_mock.get(f"{API}/dashboard/me/performance").mock(
        return_value=httpx.Response(
            200,
            json={
                "user_id": "u1",
                "name": "甲",
                "period": "4w",
                "throughput": 120,
                "quality_score": 88,
                "weekly_compare_pct": 5.0,
                "trend_throughput": [20, 30, 35, 35],
                "trend_quality": [80, 85, 87, 88],
                "team_trend_throughput": [25.0, 28.0, 30.0, 31.0],
                "p50_duration_ms": 1200,
                "p95_duration_ms": 4500,
                "reject_reason_breakdown": [],
                "class_distribution": [],
                "first_pass_yield": 0.92,
            },
        )
    )
    perf = client.dashboard.me_performance()
    assert isinstance(perf, MyPerformance)
    assert perf.throughput == 120
    assert perf.team_trend_throughput == [25.0, 28.0, 30.0, 31.0]
    assert perf.first_pass_yield == 0.92
