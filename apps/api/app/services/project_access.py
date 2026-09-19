"""Immutable project access context and capability matrix.

This is the single authorization source introduced by the project-scoped
employee-roles plan (Increment B1).  Downstream workflow, delivery and frontend
work packages consume these contracts instead of reading a global
``User.role``.

Model
-----
* Platform role lives on the account (``users.role``): ``super_admin``,
  ``project_admin``, ``employee`` or ``viewer``.
* Project role lives on the membership (``project_members.role``):
  ``annotator``, ``reviewer`` or ``viewer``.
* Managers are a super administrator or the project owner whose platform role
  is a valid administrative role.  A platform ``project_admin`` who is only a
  member of another project receives at most that membership's capabilities,
  never management.
* Membership role is never inferred from the account role and an unknown role
  fails closed.

All helpers are read-only unless explicitly documented.  Mutations live in
``services/project_membership.py``.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from enum import Enum

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.enums import (
    LEGACY_PLATFORM_STAFF_ROLES,
    MANAGER_PLATFORM_ROLES,
    PLATFORM_ROLES,
    PROJECT_ROLES,
    PlatformRole,
    ProjectRole,
)
from app.db.models.project import Project
from app.db.models.project_member import ProjectMember
from app.db.models.user import User


class ProjectCapability(str, Enum):
    """Fixed capability set for a project request context."""

    PROJECT_READ = "project.read"
    PROJECT_MANAGE = "project.manage"
    MEMBER_READ = "member.read"
    MEMBER_MANAGE = "member.manage"
    TASK_READ = "task.read"
    ANNOTATION_WRITE = "annotation.write"
    REVIEW_WRITE = "review.write"
    #: Full project / batch / selected-task annotation export.  Deliberately
    #: excludes annotators and viewers (plan section 3).
    EXPORT_ANNOTATIONS = "export.annotations"
    #: Project performance details and performance CSV.  Owner / super-admin
    #: only; annotation export does not grant access to others' performance.
    PERFORMANCE_READ = "performance.read"


ACCESS_KIND_SUPER_ADMIN = "super_admin"
ACCESS_KIND_OWNER = "owner"
ACCESS_KIND_MEMBER = "member"

_READ_CAPABILITIES = frozenset(
    {
        ProjectCapability.PROJECT_READ.value,
        ProjectCapability.MEMBER_READ.value,
        ProjectCapability.TASK_READ.value,
    }
)
#: Managers receive the complete capability set for their project.
MANAGER_CAPABILITIES = frozenset(capability.value for capability in ProjectCapability)

_ANNOTATOR_CAPABILITIES = _READ_CAPABILITIES | {
    ProjectCapability.ANNOTATION_WRITE.value,
}
_REVIEWER_CAPABILITIES = _READ_CAPABILITIES | {
    ProjectCapability.REVIEW_WRITE.value,
    ProjectCapability.EXPORT_ANNOTATIONS.value,
}
_VIEWER_CAPABILITIES = _READ_CAPABILITIES

_PROJECT_ROLE_CAPABILITIES: dict[str, frozenset[str]] = {
    ProjectRole.ANNOTATOR.value: frozenset(_ANNOTATOR_CAPABILITIES),
    ProjectRole.REVIEWER.value: frozenset(_REVIEWER_CAPABILITIES),
    ProjectRole.VIEWER.value: frozenset(_VIEWER_CAPABILITIES),
}


def project_role_capabilities(project_role: str) -> frozenset[str]:
    """Return the capability set for a project role; unknown roles fail closed."""

    return _PROJECT_ROLE_CAPABILITIES.get(project_role, frozenset())


def platform_role_is_manager(platform_role: str) -> bool:
    return platform_role in MANAGER_PLATFORM_ROLES


def membership_role_compatible(platform_role: str, project_role: str) -> bool:
    """Whether ``platform_role`` may hold ``project_role`` membership.

    * ``employee`` (and its pre-cutover legacy staff aliases) may hold any
      project role.
    * ``viewer`` accounts may only hold a ``viewer`` membership; accepting an
      employee invitation must never silently upgrade a viewer.
    * Managers and super administrators receive authority from ownership, not
      from a membership row, so they have no compatible membership role.
    """

    if project_role not in PROJECT_ROLES:
        return False
    if platform_role == PlatformRole.VIEWER.value:
        return project_role == ProjectRole.VIEWER.value
    if platform_role == PlatformRole.EMPLOYEE.value:
        return True
    # Pre-cutover staff accounts are treated as employees for membership
    # pairing, but never as global authority.
    if platform_role in LEGACY_PLATFORM_STAFF_ROLES:
        return True
    return False


def assert_membership_role_compatible(platform_role: str, project_role: str) -> None:
    if membership_role_compatible(platform_role, project_role):
        return
    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail=(
            "账号平台角色与项目职责不兼容：员工可持有标注员/质检员/观察者，"
            "平台观察者仅可持有观察者，管理员通过项目负责人身份管理项目"
        ),
    )


@dataclass(frozen=True, slots=True)
class ProjectAccess:
    """Immutable request context for one account in one project.

    The context is resolved once per request and must be rejected when it does
    not match the resource's actual project.  Never assign
    ``user.role = member.role`` to reuse legacy helpers.
    """

    user_id: uuid.UUID
    project_id: uuid.UUID
    platform_role: str
    project_role: str | None
    membership_id: uuid.UUID | None
    membership_version: int | None
    access_kind: str
    capabilities: frozenset[str]
    is_super_admin: bool = False
    is_owner: bool = False
    is_manager: bool = False

    def has(self, *capabilities: str) -> bool:
        return all(capability in self.capabilities for capability in capabilities)


def _manager_access(
    *,
    user: User,
    project: Project,
    access_kind: str,
    is_super_admin: bool,
    is_owner: bool,
    project_role: str | None = None,
) -> ProjectAccess:
    return ProjectAccess(
        user_id=user.id,
        project_id=project.id,
        platform_role=user.role,
        project_role=project_role,
        membership_id=None,
        membership_version=None,
        access_kind=access_kind,
        capabilities=MANAGER_CAPABILITIES,
        is_super_admin=is_super_admin,
        is_owner=is_owner,
        is_manager=True,
    )


async def resolve_project_access(
    db: AsyncSession,
    *,
    user: User,
    project: Project,
    lock_membership: bool = False,
) -> ProjectAccess:
    """Resolve the immutable access context for ``user`` on ``project``.

    ``lock_membership=True`` acquires the membership with ``FOR SHARE`` so an
    in-flight authorized mutation can finish before a role change commits while
    still conflicting with the role-changing ``FOR UPDATE``.

    Raises 404 when the account cannot see the project at all (existence is
    hidden) and 403 when a visible membership is internally inconsistent.
    """

    if user.role == PlatformRole.SUPER_ADMIN.value:
        return _manager_access(
            user=user,
            project=project,
            access_kind=ACCESS_KIND_SUPER_ADMIN,
            is_super_admin=True,
            is_owner=project.owner_id == user.id,
        )

    if project.owner_id == user.id:
        if platform_role_is_manager(user.role):
            return _manager_access(
                user=user,
                project=project,
                access_kind=ACCESS_KIND_OWNER,
                is_super_admin=False,
                is_owner=True,
            )
        # Anomalous owner whose platform role is not administrative.  This is a
        # migration blocker: keep the project visible read-only and never grant
        # manager authority from ownership alone.
        return ProjectAccess(
            user_id=user.id,
            project_id=project.id,
            platform_role=user.role,
            project_role=None,
            membership_id=None,
            membership_version=None,
            access_kind=ACCESS_KIND_MEMBER,
            capabilities=_READ_CAPABILITIES,
            is_owner=True,
            is_manager=False,
        )

    stmt = select(ProjectMember).where(
        ProjectMember.project_id == project.id,
        ProjectMember.user_id == user.id,
    )
    if lock_membership:
        stmt = stmt.with_for_update(read=True)
    member = (await db.execute(stmt)).scalar_one_or_none()
    if member is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="项目不存在")

    if user.role not in PLATFORM_ROLES and user.role not in LEGACY_PLATFORM_STAFF_ROLES:
        # Unknown platform role fails closed.  Pre-cutover staff aliases are
        # treated as employee for membership capabilities only; they never
        # grant the old global authority.
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="账号角色无效，访问被拒绝"
        )
    project_role = member.role
    if project_role not in PROJECT_ROLES:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="项目职责无效，访问被拒绝"
        )
    if (
        user.role == PlatformRole.VIEWER.value
        and project_role != ProjectRole.VIEWER.value
    ):
        # A viewer may only ever hold a viewer membership; fail closed on
        # inconsistent rows rather than granting work capabilities.
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="账号平台角色与项目职责不兼容"
        )

    return ProjectAccess(
        user_id=user.id,
        project_id=project.id,
        platform_role=user.role,
        project_role=project_role,
        membership_id=member.id,
        membership_version=member.version,
        access_kind=ACCESS_KIND_MEMBER,
        capabilities=project_role_capabilities(project_role),
        is_manager=False,
    )


async def resolve_project_access_by_id(
    db: AsyncSession,
    *,
    user: User,
    project_id: uuid.UUID,
    lock_membership: bool = False,
) -> tuple[Project, ProjectAccess]:
    project = await db.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="项目不存在")
    access = await resolve_project_access(
        db, user=user, project=project, lock_membership=lock_membership
    )
    return project, access


def assert_context_matches_project(
    access: ProjectAccess, project_id: uuid.UUID
) -> None:
    """Reject a context/resource project mismatch before any read or write."""

    if access.project_id != project_id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "reason": "access_context_mismatch",
                "detail": "访问上下文与资源项目不一致",
            },
        )


def assert_capability(access: ProjectAccess, *capabilities: str) -> None:
    missing = sorted(cap for cap in capabilities if cap not in access.capabilities)
    if missing:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"缺少项目权限: {', '.join(missing)}",
        )
