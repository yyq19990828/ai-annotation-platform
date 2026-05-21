"""v0.10.15 · AAP JSON 导出端点测试.

覆盖:
- /projects/{id}/export?format=aap_json: schema_version + 双数组 + annotation_guide.
- /projects/{id}/batches/{bid}/export?format=aap_json: batch_display_id 透传.
- predictions 写入后导出可被回读 (round-trip 基础).
- 空项目导出仍是合法 envelope.
"""

from __future__ import annotations

import json
import uuid

import httpx
import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.annotation import Annotation
from app.db.models.dataset import Dataset, DatasetItem
from app.db.models.prediction import Prediction
from app.db.models.project import Project
from app.db.models.task import Task
from app.db.models.task_batch import TaskBatch
from app.schemas.aap_json import AAPTaskBlock, AAPTaskMatch
from app.services.display_id import next_display_id
from app.services.export import ExportService

pytestmark = pytest.mark.asyncio


async def _seed(
    db: AsyncSession, owner_id: uuid.UUID
) -> tuple[Project, list[Task], TaskBatch]:
    short = uuid.uuid4().hex[:6]
    project = Project(
        id=uuid.uuid4(),
        display_id=f"P-EX{short}",
        name=f"AAP {short}",
        type_key="image-det",
        type_label="测试",
        owner_id=owner_id,
        status="in_progress",
        classes=["car"],
        annotation_guide="# 测试指引\n请标注所有车辆.",
    )
    db.add(project)
    await db.flush()

    batch = TaskBatch(
        id=uuid.uuid4(),
        project_id=project.id,
        display_id=await next_display_id(db, "batches"),
        name="b1",
        status="active",
        assigned_user_ids=[],
    )
    db.add(batch)
    await db.flush()

    tasks = []
    for i in range(2):
        t = Task(
            id=uuid.uuid4(),
            project_id=project.id,
            batch_id=batch.id,
            display_id=f"T-EX{short}-{i}",
            file_name=f"img_{i}.jpg",
            file_path=f"datasets/{short}/img_{i}.jpg",
            file_type="image",
            status="pending",
        )
        db.add(t)
        tasks.append(t)
    await db.flush()
    return project, tasks, batch


async def test_export_aap_json_project_envelope(
    super_admin,
    db_session: AsyncSession,
):
    # v0.10.27 导出已异步化 (POST→job); 内容正确性直接断言 ExportService。
    user, _ = super_admin
    project, tasks, _ = await _seed(db_session, user.id)

    # 加 1 条 annotation + 1 条 prediction
    ann = Annotation(
        id=uuid.uuid4(),
        task_id=tasks[0].id,
        project_id=project.id,
        user_id=user.id,
        source="manual",
        class_name="car",
        geometry={"type": "bbox", "x": 0.1, "y": 0.2, "w": 0.3, "h": 0.4},
        confidence=None,
    )
    db_session.add(ann)
    pred = Prediction(
        id=uuid.uuid4(),
        task_id=tasks[0].id,
        project_id=project.id,
        ml_backend_id=None,
        model_version="test-v1",
        score=0.9,
        result=[
            {
                "type": "rectanglelabels",
                "value": {
                    "x": 10,
                    "y": 20,
                    "width": 30,
                    "height": 40,
                    "rectanglelabels": ["car"],
                },
                "score": 0.9,
            }
        ],
        source="ml_backend",
    )
    db_session.add(pred)
    await db_session.flush()

    body = json.loads(await ExportService(db_session).export_aap_json(project.id))

    assert body["schema_version"] == "1.2"
    assert body["exported_from"]["project_display_id"] == project.display_id
    assert body["project"]["annotation_guide"] == "# 测试指引\n请标注所有车辆."
    assert body["project"]["type_key"] == "image-det"
    assert len(body["tasks"]) == 2
    # 非视频项目: media_type 默认 image, video 子块为 None
    assert all(t["media_type"] == "image" for t in body["tasks"])
    assert all(t["video"] is None for t in body["tasks"])

    # task[0] 有 1 ann + 1 pred; task[1] 空
    t0 = next(
        t for t in body["tasks"] if t["task_match"]["display_id"] == tasks[0].display_id
    )
    assert len(t0["annotations"]) == 1
    assert t0["annotations"][0]["geometry"]["type"] == "bbox"
    assert t0["annotations"][0]["class_name"] == "car"
    assert len(t0["predictions"]) == 1
    pred_entry = t0["predictions"][0]
    assert pred_entry["geometry"]["type"] == "bbox"
    assert pred_entry["class_name"] == "car"
    # 严格写满 null (导出 model_dump exclude_none=False)
    assert "external_id" in pred_entry
    assert pred_entry["model_version"] == "test-v1"


async def test_export_aap_json_batch_endpoint(
    super_admin,
    db_session: AsyncSession,
):
    user, _ = super_admin
    project, _, batch = await _seed(db_session, user.id)
    body = json.loads(
        await ExportService(db_session).export_aap_json(project.id, batch_id=batch.id)
    )
    assert body["exported_from"]["batch_display_id"] == batch.display_id


