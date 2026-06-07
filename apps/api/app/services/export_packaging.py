"""导出打包编排（2026-05-20 计划 §4 阶段 3）。

在现有 ExportService 之上做"目录镜像"重组：

- `relative_path_from_file_path`：把完整 MinIO key（`{dataset}/animals/cat/001.jpg`）
  剥成数据集内相对路径（`animals/cat/001.jpg`），是导出镜像的核心 helper（导入端可共用）。
- `build_export_zip`：复用 ExportService 加载数据 + 派生类别/属性 schema，但 label 文件
  按 `{project_id}/{dataset_id}/labels/<rel>.txt` 镜像组织（消除 file_name 叶子名同名覆盖），
  并附带 data.yaml / images_manifest.json / fetch_images.py。COCO 像素坐标改用
  DatasetItem.width/height 真值（顺修硬编码 IMG_W/IMG_H bug）。

复用策略（见汇报）：
- YOLO：不复用 export_yolo 的扁平 ZIP 写法（它把 label 路径写死成叶子名），改在此处用
  ExportService 内部加载结果 + geometry helper 自己写镜像目录。
- COCO / AAP JSON：是单文档格式（无 per-image label 文件），直接调 ExportService 现有方法拿
  JSON 字符串落包根，COCO 额外传入 dataset_items 让坐标用真值。
"""

from __future__ import annotations

import json
import math
import os
import tempfile
import uuid
import zipfile
from datetime import datetime, timezone
from posixpath import splitext
from typing import AsyncIterator

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.annotation import Annotation
from app.db.models.dataset import DatasetItem
from app.db.models.project import Project
from app.db.models.task import Task
from app.db.models.task_dataset_item_link import TaskDatasetItemLink
from app.schemas._jsonb_types import SensorCalibration
from app.services.export import (
    ExportService,
    UnsupportedExportError,
    _bbox_geometry,
)
from app.services.axis_convention import AxisFrame
from app.services.export_lidar import (
    LidarFrameExportCtx,
    build_kitti_lidar_label_lines,
    build_nuscenes_frame_records,
    build_pointmask_label_bytes,
    category_map_json,
)
from app.services.export_video import (
    FALLBACK_H,
    FALLBACK_W,
    build_kitti_labels,
    build_mot_gt,
    build_mot_seqinfo,
    build_yolo_frame_det_labels,
)
from app.services.project import (
    derive_attribute_schema,
    derive_classes_list,
)
from app.services.storage import storage_service
from app.services.video_frame_service import derive_sampled_frames, derive_step
from app.services.video_tracks import derive_track_number

VIDEO_EXPORT_FORMATS = {"video_json", "aap_json", "mot", "kitti", "yolo-frames-det"}
LIDAR_EXPORT_TARGETS = {"aap_json", "kitti", "nuscenes", "pointmask"}

# v0.10.43 · 多目标导出：图像目标（yolo 旧值=yolo-det）+ 视频目标 + voc（仅同步单目标）。
IMAGE_EXPORT_TARGETS = {"coco", "yolo", "yolo-det", "yolo-obb", "yolo-seg", "aap_json"}
ALL_EXPORT_TARGETS = (
    IMAGE_EXPORT_TARGETS | VIDEO_EXPORT_FORMATS | LIDAR_EXPORT_TARGETS | {"voc"}
)


def clean_export_targets(targets: list[str], data_type: str | None = None) -> list[str]:
    """去重保序 + 校验目标合法。非法或空抛 ValueError（端点转 400）。

    v0.10.47 · 传入项目 ``data_type`` 时按模态过滤：图像项目只接受图像目标（+ voc），
    视频项目只接受视频目标。否则一个跨模态目标会通过端点校验、派发 job，随后在
    ``build_export_zip`` 抛 ``UnsupportedExportError`` 拖垮整批（含合法目标）。
    ``data_type=None`` 时退回旧行为（接受全集），保持向后兼容。
    """
    if data_type == "video":
        allowed = VIDEO_EXPORT_FORMATS
    elif data_type == "image":
        allowed = IMAGE_EXPORT_TARGETS | {"voc"}
    elif data_type == "lidar":
        allowed = LIDAR_EXPORT_TARGETS
    else:
        allowed = ALL_EXPORT_TARGETS
    seen: list[str] = []
    for t in targets:
        if t not in allowed:
            scope = f" for {data_type} project" if data_type else ""
            raise ValueError(f"unsupported export target{scope}: {t}")
        if t not in seen:
            seen.append(t)
    if not seen:
        raise ValueError("targets must not be empty")
    return seen


# 预签名 URL / 桶 lifecycle 对齐 7 天。
PRESIGN_EXPIRES_SECONDS = 7 * 24 * 3600


def relative_path_from_file_path(file_path: str, dataset_name: str) -> str:
    """剥掉 `{dataset_name}/` 前缀，得到数据集内相对路径（posix `/`）。

    `file_path` = 完整 MinIO key（如 `mydataset/animals/cat/001.jpg`），叶子名不足以唯一
    定位（同名跨目录会覆盖），故必须用相对路径镜像目录。

    前缀匹配（首段 == dataset_name）才剥；不匹配则原样返回（保守，避免误删层级）。
    """
    path = (file_path or "").lstrip("/")
    if not dataset_name:
        return path
    prefix = f"{dataset_name}/"
    if path.startswith(prefix):
        return path[len(prefix) :]
    return path


