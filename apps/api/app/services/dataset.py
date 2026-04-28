from __future__ import annotations

import uuid
from sqlalchemy import select, func, delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.dataset import Dataset, DatasetItem, ProjectDataset
from app.db.models.project import Project
from app.db.models.task import Task
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

        items = []
        for ds in datasets:
            pc = (await self.db.execute(
                select(func.count()).select_from(ProjectDataset).where(ProjectDataset.dataset_id == ds.id)
            )).scalar() or 0
            items.append({**_dataset_dict(ds), "project_count": pc})

        return items, total

    async def get(self, dataset_id: uuid.UUID) -> Dataset | None:
        return await self.db.get(Dataset, dataset_id)

    async def get_with_project_count(self, dataset_id: uuid.UUID) -> dict | None:
        ds = await self.db.get(Dataset, dataset_id)
        if not ds:
            return None
        pc = (await self.db.execute(
            select(func.count()).select_from(ProjectDataset).where(ProjectDataset.dataset_id == ds.id)
        )).scalar() or 0
        return {**_dataset_dict(ds), "project_count": pc}

    async def create(self, name: str, description: str, data_type: str, user_id: uuid.UUID) -> Dataset:
        ds_id = uuid.uuid4()
        display_id = f"DS-{str(ds_id)[:6].upper()}"
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
        return ds

    async def update(self, dataset_id: uuid.UUID, name: str | None, description: str | None) -> Dataset | None:
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
        count_q = select(func.count()).select_from(DatasetItem).where(DatasetItem.dataset_id == dataset_id)
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
                d["file_url"] = storage_service.generate_download_url(item.file_path)
            except Exception:
                d["file_url"] = None
            out.append(d)
        return out, total

    async def add_item(
        self,
        dataset_id: uuid.UUID,
        file_name: str,
        file_path: str,
        file_type: str,
        file_size: int | None = None,
    ) -> DatasetItem:
        item = DatasetItem(
            dataset_id=dataset_id,
            file_name=file_name,
            file_path=file_path,
            file_type=file_type,
            file_size=file_size,
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

    # ── Project linking ─────────────────────────────────────────────────────

    async def link_project(self, dataset_id: uuid.UUID, project_id: uuid.UUID) -> ProjectDataset:
        existing = (await self.db.execute(
            select(ProjectDataset).where(
                ProjectDataset.dataset_id == dataset_id,
                ProjectDataset.project_id == project_id,
            )
        )).scalar_one_or_none()
        if existing:
            return existing

        link = ProjectDataset(dataset_id=dataset_id, project_id=project_id)
        self.db.add(link)

        items_result = await self.db.execute(
            select(DatasetItem).where(DatasetItem.dataset_id == dataset_id)
        )
        items = items_result.scalars().all()

        project = await self.db.get(Project, project_id)
        created_count = 0
        for item in items:
            task = Task(
                project_id=project_id,
                dataset_item_id=item.id,
                display_id=f"T-{str(uuid.uuid4())[:6].upper()}",
                file_name=item.file_name,
                file_path=item.file_path,
                file_type=item.file_type,
                status="pending",
            )
            self.db.add(task)
            created_count += 1

        if project:
            project.total_tasks = (project.total_tasks or 0) + created_count

        await self.db.flush()
        return link

    async def unlink_project(self, dataset_id: uuid.UUID, project_id: uuid.UUID) -> bool:
        result = await self.db.execute(
            delete(ProjectDataset).where(
                ProjectDataset.dataset_id == dataset_id,
                ProjectDataset.project_id == project_id,
            )
        )
        return result.rowcount > 0

    async def get_linked_projects(self, dataset_id: uuid.UUID) -> list[Project]:
        result = await self.db.execute(
            select(Project)
            .join(ProjectDataset, ProjectDataset.project_id == Project.id)
            .where(ProjectDataset.dataset_id == dataset_id)
        )
        return list(result.scalars().all())


def _dataset_dict(ds: Dataset) -> dict:
    return {
        "id": ds.id,
        "display_id": ds.display_id,
        "name": ds.name,
        "description": ds.description,
        "data_type": ds.data_type,
        "file_count": ds.file_count,
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
        "metadata": item.metadata_,
        "created_at": item.created_at,
    }
