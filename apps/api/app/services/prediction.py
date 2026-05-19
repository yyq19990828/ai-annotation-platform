from __future__ import annotations

import uuid
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.prediction import Prediction, PredictionMeta, FailedPrediction
from app.db.models.task import Task


def derive_tool_unit_from_ls_type(typ: str | None) -> str:
    """v0.10.17 · LabelStudio result.type → tool_unit_id.

    polygonlabels / brushlabels / multi_polygon → region; rectanglelabels →
    bbox; 其它 (keypointlabels / linelabels / ...) 当前归 bbox 占位.
    """
    if typ in {"polygonlabels", "brushlabels", "multi_polygon"}:
        return "region"
    return "bbox"


def derive_tool_unit_from_result(result: list[dict] | None) -> str:
    """v0.10.17 · 从 prediction.result 数组首条 shape.type 派生 tool_unit_id."""
    if not result:
        return "bbox"
    first = result[0] if isinstance(result[0], dict) else {}
    return derive_tool_unit_from_ls_type(first.get("type"))


def to_internal_shape(s: dict) -> dict:
    """v0.9.7 fix · LabelStudio 标准 result shape → 内部前端 schema.

    Worker 把 ML backend 返回的 LabelStudio 标准 ``{type, value, score}`` 原样
    存入 ``predictions.result``; 前端 ``predictionsToBoxes``
    (apps/web/.../transforms.ts) 期望 ``{type, class_name, geometry, confidence}``.
    历史 v0.9.4 phase 1 后端真正接通 SAM/DINO 时引入这个 schema gap, 一直未发现
    (因为前端工作台未真实跑过预标 → 渲染候选). 本 adapter 在 read 路径补这层转换;
    DB 维持 LabelStudio 标准 (与导出 / CVAT 等通用工具兼容).

    兼容旧格式: 已有 ``geometry`` 字段时 pass-through, 不做二次转换.
    v0.10.17 · 返回字典含 ``tool_unit_id``, 由 LS type 派生.
    """
    if not isinstance(s, dict):
        return {}
    if "geometry" in s:
        # 老路径已经是内部 schema; v0.10.17 在缺 tool_unit_id 时按 type 反推**就地**回填,
        # 保留原 dict identity (`is raw`) 以保兼容历史调用方依赖.
        if "tool_unit_id" not in s:
            s["tool_unit_id"] = derive_tool_unit_from_ls_type(s.get("type"))
        return s

    typ = s.get("type", "rectanglelabels")
    val = s.get("value") or {}
    raw_score = s.get("score")
    if raw_score is None:
        raw_score = s.get("confidence")
    confidence = float(raw_score) if raw_score is not None else 0.0

    # LabelStudio 字段名约定: value.{type} 是 label 数组 (rectanglelabels/polygonlabels/...)
    labels = val.get(typ)
    if not labels:
        labels = val.get("labels") or []
    if not labels and "class" in val:
        labels = [val["class"]]
    class_name = labels[0] if labels else ""

    if typ == "rectanglelabels":
        geometry = {
            "type": "bbox",
            "x": float(val.get("x", 0)),
            "y": float(val.get("y", 0)),
            "w": float(val.get("width", 0)),
            "h": float(val.get("height", 0)),
        }
    elif typ == "polygonlabels":
        # v0.9.14 · 三种 LS shape 兼容:
        #   ① 旧: {points: [[x,y]...]}                      → polygon (无 hole)
        #   ② 新单连通带 hole: {points, holes: [[[x,y]...]]} → polygon (带 hole)
        #   ③ 新多连通: {polygons: [{points, holes?}, ...]}  → multi_polygon
        # ② / ③ 由 grounded-sam2-backend predictor.py 在 mask 多连通或带 hole 时输出.
        # 老路径 (无 holes / polygons) 输出字面与 v0.9.13 之前完全一致, 不写 holes 字段
        # 给老 fixture / 老 DB JSONB 持续兼容; PolygonGeometry.holes 默认 [] 由 Pydantic 补.
        polygons_raw = val.get("polygons")
        if polygons_raw:
            new_polys: list[dict] = []
            for p in polygons_raw:
                entry: dict = {"type": "polygon", "points": p.get("points", [])}
                holes = p.get("holes") or []
                if holes:
                    entry["holes"] = holes
                new_polys.append(entry)
            geometry = {"type": "multi_polygon", "polygons": new_polys}
        else:
            geometry = {
                "type": "polygon",
                "points": val.get("points", []),
            }
            holes = val.get("holes") or []
            if holes:
                geometry["holes"] = holes
    else:
        geometry = {}

    return {
        "type": typ,
        "class_name": class_name,
        "geometry": geometry,
        "confidence": confidence,
        # v0.10.17 · 与 prediction.tool_unit_id 派生同源.
        "tool_unit_id": derive_tool_unit_from_ls_type(typ),
    }


