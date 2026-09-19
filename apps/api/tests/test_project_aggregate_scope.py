"""Pure SQL-contract tests for project-role aggregate scopes (Increment B3).

No database: the aggregate/delivery helpers must derive project scope from
``project_members`` and platform ownership, never from a legacy global staff
role, and a non-administrative owner must not receive the management arm.
"""

from __future__ import annotations

import uuid

import pytest

from app.db.models.project import Project
from app.db.models.task import Task
from app.db.models.user import User
from app.services.project_aggregates import (
    ANNOTATOR_ROLE,
    DASHBOARD_PLATFORM_ROLES,
    REVIEWER_ROLE,
    member_user_ids,
    membership_project_ids,
    platform_role_is_manager,
    project_scope_clause,
    task_project_scope,
)


def _sql(clause) -> str:
    return str(clause.compile(compile_kwargs={"literal_binds": False}))


def _sql_literals(clause) -> str:
    return str(clause.compile(compile_kwargs={"literal_binds": True}))


def _user(role: str) -> User:
    return User(id=uuid.uuid4(), role=role, is_active=True)


def test_dashboard_platform_roles_exclude_legacy_staff():
    values = {role.value for role in DASHBOARD_PLATFORM_ROLES}
    assert values == {"super_admin", "project_admin", "employee"}
    assert "annotator" not in values
    assert "reviewer" not in values


def test_super_admin_gets_global_scope():
    assert project_scope_clause(_user("super_admin"), Task.project_id) is None
    assert (
        task_project_scope(_user("super_admin"), project_roles=(ANNOTATOR_ROLE,))
        is None
    )


@pytest.mark.parametrize(
    "platform_role", ["employee", "viewer", "annotator", "reviewer"]
)
def test_non_manager_scope_is_membership_only(platform_role):
    """Legacy staff roles and employees get only the membership arm."""

    clause = task_project_scope(_user(platform_role), project_roles=(ANNOTATOR_ROLE,))
    sql = _sql(clause)
    assert clause is not None
    assert "project_members" in sql
    assert "project_members.role" in sql
    assert "projects.owner_id" not in sql


def test_project_admin_scope_includes_owned_and_membership_projects():
    clause = project_scope_clause(
        _user("project_admin"), Project.id, project_roles=(REVIEWER_ROLE,)
    )
    sql = _sql(clause)
    assert "project_members" in sql
    assert "projects.owner_id" in sql


def test_project_scope_binds_requested_column():
    task_clause = _sql(task_project_scope(_user("employee")))
    project_clause = _sql(project_scope_clause(_user("employee"), Project.id))
    assert "tasks.project_id" in task_clause
    assert "projects.id" in project_clause


def test_role_filters_are_explicit():
    annotator_sql = _sql_literals(
        project_scope_clause(
            _user("employee"), Task.project_id, project_roles=(ANNOTATOR_ROLE,)
        )
    )
    reviewer_sql = _sql_literals(
        project_scope_clause(
            _user("employee"), Task.project_id, project_roles=(REVIEWER_ROLE,)
        )
    )
    assert "'annotator'" in annotator_sql
    assert "'reviewer'" in reviewer_sql
    assert annotator_sql != reviewer_sql
    # The bound role value is a membership role, never an account-role alias.
    assert "users.role" not in annotator_sql
    assert "users.role" not in reviewer_sql


def test_membership_helpers_filter_by_role():
    user = _user("employee")
    assert "project_members" in _sql(membership_project_ids(user))
    assert "project_members.role" in _sql(membership_project_ids(user, ANNOTATOR_ROLE))
    assert "project_members.role" in _sql(member_user_ids(uuid.uuid4(), REVIEWER_ROLE))


def test_platform_role_is_manager():
    assert platform_role_is_manager("super_admin")
    assert platform_role_is_manager("project_admin")
    assert not platform_role_is_manager("employee")
    assert not platform_role_is_manager("annotator")
    assert not platform_role_is_manager("viewer")
    assert not platform_role_is_manager(None)