_FETCH_IMAGES_TEMPLATE = '''#!/usr/bin/env python3
"""按 images_manifest.json 的预签名 URL 把图片回源到 images/<相对路径>，与 labels/ 平行。

纯标准库，无需配置 MinIO 密钥（URL 已带 7 天签名）。本地已有数据集则无需运行本脚本。
"""
import json
import os
import sys
import urllib.request
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))


def main() -> int:
    manifest_path = os.path.join(HERE, "images_manifest.json")
    with open(manifest_path, "r", encoding="utf-8") as f:
        manifest = json.load(f)

    items = manifest.get("images", [])
    # 过期校验：取最早 expires_at 提示。
    soonest = None
    for it in items:
        exp = it.get("expires_at")
        if exp:
            try:
                dt = datetime.fromisoformat(exp)
            except ValueError:
                continue
            if soonest is None or dt < soonest:
                soonest = dt
    if soonest is not None:
        now = datetime.now(timezone.utc)
        remaining = soonest - now
        if remaining.total_seconds() <= 0:
            print(
                "[!] 预签名链接已于 %s 过期，请回平台重新导出。" % soonest.isoformat()
            )
            return 2
        print(
            "[i] 预签名链接将于 %s 过期（剩约 %d 天），请尽快下载。"
            % (soonest.isoformat(), int(remaining.total_seconds() // 86400))
        )

    ok = 0
    fail = 0
    for it in items:
        rel = it.get("rel_path")
        url = it.get("presigned_url")
        if not rel or not url:
            continue
        dest = os.path.join(HERE, "images", *rel.split("/"))
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        if os.path.exists(dest):
            ok += 1
            continue
        try:
            urllib.request.urlretrieve(url, dest)
            ok += 1
        except Exception as exc:  # noqa: BLE001
            print("[x] 下载失败 %s: %s" % (rel, exc))
            fail += 1
    print("[done] 成功 %d，失败 %d，输出目录 images/" % (ok, fail))
    return 0 if fail == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
'''


_FETCH_POINTCLOUDS_TEMPLATE = '''#!/usr/bin/env python3
"""按 pointclouds_manifest.json 的预签名 URL 把点云回源到 velodyne/<相对路径>。

纯标准库，无需 MinIO 密钥（URL 已带 7 天签名）。label 索引对应这里回源的同一份点云。
"""
import json
import os
import sys
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))


def main() -> int:
    with open(os.path.join(HERE, "pointclouds_manifest.json"), "r", encoding="utf-8") as f:
        manifest = json.load(f)
    ok = 0
    fail = 0
    for it in manifest.get("pointclouds", []):
        rel = it.get("rel_path")
        url = it.get("presigned_url")
        if not rel or not url:
            continue
        dest = os.path.join(HERE, "velodyne", *rel.split("/"))
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        if os.path.exists(dest):
            ok += 1
            continue
        try:
            urllib.request.urlretrieve(url, dest)
            ok += 1
        except Exception as exc:  # noqa: BLE001
            print("[x] 下载失败 %s: %s" % (rel, exc))
            fail += 1
    print("[done] 点云回源 成功 %d，失败 %d，输出目录 velodyne/" % (ok, fail))
    return 0 if fail == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
'''


def _dataset_name_for_task(task: Task, item: DatasetItem | None) -> str:
    """数据集名 = file_path 首段（Web/scan 导入时 file_path = key 含 dataset 前缀）。"""
    path = (task.file_path or "").lstrip("/")
    return path.split("/", 1)[0] if "/" in path else ""


def _label_rel(task: Task, item: DatasetItem | None) -> str:
    """label 相对路径（去 dataset 前缀，去扩展名）。"""
    dataset_name = _dataset_name_for_task(task, item)
    rel = relative_path_from_file_path(task.file_path, dataset_name)
    base, _ext = splitext(rel)
    return base


def _yolo_lines(
    anns: list[Annotation],
    cat_map: dict[str, int],
    include_attributes: bool,
) -> tuple[list[str], list[dict]]:
    lines: list[str] = []
    attrs_per_line: list[dict] = []
    for ann in anns:
        g = _bbox_geometry(ann)
        if g is None:
            continue
        cx = g["x"] + g["w"] / 2
        cy = g["y"] + g["h"] / 2
        cid = cat_map.get(ann.class_name, 0)
        lines.append(f"{cid} {cx:.6f} {cy:.6f} {g['w']:.6f} {g['h']:.6f}")
        if include_attributes:
            attrs_per_line.append(ann.attributes or {})
    return lines, attrs_per_line


# v0.10.43 · YOLO 变体写入器（det/obb/seg）。det=bbox，obb=rotated_bbox 四角，
# seg=polygon/multi_polygon 归一化多边形。坐标均归一化 [0,1]；obb 在像素空间旋转再归一化。
YOLO_TARGETS = {"yolo", "yolo-det", "yolo-obb", "yolo-seg"}


def _rotated_corners_norm(g: dict, w: int, h: int) -> list[float]:
    """rotated_bbox(cx,cy,w,h,angle°顺时针) → 归一化四角 [x1,y1,...,x4,y4]。

    归一化坐标 x、y 尺度不同（图像非正方形），旋转须在像素空间做再归一化。
    """
    cxp, cyp = g["cx"] * w, g["cy"] * h
    bw, bh = g["w"] * w, g["h"] * h
    rad = math.radians(g.get("angle", 0) or 0)
    cos, sin = math.cos(rad), math.sin(rad)
    out: list[float] = []
    for dx, dy in (
        (-bw / 2, -bh / 2),
        (bw / 2, -bh / 2),
        (bw / 2, bh / 2),
        (-bw / 2, bh / 2),
    ):
        rx = dx * cos - dy * sin
        ry = dx * sin + dy * cos
        out.extend([(cxp + rx) / w, (cyp + ry) / h])
    return out


def _seg_rings_norm(g: dict) -> list[list[list[float]]]:
    """polygon / multi_polygon → 归一化外环顶点列表（每环 [[x,y],...]）。"""
    t = g.get("type")
    if t == "polygon":
        pts = g.get("points") or []
        return [pts] if len(pts) >= 3 else []
    if t == "multi_polygon":
        rings = []
        for poly in g.get("polygons") or []:
            pts = poly.get("points") or []
            if len(pts) >= 3:
                rings.append(pts)
        return rings
    return []


