"""v0.20.11 · 选中框单框二次推理 service 层覆盖 (Q1b).

mock 掉图像加载 / 对象存储 / ml_client.predict, 只验编排 + 产物归位:
- attributes 型: 属性 union 回原框, attributes_meta 标 origin=ai
- geometry 型: crop 检出几何回映后建子框 (parent=选中框)
- crop 被守卫跳过 (框太小) → 无产物
"""

from __future__ import annotations

import types

import pytest
from fastapi import HTTPException
from PIL import Image

import app.services.ml_client as ml_client_mod
import app.services.storage as storage_mod
import app.workers.tasks as tasks_mod
from app.services.ml_client import PredictionResult
from app.services.annotation import AnnotationService
from app.services.secondary_inference import run_secondary_inference
from tests.factory import create_project, create_task


class _FakeStorage:
    def upload_crop_bytes(self, jpeg_bytes: bytes, key: str) -> str:
        return f"http://fake-minio/{key}"


def _fake_backend():
    # run_secondary_inference 只用 backend.id (str) + 传给 (被 mock 的) MLBackendClient。
    return types.SimpleNamespace(id="be-0001")


@pytest.fixture
def _patch_io(monkeypatch):
    """mock 图像加载 + 对象存储 (crop 投递不落真实 IO)。"""
    monkeypatch.setattr(
        tasks_mod, "_load_task_image", lambda task: Image.new("RGB", (200, 200))
    )
    monkeypatch.setattr(storage_mod, "StorageService", _FakeStorage)


def _patch_predict(monkeypatch, results: list[PredictionResult]):
    class _FakeClient:
        def __init__(self, backend):
            pass

        async def predict(self, inputs, context=None):
            return results

    monkeypatch.setattr(ml_client_mod, "MLBackendClient", _FakeClient)


async def _mk_box(db, task_id, user_id, **kw):
    svc = AnnotationService(db)
    return await svc.create(
        task_id=task_id,
        user_id=user_id,
        annotation_type="bbox",
        class_name=kw.get("class_name", "car"),
        geometry={"type": "bbox", "x": 0.2, "y": 0.2, "w": 0.3, "h": 0.3},
        tool_unit_id="bbox",
        attributes=kw.get("attributes"),
    )


@pytest.mark.asyncio
async def test_attributes_written_back_with_ai_origin(
    db_session, super_admin, monkeypatch, _patch_io
):
    user, _ = super_admin
    proj = await create_project(db_session, owner_id=user.id, type_key="image-det")
    task = await create_task(db_session, project_id=proj.id)
    await db_session.flush()
    box = await _mk_box(db_session, task.id, user.id)
    await db_session.flush()

    # 下游分类返回 color=blue (crop 输入 id="0" → cr.task_id="0")
    _patch_predict(
        monkeypatch,
        [
            PredictionResult(
                task_id="0",
                result=[{"attributes": {"color": "blue"}, "score": 0.9}],
            )
        ],
    )

    updated, children = await run_secondary_inference(
        db_session,
        annotation=box,
        task=task,
        backend=_fake_backend(),
        write_target="attributes",
        write_keys=None,
        label=None,
        model_id="cls",
        model_variants=None,
        params=None,
        task_type="classification",
        prompt=None,
        class_filter=None,
        pad=0.08,
        user_id=user.id,
    )

    assert children == []
    assert updated.attributes["color"] == "blue"
    assert updated.attributes_meta["color"]["origin"] == "ai"
    assert updated.attributes_meta["color"]["model_ref"]["model_id"] == "cls"


@pytest.mark.asyncio
async def test_label_prefix_on_written_keys(
    db_session, super_admin, monkeypatch, _patch_io
):
    user, _ = super_admin
    proj = await create_project(db_session, owner_id=user.id, type_key="image-det")
    task = await create_task(db_session, project_id=proj.id)
    await db_session.flush()
    box = await _mk_box(db_session, task.id, user.id)
    await db_session.flush()

    _patch_predict(
        monkeypatch,
        [
            PredictionResult(
                task_id="0", result=[{"attributes": {"color": "red"}, "score": 0.9}]
            )
        ],
    )

    updated, _ = await run_secondary_inference(
        db_session,
        annotation=box,
        task=task,
        backend=_fake_backend(),
        write_target="attributes",
        write_keys=["color"],
        label="plate",
        model_id="cls",
        model_variants=None,
        params=None,
        task_type="classification",
        prompt=None,
        class_filter=None,
        pad=0.08,
        user_id=user.id,
    )

    assert updated.attributes["plate_color"] == "red"
    assert updated.attributes_meta["plate_color"]["origin"] == "ai"
    assert "color" not in updated.attributes  # 原始键被前缀命名空间化


