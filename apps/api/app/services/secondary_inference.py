"""v0.20.11 · 选中框单框二次推理 (Q1b)。

选中一个已落库标注 → 把它的 bbox 当 ROI 裁 crop → 同步喂某能力 backend /predict →
产物按类型归位: 属性型写回原框 (attributes_meta 标 origin=ai, 走 v0.20.10)、几何型建
子框 (parent_annotation_id=选中框, 走 v0.20.9)。

**复用 batch pipeline 下游阶段的同一套投递**: `crop_inputs_from_boxes` (裁 ROI + 上传) +
`_build_predict_context` (构造 wire) + `merge_classify_attributes` / `remap_geometry_to_image`
(产物归位)。与批量二次推理是「同一能力两个触发面」, 产物 schema / 溯源写法一致。
不走 worker (单框同步秒回), 不新建投递逻辑。
"""

from __future__ import annotations

import logging
import uuid

from fastapi import HTTPException

from app.db.models.annotation import Annotation
from app.db.models.ml_backend_registry import MLBackendRegistry
from app.db.models.task import Task
from app.services.predictions_import import internal_geometry_to_ls_shape
from app.workers.roi import (
    crop_inputs_from_boxes,
    merge_classify_attributes,
    remap_geometry_to_image,
)


logger = logging.getLogger("app.services.secondary_inference")


async def _create_child_box(
    svc,
    *,
    task,
    user_id: uuid.UUID,
    annotation_type: str,
    class_name: str,
    geometry: dict,
    confidence: float | None,
    parent: Annotation,
) -> Annotation:
    """建子框; class 不在项目标签集时回落 "__unknown" 哨兵 (不丢 AI 检出框)。

    子检测产出 backend 原生类名 (NG6: 平台不做类→项目标签映射)。若该类名不在项目
    tool_bindings 允许集, create 的软校验会 422 —— 对 AI 产物不应丢框, 回落"未分类
    待补", 由用户后续归类。
    """
    try:
        return await svc.create(
            task_id=task.id,
            user_id=user_id,
            annotation_type=annotation_type,
            class_name=class_name,
            geometry=geometry,
            confidence=confidence,
            parent_annotation_id=parent.id,
            tool_unit_id=parent.tool_unit_id,
        )
    except HTTPException as exc:
        if exc.status_code != 422:
            raise
        logger.info(
            "secondary_inference: 子检测类名 %r 不在项目标签集, 回落 __unknown",
            class_name,
        )
        return await svc.create(
            task_id=task.id,
            user_id=user_id,
            annotation_type=annotation_type,
            class_name="__unknown",
            geometry=geometry,
            confidence=confidence,
            parent_annotation_id=parent.id,
            tool_unit_id=parent.tool_unit_id,
        )


