"""跨实例 task 匹配 (v0.10.15).

ROADMAP §6 决策底线: 跨实例匹配走 display_id + file_path + schema_version 三元组,
**不**用 task.id 数字 UUID. task 表当前 schema:
- display_id: String(30), UNIQUE (全局, 不仅项目级)
- (project_id, file_path): 无显式 unique 约束, 但实际由 dataset_item 扫描保证唯一

匹配规则 (oneof, display_id 优先):
1. 给 display_id: 全局查; 命中后校验 project_id 一致, 否则不匹配 (跨项目入侵).
2. 给 file_path: 项目内查; 先按相对目录路径精确匹配 (消除同名跨目录误匹配),
   匹配不到再退回历史的整串 file_path 等值匹配 (兼容).
3. 都没给: 不匹配.

相对目录匹配 (v0.10.27 导入对称):
- 库内 `task.file_path` 是完整 MinIO key, 带 dataset 名前缀 (如
  `{dataset}/animals/cat/001.jpg`); 外部文件 (COCO `image.file_name` 等) 通常是
  去前缀的相对路径 (如 `animals/cat/001.jpg`)。
- 故对带相对目录的入参, 按「`file_path` 整串等值 或 以 `/{rel}` 结尾」匹配 ——
  天然吸收 dataset 名前缀, 无需在匹配层知道前缀, 与导出镜像 (file_path 去前缀的
  相对路径) 对称。
- 仅当入参含子目录 (`/`) 时才走这层; 纯叶子名仍走历史等值匹配, 不改既有行为。

匹配失败的 entry 由调用方累计到 ImportResult.errors[], 不让整批失败 (lenient).
"""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.task import Task


async def resolve_task(
    db: AsyncSession,
    project_id: uuid.UUID,
    match: dict[str, Any] | None,
) -> Task | None:
    """按 display_id / file_path 解析 task; 跨项目命中 display_id 视为不匹配."""

    if not isinstance(match, dict):
        return None

    display_id = match.get("display_id")
    if isinstance(display_id, str) and display_id:
        task = await db.scalar(select(Task).where(Task.display_id == display_id))
        if task is not None:
            if task.project_id == project_id:
                return task
            # display_id 命中但跨项目: 不允许偷换项目, 显式不匹配, 让 file_path
            # 兜底而不是直接返 None (防御性 fallback).
        # 若 display_id 给了但 fallback 到 file_path, 继续走 file_path 分支.

    file_path = match.get("file_path")
    if isinstance(file_path, str) and file_path:
        rel = file_path.replace("\\", "/").lstrip("/")
        if "/" in rel:
            # 带子目录: 精确相对路径匹配 (整串等值 或 以 /{rel} 结尾, 吸收 dataset 前缀).
            # `%` / `_` 在 rel 里罕见且即便存在也只会放宽匹配, 不引入误匹配跨目录风险.
            task = await db.scalar(
                select(Task)
                .where(
                    Task.project_id == project_id,
                    or_(
                        Task.file_path == rel,
                        Task.file_path.like(f"%/{rel}"),
                    ),
                )
                .order_by(Task.file_path)
            )
            if task is not None:
                return task
            # 相对路径匹配不到, 退回历史整串等值匹配 (兼容).

        return await db.scalar(
            select(Task).where(
                Task.project_id == project_id, Task.file_path == file_path
            )
        )

    return None