def _yolo_target_lines(
    target: str,
    anns: list[Annotation],
    cat_map: dict[str, int],
    *,
    img_w: int,
    img_h: int,
    include_attributes: bool,
) -> tuple[list[str], list[dict]]:
    """按 YOLO 变体生成 label 行 + 对齐的 attrs（每产出一条目标物 append 一次属性）。"""
    if target in ("yolo", "yolo-det"):
        return _yolo_lines(anns, cat_map, include_attributes)
    lines: list[str] = []
    attrs: list[dict] = []
    for ann in anns:
        cid = cat_map.get(ann.class_name, 0)
        g = ann.geometry or {}
        produced = 0
        if target == "yolo-obb":
            if g.get("type") != "rotated_bbox":
                continue
            corners = _rotated_corners_norm(g, img_w, img_h)
            lines.append(f"{cid} " + " ".join(f"{c:.6f}" for c in corners))
            produced = 1
        elif target == "yolo-seg":
            rings = _seg_rings_norm(g)
            for ring in rings:
                flat = " ".join(f"{coord:.6f}" for pt in ring for coord in pt[:2])
                lines.append(f"{cid} {flat}")
            produced = len(rings)
        if produced and include_attributes:
            attrs.extend([ann.attributes or {}] * produced)
    return lines, attrs


# v0.12.1 · B6 流式导出：打包函数消费 (tasks, ann_by_task, dataset_items) 的异步分块
# 迭代器（生产由 ExportService.iter_export_chunks 流式产出，测试可喂内存 chunk），ZIP 落盘
# tempfile 而非 io.BytesIO 攒整包，内存与 task 数解耦。
ExportChunkIter = AsyncIterator[
    tuple[list[Task], dict[uuid.UUID, list[Annotation]], dict[uuid.UUID, DatasetItem]]
]


def _new_zip_tempfile() -> str:
    """创建空 tempfile 供 ZipFile 落盘写入，返回路径（调用方负责清理）。"""
    fd, path = tempfile.mkstemp(prefix="aap-export-", suffix=".zip")
    os.close(fd)
    return path


def _safe_unlink(path: str) -> None:
    try:
        os.unlink(path)
    except OSError:
        pass


