from fastapi import APIRouter
from app.api.v1 import (
    auth,
    audit_logs,
    annotation_comments,
    annotation_history,
    batches,
    bug_reports,
    dashboard,
    datasets,
    files,
    groups,
    invitations,
    invitations_admin,
    me,
    ml_backends,
    notifications,
    projects,
    search,
    storage,
    system_settings,
    tasks,
    users,
)

api_router = APIRouter()
api_router.include_router(auth.router, prefix="/auth", tags=["auth"])
api_router.include_router(invitations.router, prefix="/auth", tags=["auth"])
api_router.include_router(invitations_admin.router, prefix="/invitations", tags=["invitations"])
api_router.include_router(me.router, prefix="/auth/me", tags=["me"])
api_router.include_router(projects.router, prefix="/projects", tags=["projects"])
api_router.include_router(tasks.router, prefix="/tasks", tags=["tasks"])
api_router.include_router(users.router, prefix="/users", tags=["users"])
api_router.include_router(groups.router, prefix="/groups", tags=["groups"])
api_router.include_router(dashboard.router, prefix="/dashboard", tags=["dashboard"])
api_router.include_router(ml_backends.router, prefix="/projects/{project_id}/ml-backends", tags=["ml-backends"])
api_router.include_router(files.router, prefix="/files", tags=["files"])
api_router.include_router(datasets.router, prefix="/datasets", tags=["datasets"])
api_router.include_router(storage.router, prefix="/storage", tags=["storage"])
api_router.include_router(audit_logs.router, prefix="/audit-logs", tags=["audit"])
api_router.include_router(system_settings.router, prefix="/settings", tags=["settings"])
api_router.include_router(batches.router, prefix="/projects/{project_id}/batches", tags=["batches"])
api_router.include_router(annotation_comments.router, tags=["annotation-comments"])
api_router.include_router(annotation_history.router, tags=["annotation-history"])
api_router.include_router(search.router, prefix="/search", tags=["search"])
api_router.include_router(bug_reports.router, tags=["bug-reports"])
api_router.include_router(notifications.router, tags=["notifications"])
