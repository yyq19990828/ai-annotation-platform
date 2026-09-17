from enum import Enum


class UserRole(str, Enum):
    SUPER_ADMIN = "super_admin"
    PROJECT_ADMIN = "project_admin"
    REVIEWER = "reviewer"
    ANNOTATOR = "annotator"
    VIEWER = "viewer"


class ProjectStatus(str, Enum):
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    PENDING_REVIEW = "pending_review"
    ARCHIVED = "archived"


class TaskStatus(str, Enum):
    UPLOADING = "uploading"
    PENDING = "pending"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    REVIEW = "review"
    REJECTED = "rejected"


# issue #121 · 工作台单题交互 AI 允许的任务状态 (与标注写入口径一致)。
# 排除 uploading (对象尚未校验) 与终态 review/completed; 批量预标另按 pending-only 校验。
# API 校验与 worker 复校验共用, 避免两处状态集合漂移。
WORKBENCH_AI_EDITABLE_TASK_STATUSES = frozenset(
    {
        TaskStatus.PENDING.value,
        TaskStatus.IN_PROGRESS.value,
        TaskStatus.REJECTED.value,
    }
)


class BatchStatus(str, Enum):
    DRAFT = "draft"
    ACTIVE = "active"
    # v0.9.5 · AI 文本批量预标已跑完，等待人工接管/分派；语义介于 ACTIVE 与 ANNOTATING。
    PRE_ANNOTATED = "pre_annotated"
    ANNOTATING = "annotating"
    REVIEWING = "reviewing"
    APPROVED = "approved"
    REJECTED = "rejected"
    ARCHIVED = "archived"


class AnnotationSource(str, Enum):
    MANUAL = "manual"
    PREDICTION_BASED = "prediction_based"


class MLBackendState(str, Enum):
    CONNECTED = "connected"
    DISCONNECTED = "disconnected"
    ERROR = "error"
    PREDICTING = "predicting"


class MLBackendAuthMethod(str, Enum):
    NONE = "none"
    BASIC = "basic"
    TOKEN = "token"


class OrgMemberRole(str, Enum):
    OWNER = "owner"
    ADMIN = "admin"
    MEMBER = "member"


class DatasetDataType(str, Enum):
    IMAGE = "image"
    VIDEO = "video"
    POINT_CLOUD = "point_cloud"
    MULTIMODAL = "multimodal"
    OTHER = "other"