async def build_export_zip(
    db: AsyncSession,
    project_id: uuid.UUID,
    *,
    batch_id: uuid.UUID | None,
    targets: list[str],
    include_attributes: bool,
    video_frame_mode: str,
    axis_frame: AxisFrame = "iso",
) -> tuple[str, int, int]:
    """生成镜像目录 ZIP 到磁盘临时文件，返回 (zip 路径, label 文件数, size_bytes)。

    v0.12.1 · B6 · 落盘 + 流式：ZIP 写 tempfile（不再 io.BytesIO 攒整包驻留 RAM）；
    per-file 格式（YOLO 镜像）按 task 分块流式产出 annotation。COCO/AAP 是单文档 JSON，
    本质要全量物化（流式 JSON 编码不在本版范围），仍由 ExportService 自加载。
    调用方（worker）负责上传后清理返回的 zip 路径；本函数内部异常时清理自身临时文件。

    v0.10.43 · 多目标（方案 B）：单目标落包根（向后兼容旧布局），>1 目标各落 `{target}/` 子目录。
    图像 targets ∈ {coco, yolo-det, yolo-obb, yolo-seg, aap_json}（`yolo` 兼容旧 = yolo-det）。
    VOC 走旧同步路径，不在此处。
    """
    svc = ExportService(db)
    project = await svc.db.get(Project, project_id)

    tmp_path = _new_zip_tempfile()
    try:
        if project is None:
            with zipfile.ZipFile(tmp_path, "w", zipfile.ZIP_DEFLATED):
                pass
            return tmp_path, 0, os.path.getsize(tmp_path)

        # v0.10.31 · Phase 4.1 · 视频项目走独立组装（manifest + 视频回源脚本 + 多格式）。
        if project.data_type == "video":
            needs_ann = bool({"mot", "kitti", "yolo-frames-det"} & set(targets))
            chunks = svc.iter_export_chunks(
                project_id, batch_id, with_annotations=needs_ann
            )
            return await _build_video_export_zip(
                svc,
                project,
                chunks,
                tmp_path=tmp_path,
                batch_id=batch_id,
                targets=targets,
                include_attributes=include_attributes,
                video_frame_mode=video_frame_mode,
            )

        if project.data_type == "lidar":
            chunks = svc.iter_export_chunks(
                project_id,
                batch_id,
                with_annotations=bool(
                    {"kitti", "nuscenes", "pointmask"} & set(targets)
                ),
            )
            return await _build_lidar_export_zip(
                svc,
                project,
                chunks,
                tmp_path=tmp_path,
                batch_id=batch_id,
                targets=targets,
                include_attributes=include_attributes,
            )

        classes_list = derive_classes_list(project.tool_bindings)
        attribute_schema = derive_attribute_schema(project.tool_bindings)
        cat_map = {name: i for i, name in enumerate(classes_list)}

        multi = len(targets) > 1
        yolo_targets = [t for t in targets if t in YOLO_TARGETS]
        other_targets = [t for t in targets if t not in YOLO_TARGETS]
        for target in other_targets:
            if target not in ("coco", "aap_json"):
                raise UnsupportedExportError(f"unsupported export target: {target}")
        has_yolo = bool(yolo_targets)
        # COCO 需 DatasetItem 真值尺寸算像素坐标；仅在请求 coco 时累积全量 items
        # （coco 本身单文档全量物化，O(N) items 不额外恶化）。纯 YOLO 不累积，保持流式。
        dataset_items_all: dict[uuid.UUID, DatasetItem] | None = (
            {} if "coco" in targets else None
        )

        file_count = 0
        total_tasks = 0
        now = datetime.now(timezone.utc)
        expires_iso = datetime.fromtimestamp(
            now.timestamp() + PRESIGN_EXPIRES_SECONDS, tz=timezone.utc
        ).isoformat()

        with zipfile.ZipFile(tmp_path, "w", zipfile.ZIP_DEFLATED) as zf:
            # 共享产物（格式无关）：类别清单 + 属性 schema。
            zf.writestr("classes.txt", "\n".join(classes_list))
            if include_attributes:
                zf.writestr(
                    "attribute_schema.json",
                    json.dumps(attribute_schema, ensure_ascii=False, indent=2),
                )

            # Pass 1（仅 YOLO 目标）：流式写镜像 labels（需 annotation）。
            if yolo_targets:
                async for tasks, ann_by_task, dataset_items in svc.iter_export_chunks(
                    project_id, batch_id, with_annotations=True
                ):
                    for t in tasks:
                        item = (
                            dataset_items.get(t.dataset_item_id)
                            if t.dataset_item_id
                            else None
                        )
                        for target in yolo_targets:
                            prefix = f"{target}/" if multi else ""
                            rel = _label_rel(t, item)
                            img_w = (
                                int(item.width) if item and item.width else FALLBACK_W
                            )
                            img_h = (
                                int(item.height) if item and item.height else FALLBACK_H
                            )
                            lines, attrs_per_line = _yolo_target_lines(
                                target,
                                ann_by_task.get(t.id, []),
                                cat_map,
                                img_w=img_w,
                                img_h=img_h,
                                include_attributes=include_attributes,
                            )
                            dataset_id = str(item.dataset_id) if item else "unknown"
                            base = f"{prefix}{project_id}/{dataset_id}/labels/{rel}"
                            zf.writestr(f"{base}.txt", "\n".join(lines))
                            file_count += 1
                            if include_attributes and attrs_per_line:
                                zf.writestr(
                                    f"{base}.attrs.json",
                                    json.dumps(
                                        {"attributes": attrs_per_line},
                                        ensure_ascii=False,
                                    ),
                                )
                for target in yolo_targets:
                    prefix = f"{target}/" if multi else ""
                    zf.writestr(f"{prefix}data.yaml", _build_data_yaml(classes_list))

            # Pass 2：流式写 images_manifest.json —— 边遍历边写 zip entry（O(1) 内存，
            # 不把十万条 manifest dict 攒进 RAM，这是 B6「内存与 task 数解耦」的关键），
            # 顺带计 task 数 + 累积 coco 所需 items（不需 annotation）。
            with zf.open("images_manifest.json", "w") as mf:
                mf.write(b'{"images": [')
                first = True
                async for tasks, _ann, dataset_items in svc.iter_export_chunks(
                    project_id, batch_id, with_annotations=False
                ):
                    total_tasks += len(tasks)
                    if dataset_items_all is not None:
                        dataset_items_all.update(dataset_items)
                    for t in tasks:
                        item = (
                            dataset_items.get(t.dataset_item_id)
                            if t.dataset_item_id
                            else None
                        )
                        dataset_name = _dataset_name_for_task(t, item)
                        img_rel = relative_path_from_file_path(
                            t.file_path, dataset_name
                        )
                        presigned = storage_service.generate_download_url(
                            t.file_path,
                            expires_in=PRESIGN_EXPIRES_SECONDS,
                            bucket=storage_service.datasets_bucket,
                        )
                        entry = {
                            "rel_path": img_rel,
                            "dataset_id": str(item.dataset_id) if item else None,
                            "presigned_url": presigned,
                            "expires_at": expires_iso,
                        }
                        mf.write(b"" if first else b", ")
                        mf.write(json.dumps(entry, ensure_ascii=False).encode("utf-8"))
                        first = False
                mf.write(b'], "expires_at": ')
                mf.write(json.dumps(expires_iso).encode("utf-8"))
                mf.write(b"}")

            # 单文档目标（coco/aap_json）：本质全量物化，svc 自加载落包根/子目录。
            for target in other_targets:
                prefix = f"{target}/" if multi else ""
                if target == "coco":
                    content = await svc.export_coco(
                        project_id,
                        batch_id=batch_id,
                        include_attributes=include_attributes,
                        video_frame_mode=video_frame_mode,
                        dataset_items=dataset_items_all or {},
                        axis_frame=axis_frame,
                    )
                else:  # aap_json
                    content = await svc.export_aap_json(
                        project_id,
                        batch_id=batch_id,
                        axis_frame=axis_frame,
                    )
                zf.writestr(f"{prefix}annotations.json", content)
                file_count += total_tasks

            zf.writestr("fetch_images.py", _FETCH_IMAGES_TEMPLATE)
            # 单 YOLO 目标根 data.yaml 已在上面写；纯 COCO/AAP 单目标补一份（兼容旧包结构）。
            if not multi and not has_yolo:
                zf.writestr("data.yaml", _build_data_yaml(classes_list))

        return tmp_path, file_count, os.path.getsize(tmp_path)
    except BaseException:
        _safe_unlink(tmp_path)
        raise


def _build_data_yaml(classes_list: list[str]) -> str:
    """YOLO 训练入口：images/ 与 labels/ 平行（fetch_images.py 把图拉到 images/）。"""
    names = "\n".join(f"  {i}: {name}" for i, name in enumerate(classes_list))
    return (
        "# YOLO 数据集入口（由 AAP 导出生成）\n"
        "# images/ 由 fetch_images.py 按 images_manifest.json 回源；labels/ 已在包内。\n"
        "path: .\n"
        "train: images\n"
        "val: images\n"
        f"nc: {len(classes_list)}\n"
        "names:\n"
        f"{names}\n"
    )


def _build_video_yolo_data_yaml(classes_list: list[str]) -> str:
    """视频逐帧 YOLO 训练入口：fetch_frames.py 把帧抽到 images/。"""
    names = "\n".join(f"  {i}: {name}" for i, name in enumerate(classes_list))
    return (
        "# 视频逐帧 YOLO 数据集入口（由 AAP 导出生成）\n"
        "# images/ 由 fetch_frames.py 按 manifest.json 抽帧；labels/ 已在包内。\n"
        "path: .\n"
        "train: images\n"
        "val: images\n"
        f"nc: {len(classes_list)}\n"
        "names:\n"
        f"{names}\n"
    )


