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
from app.services.project import (
    derive_attribute_schema,
    derive_classes_list,
)
from app.services.storage import storage_service

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


async def build_export_zip(
    db: AsyncSession,
    project_id: uuid.UUID,
    *,
    batch_id: uuid.UUID | None,
    format: str,
    include_attributes: bool,
    video_frame_mode: str,
) -> tuple[bytes, int]:
    """生成镜像目录 ZIP，返回 (bytes, label 文件数)。

    format ∈ {coco, yolo, aap_json}。VOC 走旧同步路径，不在此处。
    """
    svc = ExportService(db)
    project, tasks, annotations = await svc._load_data(project_id, batch_id)
    if project is None:
        return b"", 0
    dataset_items = await svc._load_dataset_items(tasks)

    classes_list = derive_classes_list(project.tool_bindings)
    attribute_schema = derive_attribute_schema(project.tool_bindings)

    file_count = 0
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("classes.txt", "\n".join(classes_list))
        if include_attributes:
            zf.writestr(
                "attribute_schema.json",
                json.dumps(attribute_schema, ensure_ascii=False, indent=2),
            )

        if format == "yolo":
            cat_map = {name: i for i, name in enumerate(classes_list)}
            ann_by_task: dict[uuid.UUID, list[Annotation]] = {}
            for ann in annotations:
                ann_by_task.setdefault(ann.task_id, []).append(ann)
            for t in tasks:
                item = dataset_items.get(t.dataset_item_id) if t.dataset_item_id else None
                rel = _label_rel(t, item)
                lines, attrs_per_line = _yolo_lines(
                    ann_by_task.get(t.id, []), cat_map, include_attributes
                )
                dataset_id = str(item.dataset_id) if item else "unknown"
                base = f"{project_id}/{dataset_id}/labels/{rel}"
                zf.writestr(f"{base}.txt", "\n".join(lines))
                file_count += 1
                if include_attributes and attrs_per_line:
                    zf.writestr(
                        f"{base}.attrs.json",
                        json.dumps(
                            {"attributes": attrs_per_line}, ensure_ascii=False
                        ),
                    )
        elif format == "coco":
            # COCO 单文档；传入 dataset_items 让像素坐标用真值（修硬编码 bug）。
            content = await svc.export_coco(
                project_id,
                batch_id=batch_id,
                include_attributes=include_attributes,
                video_frame_mode=video_frame_mode,
                dataset_items=dataset_items,
            )
            zf.writestr("annotations.json", content)
            file_count = len(tasks)
        elif format == "aap_json":
            content = await svc.export_aap_json(project_id, batch_id=batch_id)
            zf.writestr("annotations.json", content)
            file_count = len(tasks)
        else:
            raise UnsupportedExportError(f"unsupported export format: {format}")

        # 附加产物：data.yaml / images_manifest.json / fetch_images.py
        manifest_images: list[dict] = []
        now = datetime.now(timezone.utc)
        expires_at = now.timestamp() + PRESIGN_EXPIRES_SECONDS
        expires_iso = datetime.fromtimestamp(expires_at, tz=timezone.utc).isoformat()
        for t in tasks:
            item = dataset_items.get(t.dataset_item_id) if t.dataset_item_id else None
            rel = _label_rel(t, item)
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
        zf.writestr(
            "data.yaml",
            _build_data_yaml(classes_list),
        )
        zf.writestr("fetch_images.py", _FETCH_IMAGES_TEMPLATE)

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
