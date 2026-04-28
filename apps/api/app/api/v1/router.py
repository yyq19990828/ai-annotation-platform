from fastapi import APIRouter
from app.api.v1 import auth, projects, tasks, users, ml_backends, files, datasets, storage, dashboard

api_router = APIRouter()
api_router.include_router(auth.router, prefix="/auth", tags=["auth"])
api_router.include_router(projects.router, prefix="/projects", tags=["projects"])
api_router.include_router(tasks.router, prefix="/tasks", tags=["tasks"])
api_router.include_router(users.router, prefix="/users", tags=["users"])
api_router.include_router(dashboard.router, prefix="/dashboard", tags=["dashboard"])
api_router.include_router(ml_backends.router, prefix="/projects/{project_id}/ml-backends", tags=["ml-backends"])
api_router.include_router(files.router, prefix="/files", tags=["files"])
api_router.include_router(datasets.router, prefix="/datasets", tags=["datasets"])
api_router.include_router(storage.router, prefix="/storage", tags=["storage"])