# ── v0.14.7 · LiDAR 标准训练格式导出 ─────────────────────────────────


def _lidar_frame_key(task: Task, item: DatasetItem | None) -> str:
    rel = _label_rel(task, item)
    return rel or task.display_id


def _calibration_for_item(item: DatasetItem | None) -> SensorCalibration | None:
    if item is None:
        return None
    raw = (item.metadata_ or {}).get("calibration")
    if raw is None:
        return None
    try:
        return SensorCalibration.model_validate(raw)
    except ValueError:
        return None


def _camera_name(link: TaskDatasetItemLink) -> str:
    if link.sensor_name:
        return link.sensor_name
    if link.role.startswith("camera_"):
        return link.role[len("camera_") :]
    return link.role


async def _load_lidar_link_items(
    svc: ExportService,
    tasks: list[Task],
) -> dict[uuid.UUID, dict[str, tuple[TaskDatasetItemLink, DatasetItem]]]:
    task_ids = [task.id for task in tasks]
    if not task_ids:
        return {}
    result = await svc.db.execute(
        select(TaskDatasetItemLink, DatasetItem)
        .join(DatasetItem, DatasetItem.id == TaskDatasetItemLink.dataset_item_id)
        .where(TaskDatasetItemLink.task_id.in_(task_ids))
        .order_by(TaskDatasetItemLink.role)
    )
    out: dict[uuid.UUID, dict[str, tuple[TaskDatasetItemLink, DatasetItem]]] = {}
    for link, item in result.all():
        out.setdefault(link.task_id, {})[link.role] = (link, item)
    return out


def _kitti_calib_text(calib: SensorCalibration | None) -> str:
    header = ""
    if calib is None:
        # 缺标定时仍写出单位矩阵占位, 但加显式警告 + 文件名标记 (.unverified),
        # 避免下游误把它当真实标定做 3D→2D 投影得到错误结果。
        header = (
            "# AAP WARNING: no calibration found for this frame; the matrices "
            "below are identity placeholders and MUST NOT be used for 3D->2D "
            "projection.\n"
        )
        p2 = [1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0]
        r0 = [1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0]
        tr = [1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0]
    else:
        k = [float(v) for v in calib.intrinsic]
        p2 = [k[0], k[1], k[2], 0.0, k[3], k[4], k[5], 0.0, k[6], k[7], k[8], 0.0]
        if calib.rect:
            r = [float(v) for v in calib.rect]
            r0 = [r[0], r[1], r[2], r[4], r[5], r[6], r[8], r[9], r[10]]
        else:
            r0 = [1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0]
        e = [float(v) for v in calib.extrinsic]
        tr = [e[0], e[1], e[2], e[3], e[4], e[5], e[6], e[7], e[8], e[9], e[10], e[11]]
    return header + "\n".join(
        [
            "P2: " + " ".join(f"{v:.12g}" for v in p2),
            "R0_rect: " + " ".join(f"{v:.12g}" for v in r0),
            "Tr_velo_to_cam: " + " ".join(f"{v:.12g}" for v in tr),
            "",
        ]
    )


def _lidar_readme(target: str) -> str:
    common = (
        "AAP LiDAR export v0.14.7\n"
        "Images and point clouds are referenced by presigned manifests; run the "
        "fetch scripts before training if local media is needed.\n"
        "point_mask_3d labels index the point order of the fetched point cloud.\n"
    )
    if target == "nuscenes":
        return (
            common + "\nnuScenes note: this is a single-frame sample-style subset. "
            "sample_annotation.translation is in AAP ego/ISO coordinates, and "
            "ego_pose rows are identity placeholders because persisted global "
            "ego poses are planned for v0.15.0.\n"
        )
    if target == "kitti":
        return common + "\nKITTI labels are exported in KITTI camera coordinates.\n"
    if target == "pointmask":
        return common + "\nPointmask labels are little-endian uint32 class ids.\n"
    return common