async def test_export_aap_json_empty_project(
    super_admin,
    db_session: AsyncSession,
):
    user, _ = super_admin
    short = uuid.uuid4().hex[:6]
    project = Project(
        id=uuid.uuid4(),
        display_id=f"P-EMPTY{short}",
        name="empty",
        type_key="image-det",
        type_label="t",
        owner_id=user.id,
        status="in_progress",
        classes=[],
    )
    db_session.add(project)
    await db_session.flush()

    body = json.loads(await ExportService(db_session).export_aap_json(project.id))
    assert body["schema_version"] == "1.2"
    assert body["tasks"] == []


async def test_export_aap_json_round_trip_after_external_import(
    httpx_client: httpx.AsyncClient,
    super_admin,
    db_session: AsyncSession,
):
    """import 一条 external prediction → 导出 → 包内可读 prediction."""
    import io

    user, token = super_admin
    project, tasks, _ = await _seed(db_session, user.id)
    headers = {"Authorization": f"Bearer {token}"}

    aap_payload = json.dumps(
        {
            "schema_version": "1.0",
            "exported_at": "2026-05-19T10:00:00Z",
            "exported_from": {"platform": "aap"},
            "project": {"name": "t", "type_key": "image-det"},
            "tasks": [
                {
                    "task_match": {"display_id": tasks[0].display_id},
                    "predictions": [
                        {
                            "geometry": {
                                "type": "bbox",
                                "x": 0.1,
                                "y": 0.1,
                                "w": 0.2,
                                "h": 0.2,
                            },
                            "class_name": "car",
                            "confidence": 0.77,
                            "model_version": "rt-test",
                        }
                    ],
                }
            ],
        }
    ).encode("utf-8")

    r = await httpx_client.post(
        f"/api/v1/projects/{project.id}/predictions/import?format=aap_json",
        files={"file": ("rt.json", io.BytesIO(aap_payload), "application/json")},
        headers=headers,
    )
    assert r.status_code == 200, r.text

    # 立即导出, 应能读到刚导入的 prediction
    body = json.loads(await ExportService(db_session).export_aap_json(project.id))
    t0 = next(
        t for t in body["tasks"] if t["task_match"]["display_id"] == tasks[0].display_id
    )
    assert len(t0["predictions"]) == 1
    assert t0["predictions"][0]["class_name"] == "car"
    assert t0["predictions"][0]["model_version"] == "rt-test"


def test_aap_task_block_media_type_defaults_and_serialization():
    """v0.10.31 · schema 1.2: media_type 默认 image, video 默认 None;
    序列化时 media_type 字段必出现 (严格写满)."""
    block = AAPTaskBlock(task_match=AAPTaskMatch(display_id="T-1"))
    assert block.media_type == "image"
    assert block.video is None

    dumped = block.model_dump(mode="json")
    assert dumped["media_type"] == "image"
    assert dumped["video"] is None

    video_block = AAPTaskBlock(
        task_match=AAPTaskMatch(display_id="T-2"),
        media_type="video",
        video={"sampling": {"mode": "fps", "value": 5}, "fps": 30, "frame_count": 10},
    )
    vd = video_block.model_dump(mode="json")
    assert vd["media_type"] == "video"
    assert vd["video"]["sampling"]["mode"] == "fps"
    assert vd["video"]["fps"] == 30


async def test_export_aap_json_video_project_task_block(
    super_admin,
    db_session: AsyncSession,
):
    """v0.10.31 · 视频项目导出: task block 带 media_type=video + video 子块
    (sampling + fps/frame_count 等帧元数据)."""
    user, _ = super_admin
    short = uuid.uuid4().hex[:6]

    dataset = Dataset(
        display_id=f"D-VID-{short}",
        name="videos",
        data_type="video",
        created_by=user.id,
    )
    db_session.add(dataset)
    await db_session.flush()
    item = DatasetItem(
        dataset_id=dataset.id,
        file_name="clip.mp4",
        file_path=f"videos/{short}/clip.mp4",
        file_type="video",
        metadata_={
            "video": {
                "fps": 30,
                "frame_count": 300,
                "duration_ms": 10000,
                "width": 1920,
                "height": 1080,
            }
        },
    )
    db_session.add(item)
    await db_session.flush()

    project = Project(
        id=uuid.uuid4(),
        display_id=f"P-VID{short}",
        name=f"video {short}",
        type_key="video-track",
        type_label="视频跟踪",
        owner_id=user.id,
        status="in_progress",
        classes=["car"],
        data_type="video",
        video_sampling={"mode": "fps", "value": 5},
    )
    db_session.add(project)
    await db_session.flush()

    task = Task(
        id=uuid.uuid4(),
        project_id=project.id,
        dataset_item_id=item.id,
        display_id=f"T-VID{short}",
        file_name="clip.mp4",
        file_path=f"videos/{short}/clip.mp4",
        file_type="video",
        status="pending",
    )
    db_session.add(task)
    await db_session.flush()

    body = json.loads(await ExportService(db_session).export_aap_json(project.id))
    assert body["schema_version"] == "1.2"
    assert len(body["tasks"]) == 1
    t0 = body["tasks"][0]
    assert t0["media_type"] == "video"
    assert t0["video"] is not None
    assert t0["video"]["sampling"] == {"mode": "fps", "value": 5}
    assert t0["video"]["fps"] == 30
    assert t0["video"]["frame_count"] == 300
    assert t0["video"]["duration_ms"] == 10000
    assert t0["video"]["width"] == 1920
    assert t0["video"]["height"] == 1080
