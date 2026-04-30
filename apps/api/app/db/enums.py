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


class BatchStatus(str, Enum):
    DRAFT = "draft"
    ACTIVE = "active"
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