async def _build_lidar_export_zip(
    svc: ExportService,
    project: Project,
    chunks: ExportChunkIter,
    *,
    tmp_path: str,
    batch_id: uuid.UUID | None,
    targets: list[str],
    include_attributes: bool,
) -> tuple[str, int, int]:
    for target in targets:
        if target not in LIDAR_EXPORT_TARGETS:
            raise UnsupportedExportError(f"unsupported lidar export target: {target}")

    classes_list = derive_classes_list(project.tool_bindings)
    cat_map = {name: i + 1 for i, name in enumerate(classes_list)}
    attribute_schema = derive_attribute_schema(project.tool_bindings)
    multi = len(targets) > 1
    file_count = 0
    frames: list[LidarFrameExportCtx] = []
    image_manifest: list[dict] = []
    pointcloud_manifest: list[dict] = []
    now = datetime.now(timezone.utc)
    expires_iso = datetime.fromtimestamp(
        now.timestamp() + PRESIGN_EXPIRES_SECONDS, tz=timezone.utc
    ).isoformat()

    with zipfile.ZipFile(tmp_path, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("classes.txt", "\n".join(classes_list))
        if include_attributes:
            zf.writestr(
                "attribute_schema.json",
                json.dumps(attribute_schema, ensure_ascii=False, indent=2),
            )

        async for tasks, ann_by_task, dataset_items in chunks:
            links_by_task = await _load_lidar_link_items(svc, tasks)
            for task in tasks:
                linked = links_by_task.get(task.id, {})
                fallback_item = (
                    dataset_items.get(task.dataset_item_id)
                    if task.dataset_item_id
                    else None
                )
                primary_pair = linked.get("primary_lidar")
                primary_item = primary_pair[1] if primary_pair else fallback_item
                frame_key = _lidar_frame_key(task, primary_item)
                cameras: dict[str, SensorCalibration] = {}
                for role, (link, item) in linked.items():
                    if not role.startswith("camera_"):
                        continue
                    cam = _camera_name(link)
                    calib = _calibration_for_item(item)
                    if calib is not None:
                        cameras[cam] = calib
                    image_manifest.append(
                        {
                            "camera": cam,
                            "frame": frame_key,
                            "rel_path": f"{cam}/{os.path.basename(item.file_path)}",
                            "dataset_id": str(item.dataset_id),
                            "presigned_url": storage_service.generate_download_url(
                                item.file_path,
                                expires_in=PRESIGN_EXPIRES_SECONDS,
                                bucket=storage_service.datasets_bucket,
                            ),
                            "expires_at": expires_iso,
                        }
                    )
                    for target in targets:
                        prefix = f"{target}/" if multi else ""
                        if target in {"kitti", "nuscenes", "pointmask"}:
                            zf.writestr(f"{prefix}images/{cam}/", "")
                            zf.writestr(
                                f"{prefix}calib_raw/{cam}/{frame_key}.json",
                                json.dumps(
                                    (item.metadata_ or {}).get("calibration") or {},
                                    ensure_ascii=False,
                                    indent=2,
                                ),
                            )
                if primary_item is not None:
                    pointcloud_manifest.append(
                        {
                            "frame": frame_key,
                            "rel_path": os.path.basename(primary_item.file_path),
                            "dataset_id": str(primary_item.dataset_id),
                            "presigned_url": storage_service.generate_download_url(
                                primary_item.file_path,
                                expires_in=PRESIGN_EXPIRES_SECONDS,
                                bucket=storage_service.datasets_bucket,
                            ),
                            "expires_at": expires_iso,
                        }
                    )
                anns = ann_by_task.get(task.id, [])
                frames.append(
                    LidarFrameExportCtx(
                        task_id=task.id,
                        frame_key=frame_key,
                        annotations=anns,
                        cameras=cameras,
                    )
                )
                for target in targets:
                    prefix = f"{target}/" if multi else ""
                    if target == "kitti":
                        first_calib = next(iter(cameras.values()), None)
                        lines = build_kitti_lidar_label_lines(
                            anns,
                            calib_by_cam=cameras,
                        )
                        zf.writestr(
                            f"{prefix}label_2/{frame_key}.txt", "\n".join(lines)
                        )
                        # 缺标定 → .unverified.txt, 让下游无法静默当真实标定消费。
                        calib_suffix = "txt" if first_calib else "unverified.txt"
                        zf.writestr(
                            f"{prefix}calib/{frame_key}.{calib_suffix}",
                            _kitti_calib_text(first_calib),
                        )
                        zf.writestr(f"{prefix}velodyne/", "")
                        file_count += 1
                    elif target == "pointmask":
                        source_point_count = None
                        if primary_item is not None:
                            source_point_count = (primary_item.metadata_ or {}).get(
                                "point_count"
                            )
                        zf.writestr(
                            f"{prefix}segmentation/{frame_key}.label",
                            build_pointmask_label_bytes(
                                anns,
                                source_point_count=source_point_count,
                                category_map=cat_map,
                            ),
                        )
                        zf.writestr(f"{prefix}velodyne/", "")
                        file_count += 1

        for target in targets:
            prefix = f"{target}/" if multi else ""
            if target == "aap_json":
                zf.writestr(
                    f"{prefix}annotations.json",
                    await svc.export_aap_json(project.id, batch_id=batch_id),
                )
                file_count += len(frames)
                continue
            zf.writestr(f"{prefix}README.txt", _lidar_readme(target))
            zf.writestr(
                f"{prefix}images_manifest.json",
                json.dumps(
                    {"images": image_manifest, "expires_at": expires_iso},
                    ensure_ascii=False,
                    indent=2,
                ),
            )
            zf.writestr(
                f"{prefix}pointclouds_manifest.json",
                json.dumps(
                    {"pointclouds": pointcloud_manifest, "expires_at": expires_iso},
                    ensure_ascii=False,
                    indent=2,
                ),
            )
            zf.writestr(f"{prefix}fetch_images.py", _FETCH_IMAGES_TEMPLATE)
            zf.writestr(f"{prefix}fetch_pointclouds.py", _FETCH_POINTCLOUDS_TEMPLATE)
            if target == "nuscenes":
                tables = build_nuscenes_frame_records(frames)
                for name, rows in tables.items():
                    zf.writestr(
                        f"{prefix}{name}.json",
                        json.dumps(rows, ensure_ascii=False, indent=2),
                    )
                file_count += len(frames)
            elif target == "pointmask":
                zf.writestr(
                    f"{prefix}category_map.json", category_map_json(classes_list)
                )

    return tmp_path, file_count, os.path.getsize(tmp_path)


# ── v0.10.31 · Phase 4 视频导出组装 ──────────────────────────────────

_FETCH_VIDEOS_TEMPLATE = '''#!/usr/bin/env python3
"""按 manifest.json 的预签名 URL 把视频回源到 videos/<相对路径>。

纯标准库，无需 MinIO 密钥（URL 已带 7 天签名）。本地已有视频则跳过。
"""
import json
import os
import sys
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))


def main() -> int:
    with open(os.path.join(HERE, "manifest.json"), "r", encoding="utf-8") as f:
        manifest = json.load(f)
    ok = 0
    fail = 0
    for it in manifest.get("videos", []):
        rel = it.get("rel_path")
        url = it.get("presigned_url")
        if not rel or not url:
            continue
        dest = os.path.join(HERE, "videos", *rel.split("/"))
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        if os.path.exists(dest):
            ok += 1
            continue
        try:
            urllib.request.urlretrieve(url, dest)
            ok += 1
        except Exception as exc:  # noqa: BLE001
            print("[x] 下载失败 %s: %s" % (rel, exc))
            fail += 1
    print("[done] 视频回源 成功 %d，失败 %d，输出目录 videos/" % (ok, fail))
    return 0 if fail == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
'''


_FETCH_FRAMES_TEMPLATE = '''#!/usr/bin/env python3
"""按 manifest.json 的采样网格帧号，用本地 ffmpeg 从回源视频抽帧序列。

遵循 D1（不物理打包帧）：导出包只带标注 + 网格帧号，帧由本脚本就地抽取。
依赖：先跑 fetch_videos.py 回源视频；系统需安装 ffmpeg。
帧号语义（D2）：grid_source_frames 是源视频帧号；输出按抽取顺序编号，
start_number=1（MOT/YOLO，1-based）或 0（KITTI-only，0-based）。
输出目录由 frame_output_dirs 指定；旧 manifest 缺失时回退 {sequence}/img1。
"""
import json
import os
import shutil
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))


def main() -> int:
    with open(os.path.join(HERE, "manifest.json"), "r", encoding="utf-8") as f:
        manifest = json.load(f)
    ok = 0
    fail = 0
    for it in manifest.get("videos", []):
        rel = it.get("rel_path")
        seq = it.get("sequence")
        frames = it.get("grid_source_frames") or []
        start = int(it.get("frame_start_number", 1))
        if not rel or not seq or not frames:
            continue
        video_path = os.path.join(HERE, "videos", *rel.split("/"))
        if not os.path.exists(video_path):
            print("[x] 视频缺失（先跑 fetch_videos.py）: %s" % rel)
            fail += 1
            continue
        raw_outputs = it.get("frame_output_dirs") or ["%s/img1" % seq]
        output_dirs = []
        for rel_out in raw_outputs:
            if not rel_out or rel_out in output_dirs:
                continue
            output_dirs.append(rel_out)
        if not output_dirs:
            continue
        out_dir = os.path.join(HERE, *output_dirs[0].split("/"))
        os.makedirs(out_dir, exist_ok=True)
        select_expr = "+".join("eq(n\\\\,%d)" % fr for fr in frames)
        cmd = [
            "ffmpeg", "-y", "-loglevel", "error", "-i", video_path,
            "-vf", "select='%s'" % select_expr, "-vsync", "0",
            "-start_number", str(start),
            os.path.join(out_dir, "%06d.jpg"),
        ]
        try:
            subprocess.run(cmd, check=True)
            for rel_out in output_dirs[1:]:
                extra_dir = os.path.join(HERE, *rel_out.split("/"))
                os.makedirs(extra_dir, exist_ok=True)
                for frame_no in range(start, start + len(frames)):
                    name = "%06d.jpg" % frame_no
                    src = os.path.join(out_dir, name)
                    if os.path.exists(src):
                        shutil.copy2(src, os.path.join(extra_dir, name))
            ok += 1
        except Exception as exc:  # noqa: BLE001
            print("[x] 抽帧失败 %s: %s" % (seq, exc))
            fail += 1
    print("[done] 抽帧 成功 %d 序列，失败 %d" % (ok, fail))
    return 0 if fail == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
'''


def _video_seq_name(task: Task, item: DatasetItem | None) -> str:
    """sequence 名 = 数据集内相对路径去扩展名（保留层级，去重靠相对路径）。"""
    return _label_rel(task, item)


def _video_meta(item: DatasetItem | None) -> dict:
    if not item:
        return {}
    v = (item.metadata_ or {}).get("video")
    return v if isinstance(v, dict) else {}


async def _build_video_export_zip(
    svc: ExportService,
    project,
    chunks: ExportChunkIter,
    *,
    tmp_path: str,
    batch_id: uuid.UUID | None,
    targets: list[str],
    include_attributes: bool,
    video_frame_mode: str,
) -> tuple[str, int, int]:
    """视频项目 zip（v0.10.43 多目标）：单目标落根、>1 目标各落 `{target}/`；
    manifest.json + fetch_videos.py 共享落根（MOT/KITTI 另带 fetch_frames.py）。

    v0.12.1 · B6 · 落盘 + 按 task 分块流式：逐序列文件（MOT/KITTI/yolo-frames）边遍历
    chunk 边写盘；video_json/aap_json 单文档由 svc 自加载。ZIP 写入调用方给的 tmp_path，
    临时文件清理由调用方负责，返回 (zip 路径, 文件数, size_bytes)。
    """
    for tg in targets:
        if tg not in VIDEO_EXPORT_FORMATS:
            raise UnsupportedExportError(f"unsupported video export format: {tg}")

    sampling = project.video_sampling or {}
    multi = len(targets) > 1
    has_mot = "mot" in targets
    has_kitti = "kitti" in targets
    has_yolo_frames = "yolo-frames-det" in targets
    has_frame_sequences = has_mot or has_kitti or has_yolo_frames
    frame_start_number = 1 if has_mot or has_yolo_frames else 0

    classes_list = derive_classes_list(project.tool_bindings)
    attribute_schema = derive_attribute_schema(project.tool_bindings)
    cat_map = {name: i for i, name in enumerate(classes_list)}

    manifest_videos: list[dict] = []
    now = datetime.now(timezone.utc)
    expires_iso = datetime.fromtimestamp(
        now.timestamp() + PRESIGN_EXPIRES_SECONDS, tz=timezone.utc
    ).isoformat()

    with zipfile.ZipFile(tmp_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for target in targets:
            prefix = f"{target}/" if multi else ""
            if target == "video_json":
                zf.writestr(
                    f"{prefix}annotations.json",
                    await svc.export_video_tracks(
                        project.id,
                        batch_id=batch_id,
                        include_attributes=include_attributes,
                        video_frame_mode=video_frame_mode,
                    ),
                )
            elif target == "aap_json":
                zf.writestr(
                    f"{prefix}annotations.json",
                    await svc.export_aap_json(project.id, batch_id=batch_id),
                )
            elif target == "yolo-frames-det":
                zf.writestr(f"{prefix}classes.txt", "\n".join(classes_list))
                if include_attributes:
                    zf.writestr(
                        f"{prefix}attribute_schema.json",
                        json.dumps(attribute_schema, ensure_ascii=False, indent=2),
                    )
                zf.writestr(
                    f"{prefix}data.yaml", _build_video_yolo_data_yaml(classes_list)
                )

        # 逐 task = sequence（按 chunk 流式）：写 MOT/KITTI/yolo-frames 逐序列文件 + 收集 manifest。
        file_count = 0
        total_tasks = 0
        async for tasks, ann_by_task, dataset_items in chunks:
            total_tasks += len(tasks)
            # 本块内按 task 分组 video_track / video_bbox。
            tracks_by_task: dict[uuid.UUID, list[Annotation]] = {}
            bboxes_by_task: dict[uuid.UUID, list[Annotation]] = {}
            for anns in ann_by_task.values():
                for ann in anns:
                    geometry_type = (ann.geometry or {}).get("type")
                    if geometry_type == "video_track_bbox":
                        tracks_by_task.setdefault(ann.task_id, []).append(ann)
                    elif geometry_type == "video_bbox":
                        bboxes_by_task.setdefault(ann.task_id, []).append(ann)
            for t in tasks:
                item = (
                    dataset_items.get(t.dataset_item_id) if t.dataset_item_id else None
                )
                seq = _video_seq_name(t, item)
                vmeta = _video_meta(item)
                source_fps = vmeta.get("fps")
                img_w = int(vmeta.get("width") or FALLBACK_W)
                img_h = int(vmeta.get("height") or FALLBACK_H)
                step = derive_step(source_fps, sampling)

                track_anns = tracks_by_task.get(t.id, [])
                bbox_anns = bboxes_by_task.get(t.id, [])
                # frame_count：元数据优先，缺失回退最大标注帧 + 1。
                max_kf = 0
                for ann in track_anns:
                    for kf in (ann.geometry or {}).get("keyframes") or []:
                        max_kf = max(max_kf, int(kf.get("frame_index", 0)))
                for ann in bbox_anns:
                    max_kf = max(
                        max_kf, int((ann.geometry or {}).get("frame_index", 0))
                    )
                frame_count = int(vmeta.get("frame_count") or (max_kf + 1))
                frame_count = max(frame_count, max_kf + 1)

                if has_mot or has_kitti:
                    numbers = derive_track_number(
                        [(ann.id, ann.geometry or {}) for ann in track_anns]
                    )
                    track_args = [
                        (numbers[ann.id], ann.class_name, ann.geometry or {})
                        for ann in track_anns
                    ]
                    if has_mot:
                        mp = "mot/" if multi else ""
                        zf.writestr(
                            f"{mp}{seq}/gt/gt.txt",
                            build_mot_gt(
                                track_args,
                                frame_count=frame_count,
                                step=step,
                                img_w=img_w,
                                img_h=img_h,
                            ),
                        )
                        zf.writestr(
                            f"{mp}{seq}/seqinfo.ini",
                            build_mot_seqinfo(
                                seq.split("/")[-1],
                                source_fps=source_fps,
                                step=step,
                                frame_count=frame_count,
                                img_w=img_w,
                                img_h=img_h,
                            ),
                        )
                    if has_kitti:
                        kp = "kitti/" if multi else ""
                        zf.writestr(
                            f"{kp}labels/{seq}.txt",
                            build_kitti_labels(
                                track_args,
                                frame_count=frame_count,
                                step=step,
                                img_w=img_w,
                                img_h=img_h,
                            ),
                        )

                if has_yolo_frames:
                    yp = "yolo-frames-det/" if multi else ""
                    labels = build_yolo_frame_det_labels(
                        [
                            (ann.class_name, ann.geometry or {}, ann.attributes or {})
                            for ann in track_anns
                        ],
                        [
                            (ann.class_name, ann.geometry or {}, ann.attributes or {})
                            for ann in bbox_anns
                        ],
                        cat_map,
                        frame_count=frame_count,
                        step=step,
                        frame_start_number=frame_start_number,
                        include_attributes=include_attributes,
                    )
                    for frame_no, (lines, attrs_per_line) in sorted(labels.items()):
                        base = f"{yp}labels/{seq}/{frame_no:06d}"
                        zf.writestr(f"{base}.txt", "\n".join(lines))
                        file_count += 1
                        if include_attributes and attrs_per_line:
                            zf.writestr(
                                f"{base}.attrs.json",
                                json.dumps(
                                    {"attributes": attrs_per_line}, ensure_ascii=False
                                ),
                            )

                # manifest 视频条目（含网格帧号供 fetch_frames.py 抽帧）。
                dataset_name = _dataset_name_for_task(t, item)
                video_rel = relative_path_from_file_path(t.file_path, dataset_name)
                presigned = storage_service.generate_download_url(
                    t.file_path,
                    expires_in=PRESIGN_EXPIRES_SECONDS,
                    bucket=storage_service.datasets_bucket,
                )
                frame_output_dirs: list[str] = []
                if has_mot or has_kitti:
                    frame_output_dirs.append(f"{seq}/img1")
                if has_yolo_frames:
                    yp = "yolo-frames-det/" if multi else ""
                    frame_output_dirs.append(f"{yp}images/{seq}")
                manifest_videos.append(
                    {
                        "sequence": seq,
                        "task_display_id": t.display_id,
                        "rel_path": video_rel,
                        "presigned_url": presigned,
                        "expires_at": expires_iso,
                        "video_metadata": vmeta,
                        "sampling": sampling,
                        "step": step,
                        "grid_source_frames": derive_sampled_frames(frame_count, step),
                        # 帧号 base：MOT/YOLO 取 1（1-based），KITTI-only 取 0。
                        "frame_start_number": frame_start_number,
                        "frame_output_dirs": frame_output_dirs,
                    }
                )

        zf.writestr(
            "manifest.json",
            json.dumps(
                {
                    "targets": targets,
                    "videos": manifest_videos,
                    "expires_at": expires_iso,
                },
                ensure_ascii=False,
                indent=2,
            ),
        )
        zf.writestr("fetch_videos.py", _FETCH_VIDEOS_TEMPLATE)
        if has_frame_sequences:
            zf.writestr("fetch_frames.py", _FETCH_FRAMES_TEMPLATE)

    return tmp_path, file_count or total_tasks, os.path.getsize(tmp_path)
