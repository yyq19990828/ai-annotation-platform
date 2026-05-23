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

import io
import json
import math
import uuid
import zipfile
from datetime import datetime, timezone
from posixpath import splitext

from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.annotation import Annotation
from app.db.models.dataset import DatasetItem
from app.db.models.task import Task
from app.services.export import (
    ExportService,
    UnsupportedExportError,
    _bbox_geometry,
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

# v0.10.43 · 多目标导出：图像目标（yolo 旧值=yolo-det）+ 视频目标 + voc（仅同步单目标）。
IMAGE_EXPORT_TARGETS = {"coco", "yolo", "yolo-det", "yolo-obb", "yolo-seg", "aap_json"}
ALL_EXPORT_TARGETS = IMAGE_EXPORT_TARGETS | VIDEO_EXPORT_FORMATS | {"voc"}


def clean_export_targets(targets: list[str]) -> list[str]:
    """去重保序 + 校验目标合法。非法或空抛 ValueError（端点转 400）。"""
    seen: list[str] = []
    for t in targets:
        if t not in ALL_EXPORT_TARGETS:
            raise ValueError(f"unsupported export target: {t}")
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


async def build_export_zip(
    db: AsyncSession,
    project_id: uuid.UUID,
    *,
    batch_id: uuid.UUID | None,
    targets: list[str],
    include_attributes: bool,
    video_frame_mode: str,
) -> tuple[bytes, int]:
    """生成镜像目录 ZIP，返回 (bytes, label 文件数)。

    v0.10.43 · 多目标（方案 B）：单目标落包根（向后兼容旧布局），>1 目标各落 `{target}/` 子目录。
    图像 targets ∈ {coco, yolo-det, yolo-obb, yolo-seg, aap_json}（`yolo` 兼容旧 = yolo-det）。
    VOC 走旧同步路径，不在此处。
    """
    svc = ExportService(db)
    project, tasks, annotations = await svc._load_data(project_id, batch_id)
    if project is None:
        return b"", 0
    dataset_items = await svc._load_dataset_items(tasks)

    # v0.10.31 · Phase 4.1 · 视频项目走独立组装（manifest + 视频回源脚本 + 多格式）。
    if project.data_type == "video":
        return await _build_video_export_zip(
            db,
            svc,
            project,
            tasks,
            annotations,
            dataset_items,
            batch_id=batch_id,
            targets=targets,
            include_attributes=include_attributes,
            video_frame_mode=video_frame_mode,
        )

    classes_list = derive_classes_list(project.tool_bindings)
    attribute_schema = derive_attribute_schema(project.tool_bindings)
    cat_map = {name: i for i, name in enumerate(classes_list)}
    ann_by_task: dict[uuid.UUID, list[Annotation]] = {}
    for ann in annotations:
        ann_by_task.setdefault(ann.task_id, []).append(ann)

    multi = len(targets) > 1
    file_count = 0
    has_yolo = False
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        # 共享产物（格式无关）：类别清单 + 属性 schema。
        zf.writestr("classes.txt", "\n".join(classes_list))
        if include_attributes:
            zf.writestr(
                "attribute_schema.json",
                json.dumps(attribute_schema, ensure_ascii=False, indent=2),
            )

        for target in targets:
            prefix = f"{target}/" if multi else ""
            if target in YOLO_TARGETS:
                has_yolo = True
                for t in tasks:
                    item = (
                        dataset_items.get(t.dataset_item_id)
                        if t.dataset_item_id
                        else None
                    )
                    rel = _label_rel(t, item)
                    img_w = int(item.width) if item and item.width else FALLBACK_W
                    img_h = int(item.height) if item and item.height else FALLBACK_H
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
                                {"attributes": attrs_per_line}, ensure_ascii=False
                            ),
                        )
                zf.writestr(f"{prefix}data.yaml", _build_data_yaml(classes_list))
            elif target == "coco":
                content = await svc.export_coco(
                    project_id,
                    batch_id=batch_id,
                    include_attributes=include_attributes,
                    video_frame_mode=video_frame_mode,
                    dataset_items=dataset_items,
                )
                zf.writestr(f"{prefix}annotations.json", content)
                file_count += len(tasks)
            elif target == "aap_json":
                content = await svc.export_aap_json(project_id, batch_id=batch_id)
                zf.writestr(f"{prefix}annotations.json", content)
                file_count += len(tasks)
            else:
                raise UnsupportedExportError(f"unsupported export target: {target}")

        # 共享图片回源：images_manifest.json + fetch_images.py（任一目标都可用）。
        now = datetime.now(timezone.utc)
        expires_iso = datetime.fromtimestamp(
            now.timestamp() + PRESIGN_EXPIRES_SECONDS, tz=timezone.utc
        ).isoformat()
        manifest_images: list[dict] = []
        for t in tasks:
            item = dataset_items.get(t.dataset_item_id) if t.dataset_item_id else None
            dataset_name = _dataset_name_for_task(t, item)
            img_rel = relative_path_from_file_path(t.file_path, dataset_name)
            presigned = storage_service.generate_download_url(
                t.file_path,
                expires_in=PRESIGN_EXPIRES_SECONDS,
                bucket=storage_service.datasets_bucket,
            )
            manifest_images.append(
                {
                    "rel_path": img_rel,
                    "dataset_id": str(item.dataset_id) if item else None,
                    "presigned_url": presigned,
                    "expires_at": expires_iso,
                }
            )

        zf.writestr(
            "images_manifest.json",
            json.dumps(
                {"images": manifest_images, "expires_at": expires_iso},
                ensure_ascii=False,
                indent=2,
            ),
        )
        zf.writestr("fetch_images.py", _FETCH_IMAGES_TEMPLATE)
        # 单 YOLO 目标时根 data.yaml 已在循环里写（prefix=""）；多目标时各子目录已带 data.yaml。
        if not multi and not has_yolo:
            # 纯 COCO/AAP 单目标也给一份 data.yaml（保持旧包结构兼容）。
            zf.writestr("data.yaml", _build_data_yaml(classes_list))

    return buf.getvalue(), file_count


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
    db: AsyncSession,
    svc: ExportService,
    project,
    tasks: list[Task],
    annotations: list[Annotation],
    dataset_items: dict[uuid.UUID, DatasetItem],
    *,
    batch_id: uuid.UUID | None,
    targets: list[str],
    include_attributes: bool,
    video_frame_mode: str,
) -> tuple[bytes, int]:
    """视频项目 zip（v0.10.43 多目标）：单目标落根、>1 目标各落 `{target}/`；
    manifest.json + fetch_videos.py 共享落根（MOT/KITTI 另带 fetch_frames.py）。"""
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

    # 按 task 分组 video_track / video_bbox，派生 track_number 与逐帧 YOLO labels。
    tracks_by_task: dict[uuid.UUID, list[Annotation]] = {}
    bboxes_by_task: dict[uuid.UUID, list[Annotation]] = {}
    for ann in annotations:
        geometry_type = (ann.geometry or {}).get("type")
        if geometry_type == "video_track":
            tracks_by_task.setdefault(ann.task_id, []).append(ann)
        elif geometry_type == "video_bbox":
            bboxes_by_task.setdefault(ann.task_id, []).append(ann)

    buf = io.BytesIO()
    manifest_videos: list[dict] = []
    now = datetime.now(timezone.utc)
    expires_iso = datetime.fromtimestamp(
        now.timestamp() + PRESIGN_EXPIRES_SECONDS, tz=timezone.utc
    ).isoformat()

    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
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

        # 逐 task = sequence：写 MOT/KITTI 逐序列文件 + 收集 manifest 条目。
        file_count = 0
        for t in tasks:
            item = dataset_items.get(t.dataset_item_id) if t.dataset_item_id else None
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
                max_kf = max(max_kf, int((ann.geometry or {}).get("frame_index", 0)))
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

    return buf.getvalue(), file_count or len(tasks)
