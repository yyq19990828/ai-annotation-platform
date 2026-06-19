"""batch 状态机权限守卫纯函数表征测试。

守护 services/batch.py 的 _is_owner / _is_reviewer / _is_annotator_assigned /
assert_can_transition —— 这些是无 DB 依赖的纯判定函数,可直接构造 ORM 实例测试。
作为「巨石拆分 Epic」缓拆项补测试再拆的守护网:本文件先对当前代码绿,
后续把这 4 个函数搬到 batch_permissions.py 后(batch.py re-export),本文件一字不改仍绿。
"""

from __future__ import annotations

import uuid

import pytest
from fastapi import HTTPException

from app.db.enums import BatchStatus, UserRole
from app.db.models.project import Project
from app.db.models.task_batch import TaskBatch
from app.db.models.user import User
from app.services.batch import (
    REVERSE_TRANSITIONS,
    VALID_TRANSITIONS,
    _is_annotator_assigned,
    _is_owner,
    _is_reviewer,
    assert_can_transition,
)


def _user(role: UserRole, uid: uuid.UUID | None = None) -> User:
    return User(id=uid or uuid.uuid4(), role=role)


def _project(owner_id: uuid.UUID) -> Project:
    return Project(owner_id=owner_id)


def _batch(status: str, annotator_id: uuid.UUID | None = None) -> TaskBatch:
    return TaskBatch(status=status, annotator_id=annotator_id)


# 全部 (src, dst) 合法边,从 VALID_TRANSITIONS 展开,用于矩阵参数化。
ALL_EDGES = [(src, dst) for src, dsts in VALID_TRANSITIONS.items() for dst in dsts]


# ── _is_owner ──────────────────────────────────────────────────────────────


class TestIsOwner:
    def test_super_admin_is_always_owner(self):
        user = _user(UserRole.SUPER_ADMIN)
        # owner_id 是别人,super_admin 仍判定为 owner
        assert _is_owner(user, _project(uuid.uuid4())) is True

    def test_project_owner_is_owner(self):
        user = _user(UserRole.ANNOTATOR)
        assert _is_owner(user, _project(user.id)) is True

    def test_non_owner_non_admin_is_not_owner(self):
        user = _user(UserRole.REVIEWER)
        assert _is_owner(user, _project(uuid.uuid4())) is False


# ── _is_reviewer ───────────────────────────────────────────────────────────


class TestIsReviewer:
    def test_super_admin_is_reviewer(self):
        user = _user(UserRole.SUPER_ADMIN)
        assert _is_reviewer(user, _project(uuid.uuid4())) is True

    def test_project_owner_is_reviewer(self):
        user = _user(UserRole.ANNOTATOR)
        assert _is_reviewer(user, _project(user.id)) is True

    def test_reviewer_role_is_reviewer(self):
        user = _user(UserRole.REVIEWER)
        assert _is_reviewer(user, _project(uuid.uuid4())) is True

    def test_plain_annotator_is_not_reviewer(self):
        user = _user(UserRole.ANNOTATOR)
        assert _is_reviewer(user, _project(uuid.uuid4())) is False


# ── _is_annotator_assigned ──────────────────────────────────────────────────


class TestIsAnnotatorAssigned:
    def test_assigned_annotator_matches(self):
        user = _user(UserRole.ANNOTATOR)
        assert _is_annotator_assigned(user, _batch("annotating", user.id)) is True

    def test_non_annotator_role_never_assigned(self):
        # reviewer 即使 annotator_id 恰好等于自己 id,也不算 annotator_assigned
        user = _user(UserRole.REVIEWER)
        assert _is_annotator_assigned(user, _batch("annotating", user.id)) is False

    def test_unassigned_batch_is_false(self):
        user = _user(UserRole.ANNOTATOR)
        assert _is_annotator_assigned(user, _batch("annotating", None)) is False

    def test_other_annotator_assigned_is_false(self):
        user = _user(UserRole.ANNOTATOR)
        assert _is_annotator_assigned(user, _batch("annotating", uuid.uuid4())) is False


# ── assert_can_transition ───────────────────────────────────────────────────


def _assert_allowed(user, project, batch, dst):
    # 不抛异常即放行
    assert assert_can_transition(user, project, batch, dst) is None


def _assert_denied(user, project, batch, dst):
    with pytest.raises(HTTPException) as exc:
        assert_can_transition(user, project, batch, dst)
    assert exc.value.status_code == 403


class TestAssertCanTransitionOwner:
    @pytest.mark.parametrize("src,dst", ALL_EDGES)
    def test_super_admin_allows_every_valid_edge(self, src, dst):
        user = _user(UserRole.SUPER_ADMIN)
        project = _project(uuid.uuid4())
        _assert_allowed(user, project, _batch(src), dst)

    @pytest.mark.parametrize("src,dst", ALL_EDGES)
    def test_project_owner_allows_every_valid_edge(self, src, dst):
        # role 是 annotator,但身为项目 owner 应放行所有合法边
        user = _user(UserRole.ANNOTATOR)
        project = _project(user.id)
        _assert_allowed(user, project, _batch(src, user.id), dst)


class TestAssertCanTransitionReviewer:
    # reviewer(非 owner)仅在 reviewing → approved / rejected 放行,其余全 403。
    @pytest.mark.parametrize("src,dst", ALL_EDGES)
    def test_reviewer_matrix(self, src, dst):
        user = _user(UserRole.REVIEWER)
        project = _project(uuid.uuid4())
        batch = _batch(src)
        if src == BatchStatus.REVIEWING and dst in (
            BatchStatus.APPROVED,
            BatchStatus.REJECTED,
        ):
            _assert_allowed(user, project, batch, dst)
        else:
            _assert_denied(user, project, batch, dst)


class TestAssertCanTransitionAnnotator:
    def test_assigned_annotator_can_submit_for_review(self):
        user = _user(UserRole.ANNOTATOR)
        project = _project(uuid.uuid4())
        batch = _batch(BatchStatus.ANNOTATING, user.id)
        _assert_allowed(user, project, batch, BatchStatus.REVIEWING)

    def test_unassigned_annotator_cannot_submit_for_review(self):
        user = _user(UserRole.ANNOTATOR)
        project = _project(uuid.uuid4())
        batch = _batch(BatchStatus.ANNOTATING, None)
        _assert_denied(user, project, batch, BatchStatus.REVIEWING)

    @pytest.mark.parametrize("src,dst", ALL_EDGES)
    def test_assigned_annotator_denied_everywhere_else(self, src, dst):
        # 被分派标注员除 annotating → reviewing 外,其余合法边一律 403。
        if (src, dst) == (BatchStatus.ANNOTATING, BatchStatus.REVIEWING):
            pytest.skip("唯一放行边,由专门用例覆盖")
        user = _user(UserRole.ANNOTATOR)
        project = _project(uuid.uuid4())
        batch = _batch(src, user.id)
        _assert_denied(user, project, batch, dst)


class TestAssertCanTransitionReverse:
    # 逆向迁移 owner-only:非 owner 一律 403,owner 放行。
    @pytest.mark.parametrize("src,dst", sorted(REVERSE_TRANSITIONS))
    def test_reverse_denied_for_reviewer(self, src, dst):
        user = _user(UserRole.REVIEWER)
        _assert_denied(user, _project(uuid.uuid4()), _batch(src), dst)

    @pytest.mark.parametrize("src,dst", sorted(REVERSE_TRANSITIONS))
    def test_reverse_allowed_for_super_admin(self, src, dst):
        user = _user(UserRole.SUPER_ADMIN)
        _assert_allowed(user, _project(uuid.uuid4()), _batch(src), dst)
