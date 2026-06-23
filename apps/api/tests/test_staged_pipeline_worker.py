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

    results, extra = await worker_tasks._run_task_pipeline(
        task, stages, [client], [None], resolve_url=lambda t: "http://x/img.jpg"
    )
    assert extra is None
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
    results, extra = await worker_tasks._run_task_pipeline(
        task,
        stages,
        [detect_client, classify_client],
        [None, None],
        resolve_url=lambda t: "http://x/img.jpg",
    )

    enriched = results[0].result
    assert enriched[0]["attributes"] == {"color": "blue", "vehicle_type": "bus"}
    assert enriched[1]["attributes"] == {"color": "red", "vehicle_type": "car"}
    # 下游收到 2 个 crop input (每个父框一个)
    assert len(classify_client.calls[0]) == 2
    assert extra["pipeline"]["stage_count"] == 2
    assert extra["pipeline"]["enriched_attr_keys"] == ["color", "vehicle_type"]
