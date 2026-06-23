"""v0.18.1 · 多阶段预标注 worker 核心 (_run_task_pipeline) 单测 (路径 B M1).

用假 stage client + monkeypatch 图像加载, 验证:
- 单阶段: 等价于直接 predict, extra=None (回归路径)。
- 双阶段: 源框被下游分类结果的 attributes 富集, extra 记录阶段元信息。
"""

from __future__ import annotations

from dataclasses import dataclass, field

import pytest
from PIL import Image

from app.workers import tasks as worker_tasks


@dataclass
class _Result:
    task_id: str
    result: list
    score: float = 0.9
    model_version: str | None = "v1"
    inference_time_ms: int | None = 5
    meta: dict | None = None


@dataclass
class _FakeClient:
    """按调用顺序吐 canned 响应; 记录收到的 inputs 供断言。"""

    responses: list
    calls: list = field(default_factory=list)

    async def predict(self, inputs, context=None):
        self.calls.append(inputs)
        return self.responses.pop(0)


@dataclass
class _Task:
    id: str = "task-1"
    file_path: str = "key/img.jpg"
    dataset_item_id: str | None = None


def _bbox(x, y, w, h, cls="car"):
    return {
        "type": "rectanglelabels",
        "value": {"x": x, "y": y, "width": w, "height": h, "rectanglelabels": [cls]},
    }


@pytest.mark.asyncio
async def test_single_stage_passthrough():
    task = _Task()
    boxes = [_bbox(10, 10, 20, 20)]
    client = _FakeClient(responses=[[_Result(task.id, boxes)]])
    stages = [{"stage": 0, "parent_stage": None, "roi": None, "write": None}]

    results, extra, stats = await worker_tasks._run_task_pipeline(
        task, stages, [client], [None], resolve_url=lambda t: "http://x/img.jpg"
    )
    assert extra is None
    assert stats is None
    assert results[0].result is boxes
    # 单阶段不应触碰下游, 只调一次
    assert len(client.calls) == 1


@pytest.mark.asyncio
async def test_two_stage_enriches_attributes(monkeypatch):
    task = _Task()
    # 源阶段产 2 个车框
    boxes = [_bbox(10, 10, 20, 20), _bbox(50, 50, 10, 10)]
    detect_client = _FakeClient(responses=[[_Result(task.id, boxes)]])
    # 下游对每个 crop 返回带 attributes 的结果 (id 即父框下标)
    classify_client = _FakeClient(
        responses=[
            [
                _Result("0", [{"score": 0.9, "attributes": {"color": "blue", "vehicle_type": "bus"}}]),
                _Result("1", [{"score": 0.8, "attributes": {"color": "red", "vehicle_type": "car"}}]),
            ]
        ]
    )
    # 避免真去对象存储取图
    monkeypatch.setattr(
        worker_tasks, "_load_task_image", lambda t: Image.new("RGB", (200, 200), (1, 2, 3))
    )

    stages = [
        {"stage": 0, "parent_stage": None, "roi": None, "write": None},
        {
            "stage": 1,
            "parent_stage": 0,
            "roi": {"mode": "crop", "pad": 0.05},
            "write": {"target": "attributes", "keys": ["color", "vehicle_type"]},
        },
    ]
    results, extra, stats = await worker_tasks._run_task_pipeline(
        task,
        stages,
        [detect_client, classify_client],
        [None, None],
        resolve_url=lambda t: "http://x/img.jpg",
    )

    assert stats[0]["detected"] == 2
    assert stats[1]["ok"] == 2 and stats[1]["failed"] == 0
    enriched = results[0].result
    assert enriched[0]["attributes"] == {"color": "blue", "vehicle_type": "bus"}
    assert enriched[1]["attributes"] == {"color": "red", "vehicle_type": "car"}
    # 下游收到 2 个 crop input (每个父框一个)
    assert len(classify_client.calls[0]) == 2
    assert extra["pipeline"]["stage_count"] == 2
    assert extra["pipeline"]["enriched_attr_keys"] == ["color", "vehicle_type"]


@pytest.mark.asyncio
async def test_parent_class_filter_routes_by_class(monkeypatch):
    task = _Task()
    # 源产 car + person 各一; 下游只对 car 跑
    boxes = [_bbox(10, 10, 20, 20, cls="car"), _bbox(50, 50, 10, 10, cls="person")]
    detect_client = _FakeClient(responses=[[_Result(task.id, boxes)]])
    classify_client = _FakeClient(
        responses=[[_Result("0", [{"score": 0.9, "attributes": {"color": "blue"}}])]]
    )
    monkeypatch.setattr(
        worker_tasks, "_load_task_image", lambda t: Image.new("RGB", (200, 200), (1, 2, 3))
    )
    stages = [
        {"stage": 0, "parent_stage": None},
        {"stage": 1, "parent_stage": 0, "parent_class_filter": ["car"]},
    ]
    results, _extra, stats = await worker_tasks._run_task_pipeline(
        task, stages, [detect_client, classify_client], [None, None],
        resolve_url=lambda t: "http://x/img.jpg",
    )
    # 只对 car (idx0) 裁 crop; person 保持纯检测框 (无 attributes)
    assert len(classify_client.calls[0]) == 1
    assert classify_client.calls[0][0]["id"] == "0"
    assert results[0].result[0].get("attributes") == {"color": "blue"}
    assert "attributes" not in results[0].result[1] or not results[0].result[1].get("attributes")
    assert stats[1]["targeted"] == 1 and stats[1]["ok"] == 1


@pytest.mark.asyncio
async def test_on_failure_keep_parent_vs_drop_box(monkeypatch):
    monkeypatch.setattr(
        worker_tasks, "_load_task_image", lambda t: Image.new("RGB", (200, 200), (1, 2, 3))
    )

    class _BoomClient:
        async def predict(self, inputs, context=None):
            raise RuntimeError("backend down")

    # keep_parent: 下游炸 → 保留父框 (属性空), task 不整体失败
    task = _Task()
    boxes = [_bbox(10, 10, 20, 20)]
    detect = _FakeClient(responses=[[_Result(task.id, boxes)]])
    stages_keep = [
        {"stage": 0, "parent_stage": None},
        {"stage": 1, "parent_stage": 0, "on_failure": "keep_parent"},
    ]
    results, _e, stats = await worker_tasks._run_task_pipeline(
        task, stages_keep, [detect, _BoomClient()], [None, None],
        resolve_url=lambda t: "http://x/img.jpg",
    )
    assert len(results[0].result) == 1  # 框保留
    assert stats[1]["failed"] == 1

    # drop_box: 下游炸 → 丢父框
    detect2 = _FakeClient(responses=[[_Result(task.id, [_bbox(10, 10, 20, 20)])]])
    stages_drop = [
        {"stage": 0, "parent_stage": None},
        {"stage": 1, "parent_stage": 0, "on_failure": "drop_box"},
    ]
    results2, _e2, _s2 = await worker_tasks._run_task_pipeline(
        task, stages_drop, [detect2, _BoomClient()], [None, None],
        resolve_url=lambda t: "http://x/img.jpg",
    )
    assert results2[0].result == []  # 框被丢弃
