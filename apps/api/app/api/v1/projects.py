from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from app.deps import get_db
from app.schemas.project import ProjectOut, ProjectCreate, ProjectStats

router = APIRouter()


@router.get("", response_model=list[dict])
async def list_projects(status: str | None = None, search: str | None = None):
    # TODO: query from DB, for now return mock structure
    return []


@router.get("/stats", response_model=ProjectStats)
async def get_stats():
    return ProjectStats(total_data=34200, completed=21707, ai_rate=62.4, pending_review=892)


@router.post("", response_model=dict)
async def create_project(data: ProjectCreate):
    # TODO: implement
    return {"id": "new-project", "name": data.name}


@router.get("/{project_id}", response_model=dict)
async def get_project(project_id: str):
    # TODO: implement
    return {"id": project_id}
