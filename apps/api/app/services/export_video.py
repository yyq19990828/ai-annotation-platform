"""v0.10.31 · Phase 4 视频导出纯函数底座（计划 §共享底座 / 4.3 / 4.4）。

把「采样网格映射 + MOT/KITTI 文本生成」收成无 DB 纯函数，DB 加载与 zip 组装留给
``export_packaging.build_export_zip`` 的视频分支。

决策对齐：
- D2：geometry.frame_index 永远是源视频帧号；导出 MOT/KITTI 时按采样网格 [0,step,2*step,...]
  重编号（``source_to_grid``）。改采样密度不破坏 geometry。
- 帧集：只取落在采样网格上的帧（``track_grid_rows`` 过滤 ``frame_index % step == 0``）。
- outside：``resolved_track_frames(all_frames)`` 已对 outside 帧返回 None，天然省略。

统一映射约定（计划§统一映射约定）：
- MOT：outside 帧省略；occluded 仍输出（conf=1）；frame 网格序号 **1-based**。
- KITTI：outside 帧省略；occluded 列 ∈{0,1}；frame 网格序号 **0-based**；3D 字段占位 -1。
"""

from __future__ import annotations

from app.services.video_frame_service import derive_sampled_frames
from app.services.video_tracks import resolved_track_frames

# DatasetItem.width/height 缺失时的回退（与 export.py IMG_W/IMG_H 一致）。
FALLBACK_W, FALLBACK_H = 1920, 1280


def effective_fps(source_fps: float | None, step: int) -> float | None:
    """采样后 fps = 源 fps / step（写进 MOT seqinfo.frameRate）。源 fps 缺失则 None。"""
    if not source_fps or source_fps <= 0:
        return None
    return round(float(source_fps) / max(1, int(step)), 3)


def source_to_grid(frame_count: int, step: int) -> dict[int, int]:
    """源帧号 → 网格序号(0-based) 映射。网格 = [0, step, 2*step, ...] < frame_count。"""
    return {
        frame: index
        for index, frame in enumerate(derive_sampled_frames(frame_count, step))
    }


def _bbox_px(bbox: dict, img_w: int, img_h: int) -> tuple[float, float, float, float]:
    """归一化 bbox(0..1) → 像素 (left, top, w, h)，保留 2 位小数。"""
    return (
        round(float(bbox.get("x", 0)) * img_w, 2),
        round(float(bbox.get("y", 0)) * img_h, 2),
        round(float(bbox.get("w", 0)) * img_w, 2),
        round(float(bbox.get("h", 0)) * img_h, 2),
    )


def track_grid_rows(
    geometry: dict,
    *,
    frame_count: int,
    step: int,
    img_w: int,
    img_h: int,
) -> list[dict]:
    """单 track 在采样网格上的逐帧行。

    返回 ``[{grid_index, left, top, w, h, occluded, source}]``（grid_index 0-based）。
    走 ``resolved_track_frames(all_frames)`` 展开插值 + 跳 outside，再筛网格帧重编号。
    """
    step = max(1, int(step))
    frames = resolved_track_frames(
        geometry, frame_mode="all_frames", frame_count=frame_count
    )
    rows: list[dict] = []
    for frame in frames:
        fi = int(frame.get("frame_index", 0))
        if fi % step != 0:
            continue
        left, top, w, h = _bbox_px(frame.get("bbox") or {}, img_w, img_h)
        rows.append(
            {
                "grid_index": fi // step,
                "left": left,
                "top": top,
                "w": w,
                "h": h,
                "occluded": bool(frame.get("occluded", False)),
                "source": frame.get("source", "manual"),
            }
        )
    return rows


# ── YOLO frame detection dataset ──────────────────────────────────────


def _yolo_det_line(class_id: int, bbox: dict) -> str:
    cx = float(bbox.get("x", 0)) + float(bbox.get("w", 0)) / 2
    cy = float(bbox.get("y", 0)) + float(bbox.get("h", 0)) / 2
    bw = float(bbox.get("w", 0))
    bh = float(bbox.get("h", 0))
    return f"{class_id} {cx:.6f} {cy:.6f} {bw:.6f} {bh:.6f}"