async def run_secondary_inference(
    db,
    *,
    annotation: Annotation,
    task: Task,
    backend: MLBackendRegistry,
    write_target: str,
    write_keys: list[str] | None,
    label: str | None,
    model_id: str | None,
    model_variants: dict | None,
    params: dict | None,
    task_type: str | None,
    prompt: str | None,
    class_filter: list[int] | None,
    pad: float,
    user_id: uuid.UUID,
) -> tuple[Annotation, list[Annotation]]:
    """在选中框 ROI 上跑一次能力, 产物落库。返回 (更新后的原框, 新建子框列表)。

    - write_target="attributes": 分类 / OCR 属性 union 回原框, 写入键标 origin=ai。
    - write_target="geometry":   crop 上检出的子物几何回映后建子框, 挂在原框下。
    """
    # 惰性导入 worker 助手, 避免 API 进程在 import 期拉起 celery 相关重依赖。
    from app.workers.tasks import _build_predict_context, _load_task_image
    from app.services.ml_client import MLBackendClient
    from app.services.prediction import to_internal_shape
    from app.services.storage import StorageService

    # 1. 内部几何 (0-1) → LS 标准 box (百分比 0-100), 供 crop 复用批量投递。
    #    起始不带 attributes: merge 后 box["attributes"] 里的键即全为 AI 写入 (精确标 origin)。
    ls_box = internal_geometry_to_ls_shape(
        annotation.geometry, annotation.class_name, annotation.confidence
    )
    if ls_box is None:
        raise HTTPException(
            status_code=400,
            detail="selected annotation geometry is not croppable (need bbox/polygon)",
        )

    # 2. 读原图 (RGB) 供裁 ROI。
    image = _load_task_image(task)

    # 3. 裁 crop + 上传 (presigned, 对所有走 httpx.get 的 backend 通用)。
    #    自建 2 参 upload_fn (crop_inputs_from_boxes 调 upload_fn(idx, bytes));
    #    key 复用 batch 的 roi-crops/ 前缀 → 同享 import 桶 7 天 lifecycle 自清。
    storage = StorageService()

    def upload_fn(box_idx: int, jpeg_bytes: bytes) -> str:
        key = f"roi-crops/secondary/{annotation.id}/{box_idx}.jpg"
        return storage.upload_crop_bytes(jpeg_bytes, key)

    batch = crop_inputs_from_boxes(
        image,
        [ls_box],
        pad=pad,
        delivery="presigned",
        upload_fn=upload_fn,
        min_crop_side_px=32,
    )
    if not batch.inputs:
        # crop 被守卫跳过 (框太小 / 贴边退化) → 无产物, 原框不变。
        return annotation, []

    # 4. 构造发往 backend 的 context (与批量下游同一纯函数)。
    context = _build_predict_context(
        prompt=prompt,
        output_mode="polygon",
        params=params,
        model_id=model_id,
        task_type=task_type,
        model_variants=model_variants,
        class_filter=class_filter,
    )

    # 5. 同步推理。
    client = MLBackendClient(backend)
    results = await client.predict(batch.inputs, context=context)

    model_ref = {"backend_id": str(backend.id), "model_id": model_id}

    if write_target == "attributes":
        # 6a. 属性型: merge 进 (起始为空的) ls_box, 写入键即 AI 产物。
        merge_classify_attributes([ls_box], results, write_keys=write_keys, label=label)
        ai_attrs = ls_box.get("attributes") or {}
        if ai_attrs:
            # union 进原框 attributes, 并给每个 AI 写入键标 origin=ai + model_ref。
            merged_attrs = {**(annotation.attributes or {}), **ai_attrs}
            new_meta = dict(annotation.attributes_meta or {})
            for k in ai_attrs:
                new_meta[k] = {"origin": "ai", "model_ref": model_ref}
            annotation.attributes = merged_attrs
            annotation.attributes_meta = new_meta
            await db.flush()
        return annotation, []

    # 6b. 几何型: crop 检出几何回映回原图坐标 → 建子框, 挂原框下。
    from app.services.annotation import AnnotationService

    transform = batch.transforms.get("0")
    raw_shapes = [s for cr in results for s in (cr.result or []) if isinstance(s, dict)]
    remapped = remap_geometry_to_image(raw_shapes, transform) if transform else []

    svc = AnnotationService(db)
    children: list[Annotation] = []
    for shp in remapped:
        internal = to_internal_shape(shp)
        geometry = internal.get("geometry")
        if not geometry:
            continue
        detected_class = internal.get("class_name") or annotation.class_name
        child = await _create_child_box(
            svc,
            task=task,
            user_id=user_id,
            annotation_type=internal.get("type", "bbox"),
            class_name=detected_class,
            geometry=geometry,
            confidence=internal.get("confidence"),
            parent=annotation,
        )
        # AI 产物: 与批量二次推理一致标 prediction_based (create 默认 manual)。
        child.source = "prediction_based"
        children.append(child)
    if children:
        await db.flush()
    return annotation, children