class PredictionService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def create_from_ml_result(
        self,
        task_id: uuid.UUID,
        project_id: uuid.UUID,
        ml_backend_id: uuid.UUID | None,
        result: list[dict],
        score: float | None = None,
        model_version: str | None = None,
        inference_time_ms: int | None = None,
        token_meta: dict | None = None,
        source: str = "ml_backend",
    ) -> Prediction:
        prediction = Prediction(
            id=uuid.uuid4(),
            task_id=task_id,
            project_id=project_id,
            ml_backend_id=ml_backend_id,
            model_version=model_version,
            score=score,
            # v0.10.17 · 按 result[0].type 派生 tool_unit_id.
            tool_unit_id=derive_tool_unit_from_result(result),
            result=result,
            source=source,
        )
        self.db.add(prediction)
        await self.db.flush()

        meta_data = token_meta or {}
        meta = PredictionMeta(
            id=uuid.uuid4(),
            prediction_id=prediction.id,
            inference_time_ms=inference_time_ms,
            prompt_tokens=meta_data.get("prompt_tokens"),
            completion_tokens=meta_data.get("completion_tokens"),
            total_tokens=meta_data.get("total_tokens"),
            prompt_cost=meta_data.get("prompt_cost"),
            completion_cost=meta_data.get("completion_cost"),
            total_cost=meta_data.get("total_cost"),
        )
        self.db.add(meta)

        await self.db.execute(select(Task).where(Task.id == task_id).with_for_update())
        task = await self.db.get(Task, task_id)
        if task:
            task.total_predictions = (task.total_predictions or 0) + 1

        await self.db.flush()
        return prediction

    async def create_failed(
        self,
        task_id: uuid.UUID | None,
        project_id: uuid.UUID,
        ml_backend_id: uuid.UUID | None,
        error_type: str,
        message: str,
        model_version: str | None = None,
    ) -> FailedPrediction:
        failed = FailedPrediction(
            id=uuid.uuid4(),
            task_id=task_id,
            project_id=project_id,
            ml_backend_id=ml_backend_id,
            model_version=model_version,
            error_type=error_type,
            message=message,
        )
        self.db.add(failed)
        await self.db.flush()
        return failed

    async def list_by_task(
        self, task_id: uuid.UUID, model_version: str | None = None
    ) -> list[Prediction]:
        q = select(Prediction).where(Prediction.task_id == task_id)
        if model_version:
            q = q.where(Prediction.model_version == model_version)
        q = q.order_by(Prediction.created_at.desc())
        result = await self.db.execute(q)
        return list(result.scalars().all())

    async def get_latest_for_task(self, task_id: uuid.UUID) -> Prediction | None:
        result = await self.db.execute(
            select(Prediction)
            .where(Prediction.task_id == task_id)
            .order_by(Prediction.created_at.desc())
            .limit(1)
        )
        return result.scalar_one_or_none()
