from pydantic import BaseModel


class AdminDashboardStats(BaseModel):
    total_users: int
    active_users: int
    total_projects: int
    projects_in_progress: int
    projects_completed: int
    projects_pending_review: int
    projects_archived: int
    total_tasks: int
    total_annotations: int
    ml_backends_total: int
    ml_backends_connected: int
    role_distribution: dict[str, int]


class ReviewTaskItem(BaseModel):
    task_id: str
    task_display_id: str
    file_name: str
    project_id: str
    project_name: str
    total_annotations: int
    total_predictions: int
    updated_at: str | None

    class Config:
        from_attributes = True


class ReviewerDashboardStats(BaseModel):
    pending_review_count: int
    today_reviewed: int
    approval_rate: float
    # v0.6.6 · 24h 滚动通过率：完成 / (完成 + 退回)，仅看过去 24 小时
    approval_rate_24h: float
    total_reviewed: int
    pending_tasks: list[ReviewTaskItem]


class RecentReviewItem(BaseModel):
    task_id: str
    task_display_id: str
    file_name: str
    project_id: str
    project_name: str
    status: str
    reviewed_at: str | None

    class Config:
        from_attributes = True


class AnnotatorDashboardStats(BaseModel):
    assigned_tasks: int
    today_completed: int
    weekly_completed: int
    total_completed: int
    personal_accuracy: float
    daily_counts: list[int]
