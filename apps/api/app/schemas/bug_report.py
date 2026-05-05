from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field


class BugReportCreate(BaseModel):
    title: str = Field(min_length=1, max_length=500)
    description: str = Field(min_length=1)
    severity: str = Field(default="medium", pattern="^(low|medium|high|critical)$")
    route: str = ""
    browser_ua: str | None = None
    viewport: str | None = None
    project_id: UUID | None = None
    task_id: UUID | None = None
    recent_api_calls: list[dict] | None = None
    recent_console_errors: list[dict] | None = None
    screenshot_url: str | None = None


class BugReportUpdate(BaseModel):
    status: str | None = Field(
        default=None, pattern="^(new|triaged|in_progress|fixed|wont_fix|duplicate)$"
    )
    severity: str | None = Field(default=None, pattern="^(low|medium|high|critical)$")
    title: str | None = Field(default=None, min_length=1, max_length=500)
    description: str | None = None
    duplicate_of_id: UUID | None = None
    assigned_to_id: UUID | None = None
    fixed_in_version: str | None = None
    resolution: str | None = None


class BugCommentCreate(BaseModel):
    body: str = Field(min_length=1)


class BugCommentOut(BaseModel):
    id: UUID
    bug_report_id: UUID
    author_id: UUID
    author_name: str = ""
    author_role: str = ""
    body: str
    created_at: datetime

    class Config:
        from_attributes = True


class BugReportOut(BaseModel):
    id: UUID
    display_id: str
    reporter_id: UUID
    route: str
    user_role: str
    project_id: UUID | None = None
    task_id: UUID | None = None
    title: str
    description: str
    severity: str
    status: str
    duplicate_of_id: UUID | None = None
    browser_ua: str | None = None
    viewport: str | None = None
    recent_api_calls: list[dict] | None = None
    recent_console_errors: list[dict] | None = None
    screenshot_url: str | None = None
    resolution: str | None = None
    fixed_in_version: str | None = None
    assigned_to_id: UUID | None = None
    created_at: datetime
    triaged_at: datetime | None = None
    fixed_at: datetime | None = None
    reopen_count: int = 0
    last_reopened_at: datetime | None = None

    class Config:
        from_attributes = True


class BugReportDetail(BugReportOut):
    comments: list[BugCommentOut] = []


class BugReportList(BaseModel):
    items: list[BugReportOut]
    total: int