@pytest.mark.asyncio
async def test_attributes_respects_human_edits_and_reuses_ai_slots(
    db_session, super_admin, monkeypatch, _patch_io
):
    """守护 v0.20.10 溯源规则: 人工手改过的属性键 (缺省即 human) 二次推理不再顶回;
    上次 AI 写的键 (origin=ai) 可被再次 AI 覆盖并刷新 model_ref。"""
    user, _ = super_admin
    proj = await create_project(db_session, owner_id=user.id, type_key="image-det")
    task = await create_task(db_session, project_id=proj.id)
    await db_session.flush()

    # 预置一个框: color=red 是人工手改 (attributes_meta 无该键 → 隐式 human);
    # brand=BMW 是上次 AI 写的 (origin=ai, model_ref 指向旧模型)。
    box = await _mk_box(db_session, task.id, user.id)
    box.attributes = {"color": "red", "brand": "BMW"}
    box.attributes_meta = {
        "brand": {"origin": "ai", "model_ref": {"backend_id": "old", "model_id": "old-cls"}}
    }
    await db_session.flush()

    # 本次 AI 返回 color=blue (想改人工) 与 brand=Audi (想改 AI 上次值)。
    _patch_predict(
        monkeypatch,
        [
            PredictionResult(
                task_id="0",
                result=[
                    {"attributes": {"color": "blue", "brand": "Audi"}, "score": 0.9}
                ],
            )
        ],
    )

    updated, children = await run_secondary_inference(
        db_session,
        annotation=box,
        task=task,
        backend=_fake_backend(),
        write_target="attributes",
        write_keys=None,
        label=None,
        model_id="new-cls",
        model_variants=None,
        params=None,
        task_type="classification",
        prompt=None,
        class_filter=None,
        pad=0.08,
        user_id=user.id,
    )

    assert children == []
    # 人工手改的 color 保住原值, meta 仍无该键。
    assert updated.attributes["color"] == "red"
    assert "color" not in updated.attributes_meta
    # AI 上次写的 brand 被本次 AI 覆盖, model_ref 刷新到新模型。
    assert updated.attributes["brand"] == "Audi"
    assert updated.attributes_meta["brand"]["origin"] == "ai"
    assert updated.attributes_meta["brand"]["model_ref"]["model_id"] == "new-cls"


@pytest.mark.asyncio
async def test_geometry_creates_child_boxes(
    db_session, super_admin, monkeypatch, _patch_io
):
    user, _ = super_admin
    proj = await create_project(db_session, owner_id=user.id, type_key="image-det")
    # 项目 bbox 标签集含 plate → 子检出类名保留 (否则回落 __unknown)
    proj.tool_bindings = {
        "bbox": {
            "enabled": True,
            "classes": [
                {"name": "car", "order": 0},
                {"name": "plate", "order": 1},
            ],
            "attribute_schema": {"fields": []},
        }
    }
    task = await create_task(db_session, project_id=proj.id)
    await db_session.flush()
    box = await _mk_box(db_session, task.id, user.id)
    await db_session.flush()

    # crop 上检出一个子物 (crop 百分比坐标) → 回映 → 建子框
    _patch_predict(
        monkeypatch,
        [
            PredictionResult(
                task_id="0",
                result=[
                    {
                        "type": "rectanglelabels",
                        "value": {
                            "x": 10.0,
                            "y": 10.0,
                            "width": 20.0,
                            "height": 20.0,
                            "rectanglelabels": ["plate"],
                        },
                        "score": 0.8,
                    }
                ],
            )
        ],
    )

    updated, children = await run_secondary_inference(
        db_session,
        annotation=box,
        task=task,
        backend=_fake_backend(),
        write_target="geometry",
        write_keys=None,
        label=None,
        model_id="det",
        model_variants={},
        params=None,
        task_type="detection",
        prompt=None,
        class_filter=None,
        pad=0.08,
        user_id=user.id,
    )

    assert len(children) == 1
    child = children[0]
    assert child.parent_annotation_id == box.id
    assert child.source == "prediction_based"
    assert child.class_name == "plate"
    # 回映后落在原图归一化范围内
    assert 0.0 <= child.geometry["x"] <= 1.0
    assert 0.0 <= child.geometry["y"] <= 1.0


