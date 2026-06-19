"""batch 状态机迁移的角色权限守卫。

从 services/batch.py 抽出的纯判定逻辑(无 DB 依赖):逆向迁移白名单
REVERSE_TRANSITIONS 与角色门禁函数。语法层(VALID_TRANSITIONS)仍由 batch.py
的 transition() 检查;本模块只做角色权限判定。batch.py 经 re-export 保持
`from app.services.batch import ...` 旧入口不变。
"""

from __future__ import annotations

from fastapi import HTTPException

from app.db.enums import BatchStatus, UserRole
from app.db.models.project import Project
from app.db.models.task_batch import TaskBatch
from app.db.models.user import User

# v0.7.3：owner-only 逆向迁移白名单。命中时必须传 reason（1-500 字），写入 audit_log.detail_json.reason。
REVERSE_TRANSITIONS: set[tuple[str, str]] = {
    (BatchStatus.ARCHIVED, BatchStatus.ACTIVE),
    (BatchStatus.APPROVED, BatchStatus.REVIEWING),
    (BatchStatus.REJECTED, BatchStatus.REVIEWING),
    # v0.9.5：丢弃 AI 预标 predictions 重置（owner 兜底，需 reason）
    (BatchStatus.PRE_ANNOTATED, BatchStatus.ACTIVE),
}


# v0.7.0：transition 鉴权矩阵 — (from, to) 元组 → 允许角色集合 / 特殊判定
# 'owner' = super_admin 或项目 owner（require_project_owner 等价）
# 'reviewer' = super_admin / project_admin(owner) / reviewer
# 'annotator_assigned' = 标注员且 user_id == batch.annotator_id（v0.7.2 单值语义）
def _is_owner(user: User, project: Project) -> bool:
    return user.role == UserRole.SUPER_ADMIN or project.owner_id == user.id


def _is_reviewer(user: User, project: Project) -> bool:
    return _is_owner(user, project) or user.role == UserRole.REVIEWER


def _is_annotator_assigned(user: User, batch: TaskBatch) -> bool:
    """v0.7.2：单值语义 — batch.annotator_id == user.id。"""
    if user.role != UserRole.ANNOTATOR:
        return False
    return batch.annotator_id is not None and batch.annotator_id == user.id


def assert_can_transition(
    user: User,
    project: Project,
    batch: TaskBatch,
    target_status: str,
) -> None:
    """v0.7.0：按 (from, to) 校验角色权限，403 携带可读 detail。
    语法层（VALID_TRANSITIONS）由 transition() 内部检查；本函数只做角色门禁。
    """
    src = batch.status
    dst = target_status

    # v0.7.3：逆向迁移（撤销归档 / 重开审核 / 跳标复审）owner-only，非 owner 直接拒
    if (src, dst) in REVERSE_TRANSITIONS:
        if not _is_owner(user, project):
            raise HTTPException(
                status_code=403,
                detail=f"{user.role} cannot reverse-transition {src} -> {dst}",
            )
        return

    # owner / super_admin 始终放行（包含 archived 出口、rejected 重激活）
    if _is_owner(user, project):
        return

    # draft → active：仅 owner（已被上面拦截）；其他角色拒绝
    if (src, dst) == (BatchStatus.DRAFT, BatchStatus.ACTIVE):
        raise HTTPException(
            status_code=403, detail=f"{user.role} cannot transition draft -> active"
        )

    # active → annotating：仅 check_auto_transitions 内部驱动；REST 一律拒绝
    if (src, dst) == (BatchStatus.ACTIVE, BatchStatus.ANNOTATING):
        raise HTTPException(
            status_code=403, detail="active -> annotating is auto-driven only"
        )

    # v0.9.5：active → pre_annotated 仅 batch_predict task 内部驱动；REST 一律拒绝
    if (src, dst) == (BatchStatus.ACTIVE, BatchStatus.PRE_ANNOTATED):
        raise HTTPException(
            status_code=403, detail="active -> pre_annotated is auto-driven only"
        )

    # v0.9.5：pre_annotated → annotating 与 active 同语义，scheduler 内部驱动
    if (src, dst) == (BatchStatus.PRE_ANNOTATED, BatchStatus.ANNOTATING):
        raise HTTPException(
            status_code=403, detail="pre_annotated -> annotating is auto-driven only"
        )

    # annotating → reviewing：标注员（被分派）可主动整批提交质检
    if (src, dst) == (BatchStatus.ANNOTATING, BatchStatus.REVIEWING):
        if _is_annotator_assigned(user, batch):
            return
        raise HTTPException(
            status_code=403,
            detail=f"{user.role} cannot transition annotating -> reviewing",
        )

    # reviewing → approved / rejected：reviewer
    if src == BatchStatus.REVIEWING and dst in (
        BatchStatus.APPROVED,
        BatchStatus.REJECTED,
    ):
        if _is_reviewer(user, project):
            return
        raise HTTPException(
            status_code=403, detail=f"{user.role} cannot transition reviewing -> {dst}"
        )

    # rejected → active：仅 owner（已被上面拦截）
    if (src, dst) == (BatchStatus.REJECTED, BatchStatus.ACTIVE):
        raise HTTPException(
            status_code=403, detail=f"{user.role} cannot reactivate rejected batch"
        )

    # 任意 → archived：仅 owner（已被上面拦截）
    if dst == BatchStatus.ARCHIVED:
        raise HTTPException(status_code=403, detail=f"{user.role} cannot archive batch")

    # approved → 其他：仅 archived 合法（VALID_TRANSITIONS 已限），owner 已放行；其他拒
    raise HTTPException(
        status_code=403, detail=f"{user.role} cannot transition {src} -> {dst}"
    )
