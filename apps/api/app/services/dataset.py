from __future__ import annotations

import uuid
from sqlalchemy import select, func, delete, insert, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.dataset import Dataset, DatasetItem, ProjectDataset
from app.db.models.project import Project
from app.db.models.task import Task
from app.db.models.task_batch import TaskBatch
from app.services.display_id import next_display_id
from app.services.storage import storage_service


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

    # ── Scan & import from bucket ─────────────────────────────────────────

    async def scan_and_import(self, dataset_id: uuid.UUID) -> list[uuid.UUID]:
        ds = await self.db.get(Dataset, dataset_id)
        if not ds:
            return 0

        existing = await self.db.execute(
            select(DatasetItem.file_path).where(DatasetItem.dataset_id == dataset_id)
        )
        existing_paths: set[str] = {row[0] for row in existing}

        prefix = f"{ds.name}/"
        objects = storage_service.list_objects(
            prefix, bucket=storage_service.datasets_bucket
        )

        # 同时收集已存在的 hash，防止 scan 时内容重复
        existing_hashes_res = await self.db.execute(
            select(DatasetItem.content_hash).where(
                DatasetItem.dataset_id == dataset_id,
                DatasetItem.content_hash.isnot(None),
            )
        )
        existing_hashes: set[str] = {r[0] for r in existing_hashes_res.all()}

        created = 0
        new_items: list[DatasetItem] = []
        for obj in objects:
            key: str = obj["key"]
            if key.endswith("/"):
                continue
            if key in existing_paths:
                continue

            # ETag from MinIO 单 PUT = md5（不含引号）
            etag = obj.get("etag") or ""
            content_hash = etag if len(etag) == 32 else None
            if content_hash and content_hash in existing_hashes:
                continue
            if content_hash:
                existing_hashes.add(content_hash)

            file_name = key.rsplit("/", 1)[-1]
            ext = file_name.rsplit(".", 1)[-1].lower() if "." in file_name else ""
            file_type = _infer_file_type_from_ext(ext)

            width: int | None = None
            height: int | None = None
            if file_type == "image":
                dims = storage_service.read_image_dimensions(
                    key, bucket=storage_service.datasets_bucket
                )
                if dims:
                    width, height = dims

            item = DatasetItem(
                dataset_id=dataset_id,
                file_name=file_name,
                file_path=key,
                file_type=file_type,
                file_size=obj.get("size"),
                content_hash=content_hash,
                width=width,
                height=height,
            )
            self.db.add(item)
            new_items.append(item)
            created += 1

        if created and ds:
            ds.file_count = (ds.file_count or 0) + created
        await self.db.flush()
        return [item.id for item in new_items]

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