@pytest.mark.asyncio
async def test_geometry_unknown_class_falls_back(
    db_session, super_admin, monkeypatch, _patch_io
):
    """子检出类名不在项目标签集 → 回落 __unknown, 不丢框。"""
    user, _ = super_admin
    proj = await create_project(db_session, owner_id=user.id, type_key="image-det")
    proj.tool_bindings = {
        "bbox": {
            "enabled": True,
            "classes": [{"name": "car", "order": 0}],  # 无 plate
            "attribute_schema": {"fields": []},
        }
    }
    task = await create_task(db_session, project_id=proj.id)
    await db_session.flush()
    box = await _mk_box(db_session, task.id, user.id)
    await db_session.flush()

    _patch_predict(
        monkeypatch,
        [
            PredictionResult(
                task_id="0",
                result=[
                    {
                        "type": "rectanglelabels",
                        "value": {
                            "x": 10.0,
                            "y": 10.0,
                            "width": 20.0,
                            "height": 20.0,
                            "rectanglelabels": ["plate"],
                        },
                        "score": 0.8,
                    }
                ],
            )
        ],
    )

    _, children = await run_secondary_inference(
        db_session,
        annotation=box,
        task=task,
        backend=_fake_backend(),
        write_target="geometry",
        write_keys=None,
        label=None,
        model_id="det",
        model_variants={},
        params=None,
        task_type="detection",
        prompt=None,
        class_filter=None,
        pad=0.08,
        user_id=user.id,
    )
    assert len(children) == 1
    assert children[0].class_name == "__unknown"
    assert children[0].parent_annotation_id == box.id


@pytest.mark.asyncio
async def test_tiny_crop_raises_422(db_session, super_admin, monkeypatch, _patch_io):
    """v0.20.21 · 极小框 (退化 ROI) 不再静默返回空, 改明确 422 (不伪装成没结果)。"""
    user, _ = super_admin
    proj = await create_project(db_session, owner_id=user.id, type_key="image-det")
    task = await create_task(db_session, project_id=proj.id)
    await db_session.flush()
    # 极小框 (200px 图上 1% 宽高 = 2px < min_crop_side_px=32) → crop 守卫跳过
    svc = AnnotationService(db_session)
    box = await svc.create(
        task_id=task.id,
        user_id=user.id,
        annotation_type="bbox",
        class_name="car",
        geometry={"type": "bbox", "x": 0.5, "y": 0.5, "w": 0.01, "h": 0.01},
        tool_unit_id="bbox",
    )
    await db_session.flush()

    _patch_predict(monkeypatch, [])  # 不应被调用

    with pytest.raises(HTTPException) as exc:
        await run_secondary_inference(
            db_session,
            annotation=box,
            task=task,
            backend=_fake_backend(),
            write_target="attributes",
            write_keys=None,
            label=None,
            model_id="cls",
            model_variants=None,
            params=None,
            task_type="classification",
            prompt=None,
            class_filter=None,
            pad=0.08,
            user_id=user.id,
        )
    assert exc.value.status_code == 422


@pytest.mark.asyncio
async def test_non_croppable_geometry_raises_400(db_session, super_admin, monkeypatch):
    """v0.20.21 · 门1 能转 LS shape 但门2 取不到外接框的几何 (如 polyline) → 明确 400。"""
    # polyline 门1 → polylinelabels, 门2 _box_bbox_pct 非 rectangle/polygon → None → 400。
    # 400 在读图 / 裁 crop 之前触发, 用 fake annotation 即可 (不落库)。
    _patch_predict(monkeypatch, [])  # 不应被调用
    fake_ann = types.SimpleNamespace(
        id="ann-0001",
        geometry={"type": "polyline", "points": [[0.2, 0.2], [0.5, 0.5], [0.7, 0.3]]},
        class_name="lane",
        confidence=None,
    )

    with pytest.raises(HTTPException) as exc:
        await run_secondary_inference(
            db_session,
            annotation=fake_ann,
            task=types.SimpleNamespace(id="task-0001"),
            backend=_fake_backend(),
            write_target="attributes",
            write_keys=None,
            label=None,
            model_id="cls",
            model_variants=None,
            params=None,
            task_type="classification",
            prompt=None,
            class_filter=None,
            pad=0.08,
            user_id="user-0001",
        )
    assert exc.value.status_code == 400
    assert "polyline" in exc.value.detail
