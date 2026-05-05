from pydantic import BaseModel

from app.schemas.user import UserBrief


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


class ReviewingBatchItem(BaseModel):
    batch_id: str
    batch_display_id: str
    batch_name: str
    project_id: str
    project_name: str
    total_tasks: int
    review_tasks: int
    completed_tasks: int
    # v0.7.2 · 责任人可视化：审核员看到这批是谁标的（单值）
    annotator: UserBrief | None = None

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
    # v0.7.0 · 批次级聚合：当前 reviewing 状态的批次列表
    reviewing_batches: list[ReviewingBatchItem] = []


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


class MyBatchItem(BaseModel):
    """v0.7.1 B-17 · 标注员视角的批次卡片：自己被分派的、状态为
    active / annotating / rejected / reviewing 的批次。"""

    batch_id: str
    batch_display_id: str
    batch_name: str
    project_id: str
    project_name: str
    status: str
    total_tasks: int
    completed_tasks: int
    review_tasks: int
    approved_tasks: int
    rejected_tasks: int
    progress_pct: float
    review_feedback: str | None = None
    reviewed_at: str | None = None
    # v0.7.2 · 责任人可视化：标注员看到这批的审核员是谁（单值）
    reviewer: UserBrief | None = None

    class Config:
        from_attributes = True
