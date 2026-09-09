"""Schemas for the admin management surfaces introduced in Phase E.

These contracts intentionally live beside the existing resource schemas.  The
legacy list endpoints keep their array responses, while the management
endpoints use explicit paginated envelopes and per-item operation results.
"""

from __future__ import annotations

from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

from app.schemas.group import GroupOut
from app.schemas.invitation import InvitationCreate, InvitationOut
from app.schemas.user import UserOut


class UserPage(BaseModel):
    items: list[UserOut]
    total: int
    page: int
    page_size: int
    pages: int


class UserStats(BaseModel):
    total: int
    online: int
    weekly_active: int


class GroupPage(BaseModel):
    items: list[GroupOut]
    total: int
    page: int
    page_size: int
    pages: int


class InvitationPage(BaseModel):
    items: list[InvitationOut]
    total: int
    page: int
    page_size: int
    pages: int


class InvitationStats(BaseModel):
    total: int
    pending: int
    accepted: int
    expired: int
    revoked: int


class InvitationSendEmailResponse(BaseModel):
    ok: bool = True
    invitation_id: UUID
    email: str
    invite_url: str
    message: str


class BulkInviteRequest(BaseModel):
    items: list[InvitationCreate] = Field(min_length=1, max_length=500)


class BulkInviteResultItem(BaseModel):
    index: int
    email: str
    ok: bool
    retryable: bool = False
    invitation_id: UUID | None = None
    token: str | None = None
    invite_url: str | None = None
    project_id: UUID | None = None
    project_name: str | None = None
    error: str | None = None


class BulkInviteResponse(BaseModel):
    items: list[BulkInviteResultItem]
    succeeded: int
    failed: int
    preview: bool = False


class BulkGroupAssignmentRequest(BaseModel):
    user_ids: list[UUID] = Field(min_length=1, max_length=500)
    group_id: UUID | None = None


class GroupAssignmentPreviewItem(BaseModel):
    user_id: UUID
    email: str | None = None
    name: str | None = None
    ok: bool
    current_group_id: UUID | None = None
    current_group_name: str | None = None
    next_group_id: UUID | None = None
    next_group_name: str | None = None
    error: str | None = None


class BulkGroupAssignmentPreview(BaseModel):
    group_id: UUID | None = None
    group_name: str | None = None
    items: list[GroupAssignmentPreviewItem]
    applicable: int
    blocked: int


class BulkGroupAssignmentResultItem(BaseModel):
    user_id: UUID
    ok: bool
    retryable: bool = False
    error: str | None = None


class BulkGroupAssignmentResponse(BaseModel):
    items: list[BulkGroupAssignmentResultItem]
    succeeded: int
    failed: int


class BatchDistributionPreviewItem(BaseModel):
    batch_id: UUID
    display_id: str
    name: str
    status: str
    before_annotator_id: UUID | None = None
    after_annotator_id: UUID | None = None
    before_reviewer_id: UUID | None = None
    after_reviewer_id: UUID | None = None
    will_change: bool
    skipped_reason: str | None = None


class BatchDistributionPreview(BaseModel):
    project_id: UUID
    only_unassigned: bool
    total_batches: int
    candidate_batches: int
    changed_batches: int
    skipped_batches: int
    items: list[BatchDistributionPreviewItem]


class RoleImpactProject(BaseModel):
    project_id: UUID
    project_name: str
    membership_role: str | None = None
    annotator_batch_count: int = 0
    reviewer_batch_count: int = 0
    assigned_task_count: int = 0
    review_task_count: int = 0


class RoleImpactPreview(BaseModel):
    user_id: UUID
    email: str
    current_role: str
    requested_role: str
    can_change: bool
    blockers: list[str] = Field(default_factory=list)
    projects: list[RoleImpactProject] = Field(default_factory=list)
    assigned_batch_count: int = 0
    assigned_task_count: int = 0
    review_task_count: int = 0


class ManagementStatusFilter(BaseModel):
    status: Literal["active", "inactive", "all"] = "active"
