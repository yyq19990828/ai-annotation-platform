from __future__ import annotations

from dataclasses import dataclass
import hashlib
import mimetypes
import os
import uuid
from typing import BinaryIO, Literal

from sqlalchemy import select, func, delete, insert, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.dataset import Dataset, DatasetItem, ProjectDataset
from app.db.models.project import Project
from app.db.models.task import Task
from app.db.models.task_batch import TaskBatch
from app.services.display_id import next_display_id
from app.services.storage import storage_service

_STREAM_UPLOAD_CHUNK_BYTES = 8 * 1024 * 1024
_IMAGE_HEAD_BYTES = 256 * 1024


@dataclass(frozen=True)
class IngestOutcome:
    status: Literal["added", "skipped", "error"]
    relpath: str
    item_id: uuid.UUID | None = None
    file_type: str | None = None
    file_size: int | None = None
    content_hash: str | None = None
    linked_tasks: int = 0
    reason: str | None = None
    error: str | None = None


class DatasetService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def list(
        self,
        search: str | None = None,
        data_type: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> tuple[list[dict], int]:
        q = select(Dataset)
        count_q = select(func.count()).select_from(Dataset)

        if search:
            q = q.where(Dataset.name.ilike(f"%{search}%"))
            count_q = count_q.where(Dataset.name.ilike(f"%{search}%"))
        if data_type:
            q = q.where(Dataset.data_type == data_type)
            count_q = count_q.where(Dataset.data_type == data_type)

        total = (await self.db.execute(count_q)).scalar() or 0
        result = await self.db.execute(
            q.order_by(Dataset.created_at.desc()).limit(limit).offset(offset)
        )
        datasets = result.scalars().all()

        ds_ids = [ds.id for ds in datasets]

        # 批量聚合 project_count 与 total_size，避免 N+1
        if ds_ids:
            pc_rows = await self.db.execute(
                select(ProjectDataset.dataset_id, func.count())
                .where(ProjectDataset.dataset_id.in_(ds_ids))
                .group_by(ProjectDataset.dataset_id)
            )
            pc_map = {r[0]: r[1] for r in pc_rows.all()}

            sz_rows = await self.db.execute(
                select(
                    DatasetItem.dataset_id,
                    func.coalesce(func.sum(DatasetItem.file_size), 0),
                )
                .where(DatasetItem.dataset_id.in_(ds_ids))
                .group_by(DatasetItem.dataset_id)
            )
            sz_map = {r[0]: int(r[1]) for r in sz_rows.all()}
        else:
            pc_map: dict = {}
            sz_map: dict = {}

        items = []
        for ds in datasets:
            items.append(
                {
                    **_dataset_dict(ds),
                    "project_count": pc_map.get(ds.id, 0),
                    "total_size": sz_map.get(ds.id, 0),
                }
            )

        return items, total

    async def get(self, dataset_id: uuid.UUID) -> Dataset | None:
        return await self.db.get(Dataset, dataset_id)

    async def get_with_project_count(self, dataset_id: uuid.UUID) -> dict | None:
        ds = await self.db.get(Dataset, dataset_id)
        if not ds:
            return None
        pc = (
            await self.db.execute(
                select(func.count())
                .select_from(ProjectDataset)
                .where(ProjectDataset.dataset_id == ds.id)
            )
        ).scalar() or 0
        total_size = (
            await self.db.execute(
                select(func.coalesce(func.sum(DatasetItem.file_size), 0)).where(
                    DatasetItem.dataset_id == ds.id
                )
            )
        ).scalar() or 0
        return {**_dataset_dict(ds), "project_count": pc, "total_size": int(total_size)}

    async def create(
        self, name: str, description: str, data_type: str, user_id: uuid.UUID
    ) -> Dataset:
        ds_id = uuid.uuid4()
        display_id = await next_display_id(self.db, "datasets")
        ds = Dataset(
            id=ds_id,
            display_id=display_id,
            name=name,
            description=description,
            data_type=data_type,
            created_by=user_id,
        )
        self.db.add(ds)
        await self.db.flush()
        storage_service.ensure_bucket(storage_service.datasets_bucket)
        storage_service.create_folder(name, bucket=storage_service.datasets_bucket)
        return ds

    async def update(
        self, dataset_id: uuid.UUID, name: str | None, description: str | None
    ) -> Dataset | None:
        ds = await self.db.get(Dataset, dataset_id)
        if not ds:
            return None
        if name is not None:
            ds.name = name
        if description is not None:
            ds.description = description
        await self.db.flush()
        return ds

    async def delete(self, dataset_id: uuid.UUID) -> bool:
        ds = await self.db.get(Dataset, dataset_id)
        if not ds:
            return False
        await self.db.delete(ds)
        await self.db.flush()
        return True

    # ── Items ───────────────────────────────────────────────────────────────

    async def list_items(
        self,
        dataset_id: uuid.UUID,
        limit: int = 50,
        offset: int = 0,
    ) -> tuple[list[dict], int]:
        count_q = (
            select(func.count())
            .select_from(DatasetItem)
            .where(DatasetItem.dataset_id == dataset_id)
        )
        total = (await self.db.execute(count_q)).scalar() or 0

        q = (
            select(DatasetItem)
            .where(DatasetItem.dataset_id == dataset_id)
            .order_by(DatasetItem.created_at.desc())
            .limit(limit)
            .offset(offset)
        )
        result = await self.db.execute(q)
        items = result.scalars().all()

        out = []
        for item in items:
            d = _item_dict(item)
            try:
                d["file_url"] = storage_service.generate_download_url(
                    item.file_path,
                    bucket=storage_service.datasets_bucket,
                )
            except Exception:
                d["file_url"] = None
            if item.thumbnail_path:
                try:
                    d["thumbnail_url"] = storage_service.generate_download_url(
                        item.thumbnail_path,
                        bucket=storage_service.datasets_bucket,
                    )
                except Exception:
                    d["thumbnail_url"] = None
            out.append(d)
        return out, total

    async def find_by_hash(
        self, dataset_id: uuid.UUID, content_hash: str
    ) -> DatasetItem | None:
        result = await self.db.execute(
            select(DatasetItem).where(
                DatasetItem.dataset_id == dataset_id,
                DatasetItem.content_hash == content_hash,
            )
        )
        return result.scalar_one_or_none()

    async def add_item(
        self,
        dataset_id: uuid.UUID,
        file_name: str,
        file_path: str,
        file_type: str,
        file_size: int | None = None,
        content_hash: str | None = None,
        width: int | None = None,
        height: int | None = None,
    ) -> DatasetItem:
        item = DatasetItem(
            dataset_id=dataset_id,
            file_name=file_name,
            file_path=file_path,
            file_type=file_type,
            file_size=file_size,
            content_hash=content_hash,
            width=width,
            height=height,
        )
        self.db.add(item)

        ds = await self.db.get(Dataset, dataset_id)
        if ds:
            ds.file_count = (ds.file_count or 0) + 1

        await self.db.flush()
        return item

    async def delete_item(self, item_id: uuid.UUID) -> bool:
        item = await self.db.get(DatasetItem, item_id)
        if not item:
            return False
        ds = await self.db.get(Dataset, item.dataset_id)
        if ds:
            ds.file_count = max((ds.file_count or 0) - 1, 0)
        await self.db.delete(item)
        await self.db.flush()
        return True

    async def ingest_one(
        self,
        dataset_id: uuid.UUID,
        relpath: str,
        stream: BinaryIO | None = None,
        *,
        size: int | None = None,
        storage_key: str | None = None,
        content_hash_hint: str | None = None,
    ) -> IngestOutcome:
        """Ingest one source object into a dataset.

        `storage_key` is for objects already present in the datasets bucket (scan);
        otherwise `stream` is copied into that bucket in chunks while hashing.
        """
        ds = await self.db.get(Dataset, dataset_id)
        if not ds:
            return IngestOutcome(
                status="error", relpath=relpath, error="dataset missing"
            )

        source_name = _safe_basename(relpath)
        final_name = await self._unique_file_name(dataset_id, source_name)
        ext = final_name.rsplit(".", 1)[-1].lower() if "." in final_name else ""
        file_type = _infer_file_type_from_ext(ext)
        uploaded_storage = False

        if storage_key:
            duplicate_path = await self._find_by_file_path(dataset_id, storage_key)
            if duplicate_path is not None:
                return IngestOutcome(
                    status="skipped",
                    relpath=relpath,
                    reason="file_path_exists",
                    item_id=duplicate_path.id,
                )
            content_hash = content_hash_hint if _is_md5(content_hash_hint) else None
            file_size = size
            head_bytes = b""
        else:
            if stream is None:
                return IngestOutcome(
                    status="error", relpath=relpath, error="stream missing"
                )
            storage_key = f"{ds.name}/{final_name}"
            content_type = (
                mimetypes.guess_type(final_name)[0] or "application/octet-stream"
            )
            content_hash, file_size, head_bytes = self._upload_stream_to_dataset_bucket(
                storage_key,
                stream,
                content_type=content_type,
            )
            uploaded_storage = True

        if content_hash:
            existing = await self.find_by_hash(dataset_id, content_hash)
            if existing is not None:
                if uploaded_storage:
                    try:
                        storage_service.delete_object(
                            storage_key, bucket=storage_service.datasets_bucket
                        )
                    except Exception:
                        pass
                return IngestOutcome(
                    status="skipped",
                    relpath=relpath,
                    item_id=existing.id,
                    file_type=existing.file_type,
                    file_size=file_size,
                    content_hash=content_hash,
                    reason="content_hash_exists",
                )

        width: int | None = None
        height: int | None = None
        if file_type == "image":
            dims = (
                storage_service.read_image_dimensions_from_bytes(head_bytes)
                if head_bytes
                else None
            )
            if dims is None:
                dims = storage_service.read_image_dimensions(
                    storage_key,
                    bucket=storage_service.datasets_bucket,
                )
            if dims:
                width, height = dims

        item = await self.add_item(
            dataset_id=dataset_id,
            file_name=final_name,
            file_path=storage_key,
            file_type=file_type,
            file_size=file_size,
            content_hash=content_hash,
            width=width,
            height=height,
        )
        linked_tasks = await self.create_tasks_for_items(dataset_id, [item.id])
        return IngestOutcome(
            status="added",
            relpath=relpath,
            item_id=item.id,
            file_type=file_type,
            file_size=file_size,
            content_hash=content_hash,
            linked_tasks=linked_tasks,
        )

    async def enqueue_media_for_items(self, item_ids: list[uuid.UUID]) -> None:
        unique_item_ids = list(dict.fromkeys(item_ids))
        if not unique_item_ids:
            return
        rows = await self.db.execute(
            select(DatasetItem.id, DatasetItem.file_type).where(
                DatasetItem.id.in_(unique_item_ids)
            )
        )
        for item_id, file_type in rows.all():
            if file_type == "image":
                from app.workers.media import generate_thumbnail

                generate_thumbnail.delay(str(item_id))
            elif file_type == "video":
                from app.workers.media import generate_video_metadata

                generate_video_metadata.delay(str(item_id))

    async def _find_by_file_path(
        self, dataset_id: uuid.UUID, file_path: str
    ) -> DatasetItem | None:
        result = await self.db.execute(
            select(DatasetItem).where(
                DatasetItem.dataset_id == dataset_id,
                DatasetItem.file_path == file_path,
            )
        )
        return result.scalar_one_or_none()

    async def _unique_file_name(self, dataset_id: uuid.UUID, file_name: str) -> str:
        existing_rows = await self.db.execute(
            select(DatasetItem.file_name).where(DatasetItem.dataset_id == dataset_id)
        )
        existing = {row[0] for row in existing_rows.all() if row[0]}
        if file_name not in existing:
            return file_name
        stem, ext = os.path.splitext(file_name)
        i = 1
        while f"{stem}-{i}{ext}" in existing:
            i += 1
        return f"{stem}-{i}{ext}"

    def _upload_stream_to_dataset_bucket(
        self,
        storage_key: str,
        stream: BinaryIO,
        *,
        content_type: str,
    ) -> tuple[str, int, bytes]:
        client = storage_service.client
        bucket = storage_service.datasets_bucket
        md5 = hashlib.md5()
        head = bytearray()
        total = 0
        part_number = 1
        parts: list[dict] = []
        upload_id: str | None = None

        resp = client.create_multipart_upload(
            Bucket=bucket,
            Key=storage_key,
            ContentType=content_type,
        )
        upload_id = resp["UploadId"]
        try:
            while True:
                chunk = stream.read(_STREAM_UPLOAD_CHUNK_BYTES)
                if not chunk:
                    break
                if isinstance(chunk, str):
                    chunk = chunk.encode()
                elif not isinstance(chunk, bytes):
                    chunk = bytes(chunk)
                total += len(chunk)
                md5.update(chunk)
                if len(head) < _IMAGE_HEAD_BYTES:
                    remaining = _IMAGE_HEAD_BYTES - len(head)
                    head.extend(chunk[:remaining])
                part = client.upload_part(
                    Bucket=bucket,
                    Key=storage_key,
                    PartNumber=part_number,
                    UploadId=upload_id,
                    Body=chunk,
                )
                parts.append({"ETag": part["ETag"], "PartNumber": part_number})
                part_number += 1

            if parts:
                client.complete_multipart_upload(
                    Bucket=bucket,
                    Key=storage_key,
                    UploadId=upload_id,
                    MultipartUpload={"Parts": parts},
                )
            else:
                client.abort_multipart_upload(
                    Bucket=bucket,
                    Key=storage_key,
                    UploadId=upload_id,
                )
                upload_id = None
                client.put_object(
                    Bucket=bucket,
                    Key=storage_key,
                    Body=b"",
                    ContentType=content_type,
                )
        except Exception:
            if upload_id is not None:
                try:
                    client.abort_multipart_upload(
                        Bucket=bucket,
                        Key=storage_key,
                        UploadId=upload_id,
                    )
                except Exception:
                    pass
            raise

        return md5.hexdigest(), total, bytes(head)

    # ── Scan & import from bucket ─────────────────────────────────────────

    async def scan_and_import(self, dataset_id: uuid.UUID) -> list[IngestOutcome]:
        ds = await self.db.get(Dataset, dataset_id)
        if not ds:
            return []

        prefix = f"{ds.name}/"
        objects = storage_service.list_objects(
            prefix, bucket=storage_service.datasets_bucket
        )
        outcomes: list[IngestOutcome] = []
        for obj in objects:
            key: str = obj["key"]
            if key.endswith("/"):
                continue
            etag = obj.get("etag") or ""
            outcomes.append(
                await self.ingest_one(
                    dataset_id,
                    key.rsplit("/", 1)[-1],
                    size=obj.get("size"),
                    storage_key=key,
                    content_hash_hint=etag if _is_md5(etag) else None,
                )
            )
        return outcomes

    # ── Project linking ─────────────────────────────────────────────────────

    async def link_project(
        self, dataset_id: uuid.UUID, project_id: uuid.UUID
    ) -> ProjectDataset:
        existing = (
            await self.db.execute(
                select(ProjectDataset).where(
                    ProjectDataset.dataset_id == dataset_id,
                    ProjectDataset.project_id == project_id,
                )
            )
        ).scalar_one_or_none()
        if existing:
            return existing

        link = ProjectDataset(dataset_id=dataset_id, project_id=project_id)
        self.db.add(link)

        items_result = await self.db.execute(
            select(
                DatasetItem.id,
                DatasetItem.file_name,
                DatasetItem.file_path,
                DatasetItem.file_type,
            ).where(DatasetItem.dataset_id == dataset_id)
        )
        items = items_result.all()

        project = await self.db.get(Project, project_id)
        created_count = len(items)

        # v0.7.3：不再为新接入的 dataset 自建「默认包」batch。task 直接 batch_id=NULL，
        # 走「未归类任务」语义；BatchesSection 顶部横带提示，用户主动 split 才入 batch。
        # 历史已存在的默认包不动（向后兼容）。
        if items:
            # v0.6.6: 一次性预分配 N 个 display_id 序列号 + 单次 INSERT，
            # 替代 v0.6.5 之前逐条 db.add + 逐条 nextval 的循环（1000 条 ~2s → < 200ms）。
            seq_result = await self.db.execute(
                text("SELECT nextval('display_seq_tasks') FROM generate_series(1, :n)"),
                {"n": created_count},
            )
            display_nums = [row[0] for row in seq_result.all()]

            rows = [
                {
                    "id": uuid.uuid4(),
                    "project_id": project_id,
                    "dataset_item_id": item.id,
                    "batch_id": None,
                    "display_id": f"T-{display_nums[i]}",
                    "file_name": item.file_name,
                    "file_path": item.file_path,
                    "file_type": item.file_type,
                    "status": "pending",
                }
                for i, item in enumerate(items)
            ]
            await self.db.execute(insert(Task), rows)

        if project:
            project.total_tasks = (project.total_tasks or 0) + created_count

        await self.db.flush()
        return link

    async def create_tasks_for_items(
        self, dataset_id: uuid.UUID, item_ids: list[uuid.UUID]
    ) -> int:
        """Create tasks for newly added dataset items in already linked projects.

        `link_project` handles the initial backfill. This method covers the append path:
        upload / zip / scan can add new DatasetItem rows after a dataset is already linked.
        """
        unique_item_ids = list(dict.fromkeys(item_ids))
        if not unique_item_ids:
            return 0

        project_rows = await self.db.execute(
            select(ProjectDataset.project_id).where(
                ProjectDataset.dataset_id == dataset_id
            )
        )
        project_ids = [row[0] for row in project_rows.all()]
        if not project_ids:
            return 0

        items_result = await self.db.execute(
            select(
                DatasetItem.id,
                DatasetItem.file_name,
                DatasetItem.file_path,
                DatasetItem.file_type,
            ).where(
                DatasetItem.dataset_id == dataset_id,
                DatasetItem.id.in_(unique_item_ids),
            )
        )
        items = items_result.all()
        if not items:
            return 0

        existing_rows = await self.db.execute(
            select(Task.project_id, Task.dataset_item_id).where(
                Task.project_id.in_(project_ids),
                Task.dataset_item_id.in_([item.id for item in items]),
            )
        )
        existing_pairs = {(row[0], row[1]) for row in existing_rows.all()}

        pending = []
        for project_id in project_ids:
            for item in items:
                if (project_id, item.id) in existing_pairs:
                    continue
                pending.append((project_id, item))

        if not pending:
            return 0

        seq_result = await self.db.execute(
            text("SELECT nextval('display_seq_tasks') FROM generate_series(1, :n)"),
            {"n": len(pending)},
        )
        display_nums = [row[0] for row in seq_result.all()]

        rows = [
            {
                "id": uuid.uuid4(),
                "project_id": project_id,
                "dataset_item_id": item.id,
                "batch_id": None,
                "display_id": f"T-{display_nums[i]}",
                "file_name": item.file_name,
                "file_path": item.file_path,
                "file_type": item.file_type,
                "status": "pending",
            }
            for i, (project_id, item) in enumerate(pending)
        ]
        await self.db.execute(insert(Task), rows)

        created_by_project: dict[uuid.UUID, int] = {}
        for project_id, _item in pending:
            created_by_project[project_id] = created_by_project.get(project_id, 0) + 1

        projects = (
            (await self.db.execute(select(Project).where(Project.id.in_(project_ids))))
            .scalars()
            .all()
        )
        for project in projects:
            project.total_tasks = (project.total_tasks or 0) + created_by_project.get(
                project.id, 0
            )

        await self.db.flush()
        return len(rows)

    async def unlink_project(
        self, dataset_id: uuid.UUID, project_id: uuid.UUID
    ) -> dict | None:
        """v0.6.7 二修 B-10：hard-unlink ——级联删除该 dataset 在该 project 下的所有 task
        (含 annotations / comments / locks)，不再保留为孤儿。

        理由：用户期望「取消关联 = 撤销 link 的全部副作用」，soft-unlink 留下进度永远停在历史值。
        相关数据丢失（annotations / 子项）通过前端二次确认 + 数字提示让用户知情。

        v0.7.3 fix：原实现只重算 batch 计数器，导致 link 自建的「默认包」/ 用户从该 dataset
        task 切出去的 batch 在 task 全删后变成空壳挂在列表里。现在：删 task 前记下「即将失去 task 的
        batch 集合」，重算后把 total_tasks==0 且非 B-DEFAULT 的批次也删掉。

        返回：None 表示 link 不存在；否则
            {"deleted_tasks": N, "deleted_annotations": M, "deleted_batches": K,
             "deleted_batch_ids": [...], "soft": false}
        """
        from app.db.models.annotation import Annotation
        from app.db.models.annotation_comment import AnnotationComment
        from app.db.models.task_lock import TaskLock

        # 1. 找出本次要删的 task ids 与所属 batch ids
        target_rows = (
            await self.db.execute(
                select(Task.id, Task.batch_id)
                .join(DatasetItem, DatasetItem.id == Task.dataset_item_id)
                .where(
                    Task.project_id == project_id,
                    DatasetItem.dataset_id == dataset_id,
                )
            )
        ).all()
        target_task_ids: list[uuid.UUID] = [r[0] for r in target_rows]
        affected_batch_ids: set[uuid.UUID] = {
            r[1] for r in target_rows if r[1] is not None
        }

        # 2. 找出对应 annotation ids（用于 annotation_comments 级联）
        ann_ids: list[uuid.UUID] = []
        ann_count = 0
        if target_task_ids:
            ann_ids = list(
                (
                    await self.db.execute(
                        select(Annotation.id).where(
                            Annotation.task_id.in_(target_task_ids)
                        )
                    )
                )
                .scalars()
                .all()
            )
            ann_count = len(ann_ids)

        # 3. 级联删除（顺序关键：先 child 后 parent）
        if ann_ids:
            await self.db.execute(
                delete(AnnotationComment).where(
                    AnnotationComment.annotation_id.in_(ann_ids)
                )
            )
        if target_task_ids:
            await self.db.execute(
                delete(Annotation).where(Annotation.task_id.in_(target_task_ids))
            )
            await self.db.execute(
                delete(TaskLock).where(TaskLock.task_id.in_(target_task_ids))
            )
            await self.db.execute(delete(Task).where(Task.id.in_(target_task_ids)))

        # 4. 删 ProjectDataset link
        result = await self.db.execute(
            delete(ProjectDataset).where(
                ProjectDataset.dataset_id == dataset_id,
                ProjectDataset.project_id == project_id,
            )
        )
        if result.rowcount == 0:
            return None

        # 5. 重算 project 计数器
        project = await self.db.get(Project, project_id)
        if project:
            row = (
                await self.db.execute(
                    select(
                        func.count().label("total"),
                        func.count()
                        .filter(Task.status == "completed")
                        .label("completed"),
                        func.count().filter(Task.status == "review").label("review"),
                    ).where(Task.project_id == project_id)
                )
            ).one()
            project.total_tasks = row.total
            project.completed_tasks = row.completed
            project.review_tasks = row.review

        # 6. 重算所有该 project 的 batch 计数器（被删 task 之前可能在某个 batch 里）
        batches = (
            (
                await self.db.execute(
                    select(TaskBatch).where(TaskBatch.project_id == project_id)
                )
            )
            .scalars()
            .all()
        )
        for b in batches:
            r = (
                await self.db.execute(
                    select(
                        func.count().label("total"),
                        func.count()
                        .filter(Task.status == "completed")
                        .label("completed"),
                        func.count().filter(Task.status == "review").label("review"),
                    ).where(Task.batch_id == b.id)
                )
            ).one()
            b.total_tasks = r.total
            b.completed_tasks = r.completed
            b.review_tasks = r.review

        # 7. 级联清理：失去 task 后变空壳的 batch 删除（B-DEFAULT 永远保留）
        deleted_batch_ids: list[uuid.UUID] = []
        if affected_batch_ids:
            for b in batches:
                if (
                    b.id in affected_batch_ids
                    and b.total_tasks == 0
                    and b.display_id != "B-DEFAULT"
                ):
                    await self.db.execute(delete(TaskBatch).where(TaskBatch.id == b.id))
                    deleted_batch_ids.append(b.id)

        await self.db.flush()
        return {
            "deleted_tasks": len(target_task_ids),
            "deleted_annotations": ann_count,
            "deleted_batches": len(deleted_batch_ids),
            "deleted_batch_ids": [str(bid) for bid in deleted_batch_ids],
            "soft": False,
        }

    async def get_linked_projects(self, dataset_id: uuid.UUID) -> list[Project]:
        result = await self.db.execute(
            select(Project)
            .join(ProjectDataset, ProjectDataset.project_id == Project.id)
            .where(ProjectDataset.dataset_id == dataset_id)
        )
        return list(result.scalars().all())


_IMAGE_EXTS = {"jpg", "jpeg", "png", "bmp", "webp", "tiff", "tif", "gif", "svg"}
_VIDEO_EXTS = {"mp4", "avi", "mov", "mkv", "wmv", "flv", "webm"}


def _safe_basename(relpath: str) -> str:
    normalized = (relpath or "").replace("\\", "/").rstrip("/")
    name = os.path.basename(normalized)
    return name or f"source-{uuid.uuid4().hex}"


def _is_md5(value: str | None) -> bool:
    return bool(value and len(value) == 32)


def _infer_file_type_from_ext(ext: str) -> str:
    if ext in _IMAGE_EXTS:
        return "image"
    if ext in _VIDEO_EXTS:
        return "video"
    return "other"


def _dataset_dict(ds: Dataset) -> dict:
    return {
        "id": ds.id,
        "display_id": ds.display_id,
        "name": ds.name,
        "description": ds.description,
        "data_type": ds.data_type,
        "file_count": ds.file_count,
        "total_size": 0,  # 调用方会覆盖
        "created_by": ds.created_by,
        "created_at": ds.created_at,
        "updated_at": ds.updated_at,
    }


def _item_dict(item: DatasetItem) -> dict:
    return {
        "id": item.id,
        "dataset_id": item.dataset_id,
        "file_name": item.file_name,
        "file_path": item.file_path,
        "file_type": item.file_type,
        "file_size": item.file_size,
        "content_hash": item.content_hash,
        "width": item.width,
        "height": item.height,
        "blurhash": item.blurhash,
        "metadata": item.metadata_,
        "created_at": item.created_at,
    }