def build_yolo_frame_det_labels(
    tracks: list[tuple[str | None, dict, dict]],
    bboxes: list[tuple[str | None, dict, dict]],
    cat_map: dict[str, int],
    *,
    frame_count: int,
    step: int,
    frame_start_number: int,
    include_attributes: bool,
) -> dict[int, tuple[list[str], list[dict]]]:
    """YOLO det labels for sampled video frames.

    Keys are output frame numbers, matching ``fetch_frames.py`` filenames. Values are
    ``(label_lines, attrs_per_line)``. All sampled frames are present, including
    empty labels, so YOLO has a txt file for every extracted image.
    """
    grid = source_to_grid(frame_count, step)
    labels: dict[int, tuple[list[str], list[dict]]] = {
        grid_index + frame_start_number: ([], [])
        for grid_index in grid.values()
    }

    for class_name, geometry, attributes in bboxes:
        source_frame = int(geometry.get("frame_index", 0))
        grid_index = grid.get(source_frame)
        if grid_index is None:
            continue
        out_frame = grid_index + frame_start_number
        lines, attrs = labels[out_frame]
        lines.append(_yolo_det_line(cat_map.get(class_name or "", 0), geometry))
        if include_attributes:
            attrs.append(attributes or {})

    for class_name, geometry, attributes in tracks:
        class_id = cat_map.get(class_name or "", 0)
        for frame in resolved_track_frames(
            geometry, frame_mode="all_frames", frame_count=frame_count
        ):
            grid_index = grid.get(int(frame.get("frame_index", 0)))
            if grid_index is None:
                continue
            out_frame = grid_index + frame_start_number
            lines, attrs = labels[out_frame]
            lines.append(_yolo_det_line(class_id, frame.get("bbox") or {}))
            if include_attributes:
                attrs.append(attributes or {})

    return labels


# ── MOT 16/17/20 ─────────────────────────────────────────────────────


def build_mot_gt(
    tracks: list[tuple[int, str | None, dict]],
    *,
    frame_count: int,
    step: int,
    img_w: int,
    img_h: int,
) -> str:
    """gt.txt：``frame,id,bb_left,bb_top,bb_w,bb_h,conf,x,y,z``（conf=1，x/y/z=-1）。

    ``tracks`` = ``[(track_number, class_name, geometry)]``。frame=网格序号 1-based。
    按 (frame, id) 排序，便于 trackeval 读取。
    """
    lines: list[tuple[int, int, str]] = []
    for track_number, _class_name, geometry in tracks:
        for row in track_grid_rows(
            geometry, frame_count=frame_count, step=step, img_w=img_w, img_h=img_h
        ):
            frame = row["grid_index"] + 1  # MOT 1-based
            lines.append(
                (
                    frame,
                    track_number,
                    f"{frame},{track_number},{row['left']},{row['top']},"
                    f"{row['w']},{row['h']},1,-1,-1,-1",
                )
            )
    lines.sort(key=lambda item: (item[0], item[1]))
    return "\n".join(line for _f, _i, line in lines)


def build_mot_seqinfo(
    name: str,
    *,
    source_fps: float | None,
    step: int,
    frame_count: int,
    img_w: int,
    img_h: int,
) -> str:
    """seqinfo.ini。frameRate=采样后 fps；seqLength=网格帧数。"""
    grid_len = len(derive_sampled_frames(frame_count, step))
    fps = effective_fps(source_fps, step)
    frame_rate = int(round(fps)) if fps else 0
    return (
        "[Sequence]\n"
        f"name={name}\n"
        "imDir=img1\n"
        f"frameRate={frame_rate}\n"
        f"seqLength={grid_len}\n"
        f"imWidth={img_w}\n"
        f"imHeight={img_h}\n"
        "imExt=.jpg\n"
    )


# ── KITTI Tracking 2D ─────────────────────────────────────────────────


def build_kitti_labels(
    tracks: list[tuple[int, str | None, dict]],
    *,
    frame_count: int,
    step: int,
    img_w: int,
    img_h: int,
) -> str:
    """KITTI tracking label：每行 18 列。

    ``frame track_id type truncated occluded alpha x1 y1 x2 y2 h w l x y z rotation_y``
    2D 版：truncated=0，occluded∈{0,1}，alpha/3D 字段占位 -1；frame=网格序号 0-based。
    按 (frame, track_id) 排序。
    """
    lines: list[tuple[int, int, str]] = []
    for track_number, class_name, geometry in tracks:
        kitti_type = class_name or "DontCare"
        for row in track_grid_rows(
            geometry, frame_count=frame_count, step=step, img_w=img_w, img_h=img_h
        ):
            frame = row["grid_index"]  # KITTI 0-based
            x1 = row["left"]
            y1 = row["top"]
            x2 = round(x1 + row["w"], 2)
            y2 = round(y1 + row["h"], 2)
            occluded = 1 if row["occluded"] else 0
            lines.append(
                (
                    frame,
                    track_number,
                    f"{frame} {track_number} {kitti_type} 0 {occluded} -1 "
                    f"{x1} {y1} {x2} {y2} -1 -1 -1 -1 -1 -1 -1",
                )
            )
    lines.sort(key=lambda item: (item[0], item[1]))
    return "\n".join(line for _f, _i, line in lines)
