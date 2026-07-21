"""v0.8.3 · 仅测试 / 非 production 环境暴露的 seed router。

E2E（Playwright）通过 `POST /api/v1/__test/seed/reset` 在每个 spec 前重置数据库
到固定 fixture（admin / annotator / reviewer 三个用户 + 1 项目 + 5 任务），通过
`POST /api/v1/__test/seed/login` 跳过 UI 登录直接拿 JWT。

安全：
  - 仅当 `settings.environment != "production"` 时挂载（main.py 条件 include_router）
  - 即使误挂到 production，每个端点入口再做一次 environment 守卫
  - 不调 AuditService，避免污染审计测试

不暴露给 OpenAPI 公开 schema（include_in_schema=False）。
"""

from __future__ import annotations

import secrets
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core.security import create_access_token
from app.deps import get_db
from app.schemas.user import UserOut

router = APIRouter()


def _ensure_non_production() -> None:
    if settings.environment == "production":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="seed routes disabled in production",
        )


class SeedReset(BaseModel):
    admin_email: str
    annotator_email: str
    reviewer_email: str
    project_id: str
    task_ids: list[str]
    # v0.9.4 phase 3: SAM E2E 走 page.route 拦截 /interactive-annotating, 但项目侧仍需
    # 「AI 启用 + 有效 ml_backend_id 绑定」, 否则 GeneralSection / 工作台显示「未绑定」红字,
    # SAM 工具按钮直接 disabled. 这个 backend 的 url 是 mock://e2e-sam (前端不会真的请求,
    # 由 Playwright page.route 拦截). 字段返回让 spec 可声明依赖.
    ml_backend_id: str


@router.post(
    "/seed/reset",
    response_model=SeedReset,
    status_code=200,
    include_in_schema=False,
)
async def seed_reset(db: AsyncSession = Depends(get_db)) -> SeedReset:
    """重置测试数据库为固定 E2E fixture（幂等）。

    v0.8.7+ · 不再 TRUNCATE 整库，改为定向 DELETE：只清除 `@e2e.test` 用户 +
    name='E2E Demo Project' 项目（含其 task_batches/tasks/annotations/locks 等
    FK 链条）。开发者本地的 admin/pm/qa/anno 等账号 + dev 项目 / 数据集 / 标注
    完全保留。

    注：audit_logs 不删（trigger 阻止 + 用户 FK SET NULL 已无害）。
    """
    _ensure_non_production()

    from tests.factory import create_user, create_project, create_task

    import logging

    log = logging.getLogger("anno-api.seed_reset")

    # 0) 豁免 audit_logs immutability trigger：DELETE users 触发 audit_logs.actor_id
    #    ON DELETE SET NULL（隐式 UPDATE）会被 trigger 拒绝（"audit_logs rows are
    #    immutable: UPDATE operation denied"）。SET LOCAL 在外层事务中生效，所有
    #    SAVEPOINT 自动继承。
    await db.execute(text("SET LOCAL \"app.allow_audit_update\" = 'true'"))

    # 1) 找 fixture 项目 / 用户的 id
    fixture_proj_rows = (
        await db.execute(
            text(
                "SELECT id FROM projects "
                "WHERE name = 'E2E Demo Project' "
                "OR display_id LIKE 'P-E2E-%'"
            )
        )
    ).fetchall()
    fixture_project_ids = [r[0] for r in fixture_proj_rows]
    log.info("seed_reset · fixture project ids: %s", fixture_project_ids)

    fixture_user_rows = (
        await db.execute(text("SELECT id FROM users WHERE email LIKE '%@e2e.test'"))
    ).fetchall()
    fixture_user_ids = [r[0] for r in fixture_user_rows]
    log.info("seed_reset · fixture user ids: %s", fixture_user_ids)

    # 2) 按 FK 依赖顺序定向 DELETE。
    #    用 SAVEPOINT 隔离每个 DELETE：单条失败（如表不存在 / 列名漂移）不让外层
    #    事务进入 aborted 状态。asyncpg 的 InFailedSQLTransactionError 必须靠
    #    SAVEPOINT 回滚，try/except 单纯吞异常不够。让异常穿过 begin_nested 的
    #    `async with` 自动 ROLLBACK TO SAVEPOINT,外层再 catch——双 rollback 会让
    #    SA 在 __aexit__ 试图 RELEASE 已经手动 rollback 的 SP,事务进入怪状态致 500。
    async def _try_delete(sql: str, params: dict | None = None) -> None:
        try:
            async with db.begin_nested():
                await db.execute(text(sql), params or {})
        except Exception as exc:
            log.warning("seed_reset skip · %s · %s", sql.split()[2], exc)

    if fixture_project_ids:
        # 2a) 找 fixture 项目下所有 task/annotation 的 id（在 SAVEPOINT 里）
        fixture_task_ids: list = []
        fixture_annotation_ids: list = []
        async with db.begin_nested() as sp:
            try:
                fixture_task_ids = [
                    r[0]
                    for r in (
                        await db.execute(
                            text("SELECT id FROM tasks WHERE project_id = ANY(:pids)"),
                            {"pids": fixture_project_ids},
                        )
                    ).fetchall()
                ]
                fixture_annotation_ids = [
                    r[0]
                    for r in (
                        await db.execute(
                            text(
                                "SELECT id FROM annotations WHERE project_id = ANY(:pids)"
                            ),
                            {"pids": fixture_project_ids},
                        )
                    ).fetchall()
                ]
            except Exception as exc:
                log.warning("seed_reset · child id lookup failed: %s", exc)
                await sp.rollback()

        # 2b) 删 annotation_feedbacks (FK → tasks/annotations/projects 均无 ondelete,
        #     必须早于 annotations/tasks/project 删除; review-feedback-loop spec 会造此行,
        #     漏删会让后续 seed/reset 删 task 撞 FK → 级联到 project/user 删不掉 → 重建
        #     时 admin@e2e.test 撞唯一约束 → 500)。按 project_id 一刀清。
        await _try_delete(
            "DELETE FROM annotation_feedbacks WHERE project_id = ANY(:pids)",
            {"pids": fixture_project_ids},
        )

        # 删 annotation_comments → annotations → predictions / failed_predictions
        if fixture_annotation_ids:
            await _try_delete(
                "DELETE FROM annotation_comments WHERE annotation_id = ANY(:aids)",
                {"aids": fixture_annotation_ids},
            )
        await _try_delete(
            "DELETE FROM annotations WHERE project_id = ANY(:pids)",
            {"pids": fixture_project_ids},
        )
        await _try_delete(
            "DELETE FROM prediction_metas WHERE prediction_id IN "
            "(SELECT id FROM predictions WHERE project_id = ANY(:pids))",
            {"pids": fixture_project_ids},
        )
        await _try_delete(
            "DELETE FROM predictions WHERE project_id = ANY(:pids)",
            {"pids": fixture_project_ids},
        )
        await _try_delete(
            "DELETE FROM failed_predictions WHERE project_id = ANY(:pids)",
            {"pids": fixture_project_ids},
        )

        # 2c) 删 task_locks / annotation_drafts → tasks
        if fixture_task_ids:
            await _try_delete(
                "DELETE FROM task_locks WHERE task_id = ANY(:tids)",
                {"tids": fixture_task_ids},
            )
            await _try_delete(
                "DELETE FROM annotation_drafts WHERE task_id = ANY(:tids)",
                {"tids": fixture_task_ids},
            )
        await _try_delete(
            "DELETE FROM tasks WHERE project_id = ANY(:pids)",
            {"pids": fixture_project_ids},
        )

        # 2d) v0.19.0 ADR-0044 · 断开项目对全局 backend 的启用关联;
        #     project_ml_backend_pool.project_id FK ON DELETE CASCADE,删项目时也会自动清,
        #     这里显式清避免后续 mock registry 行被 CASCADE 时跨 SAVEPOINT 留尾。
        await _try_delete(
            "DELETE FROM project_ml_backend_pool WHERE project_id = ANY(:pids)",
            {"pids": fixture_project_ids},
        )

        # 2e) 删 project（CASCADE 带走 task_batches / project_members /
        #     task_events / datasets）
        await _try_delete(
            "DELETE FROM projects WHERE id = ANY(:pids)",
            {"pids": fixture_project_ids},
        )

    # reset 中创建的图像 dataset 不由 project_datasets 反向级联删除；
    # 必须在删 E2E 用户前显式清理，避免 datasets.created_by 拦住用户删除。
    await _try_delete("DELETE FROM datasets WHERE display_id LIKE 'DS-E2E-%'")

    if fixture_user_ids:
        # 删用户的反向引用，再删用户。表名 / 列名见 v0.8.7+ DB schema：
        # bug_reports.reporter_id（不是 submitter_id）；annotation_comments.author_id；
        # bug_comments.author_id；annotation_drafts.user_id；task_locks.user_id；
        # password_reset_tokens.user_id；user_invitations.invited_by；
        # organization_members.user_id（CASCADE 不在，需手删）；
        # notification_preferences / notifications 是 CASCADE，自动跟着删。
        for tbl, col in [
            ("password_reset_tokens", "user_id"),
            ("bug_comments", "author_id"),
            ("bug_reports", "reporter_id"),
            ("bug_reports", "assigned_to_id"),
            ("task_locks", "user_id"),
            ("annotation_drafts", "user_id"),
            ("annotation_comments", "author_id"),
            ("annotations", "user_id"),
            ("user_invitations", "invited_by"),
            ("organization_members", "user_id"),
        ]:
            await _try_delete(
                f"DELETE FROM {tbl} WHERE {col} = ANY(:uids)",
                {"uids": fixture_user_ids},
            )
        # 用户最后删（前面所有反向引用清干净后，仅靠 ON DELETE SET NULL FK 的字段
        # 会被 PG 自动置 NULL，无 ondelete 的字段需我们已手动删完）。
        await _try_delete("DELETE FROM users WHERE email LIKE '%@e2e.test'")

    # v0.23.3 ADR-0050 · mock registry 已有 singleton pool，且 pool 的
    # legacy_instance_id / member 都以 RESTRICT 引用 registry。先删除 mock pool
    # （member 随 pool CASCADE），再删 registry；否则第二次 reset 会留下旧 registry，
    # 重建时撞 url unique 约束。共享 pool / registry 均不受影响。
    await _try_delete(
        "DELETE FROM ml_backend_service_pools WHERE legacy_instance_id IN "
        "(SELECT id FROM ml_backend_registry "
        "WHERE url = 'http://mock-sam.e2e:9999')"
    )
    # v0.19.0 ADR-0044 · 清旧的 E2E mock registry 行(url unique 约束,
    # 重建必须先删旧)。共享注册项不删,只删本 fixture 自造的 mock url。
    await _try_delete(
        "DELETE FROM ml_backend_registry WHERE url = 'http://mock-sam.e2e:9999'"
    )

    await db.flush()

    admin = await create_user(db, "super_admin", "admin@e2e.test", "E2E Admin")
    annotator = await create_user(db, "annotator", "anno@e2e.test", "E2E Annotator")
    reviewer = await create_user(db, "reviewer", "rev@e2e.test", "E2E Reviewer")
    project = await create_project(db, owner_id=admin.id, name="E2E Demo Project")
    # Mask E2E 走兼容 polygon 提交；能力握手要求项目显式开启
    # region 工具。保留 bbox 绑定，避免改变其他工作台 E2E 的基础数据。
    bbox_binding = project.tool_bindings.get("bbox", {})
    project.tool_bindings = {
        **project.tool_bindings,
        "region": {
            "enabled": True,
            "classes": list(bbox_binding.get("classes", [])),
            "attribute_schema": {"fields": []},
        },
    }

    # v0.8.5 · 把 annotator / reviewer 加为项目成员，否则 RequireProjectMember 会
    # 在进入 /projects/:id/annotate 时 403 弹回，annotation/batch-flow spec 走不通。
    from app.db.models.project_member import ProjectMember
    from app.db.models.task_batch import TaskBatch

    db.add_all(
        [
            ProjectMember(
                project_id=project.id,
                user_id=annotator.id,
                role="annotator",
                assigned_by=admin.id,
            ),
            ProjectMember(
                project_id=project.id,
                user_id=reviewer.id,
                role="reviewer",
                assigned_by=admin.id,
            ),
        ],
    )
    # v0.8.5 · 创建一个 annotating 状态的 batch + 单值分派 annotator/reviewer，
    # 否则非特权用户在 list_tasks 中被 batch_visibility_clause 过滤为空（孤儿
    # 任务不可见），工作台显示「该项目暂无任务」。
    batch = TaskBatch(
        project_id=project.id,
        display_id="B-E2E-1",
        name="E2E Default Batch",
        status="annotating",
        annotator_id=annotator.id,
        reviewer_id=reviewer.id,
        assigned_user_ids=[str(annotator.id)],
        created_by=admin.id,
    )
    db.add(batch)
    await db.flush()

    # 原生图片 raster_mask 校验必须有真实 DatasetItem 及宽高。
    # 用固定 MinIO key 覆写一组小 SVG，避免每次 reset 制造孤儿对象。
    from app.db.models.dataset import Dataset, DatasetItem, ProjectDataset
    from app.services.storage import storage_service

    image_dataset = Dataset(
        display_id="DS-E2E-IMAGE",
        name="E2E Image Dataset",
        data_type="image",
        file_count=5,
        created_by=admin.id,
    )
    db.add(image_dataset)
    await db.flush()
    db.add(ProjectDataset(project_id=project.id, dataset_id=image_dataset.id))

    tasks = []
    for index in range(5):
        image_key = f"e2e/image/task-{index + 1}.svg"
        svg = (
            '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="48" '
            'viewBox="0 0 64 48">'
            f'<rect width="64" height="48" fill="hsl({index * 48} 30% 88%)"/>'
            '<rect x="4" y="4" width="56" height="40" rx="3" '
            'fill="none" stroke="#64748b" stroke-width="1"/>'
            f'<text x="32" y="27" text-anchor="middle" font-size="9" '
            f'fill="#334155">E2E {index + 1}</text></svg>'
        ).encode("utf-8")
        storage_service.client.put_object(
            Bucket=storage_service.datasets_bucket,
            Key=image_key,
            Body=svg,
            ContentType="image/svg+xml",
        )
        item = DatasetItem(
            dataset_id=image_dataset.id,
            file_name=f"task-{index + 1}.svg",
            file_path=image_key,
            file_type="image",
            file_size=len(svg),
            width=64,
            height=48,
        )
        db.add(item)
        await db.flush()
        t = await create_task(db, project_id=project.id)
        t.batch_id = batch.id
        t.dataset_item_id = item.id
        t.file_name = item.file_name
        t.file_path = item.file_path
        tasks.append(t)
    await db.flush()
    batch.total_tasks = len(tasks)

    # v0.9.4 phase 3: SAM E2E 用 mock ml_backend (url 不会被真请求, page.route 拦截)
    # v0.19.0 ADR-0044 · 建全局注册项 + 为本项目启用关联。
    # v0.23.3 ADR-0050 · 同时建 singleton 服务池, 项目主绑定存 pool id。
    from app.db.models.ml_backend_pool import (
        MLBackendPoolMember,
        MLBackendServicePool,
    )
    from app.db.models.ml_backend_registry import (
        MLBackendRegistry,
        ProjectMLBackendPool,
    )

    mock_backend = MLBackendRegistry(
        name="E2E SAM Mock",
        url="http://mock-sam.e2e:9999",
        state="connected",
        is_interactive=True,
        auth_method="none",
        extra_params={"e2e_mock": True},
        source="manual",
    )
    db.add(mock_backend)
    await db.flush()
    # singleton pool: legacy_instance_id 指向 mock_backend; enabled 跟随项目启用。
    mock_pool = MLBackendServicePool(
        name=mock_backend.name,
        enabled=True,
        routing_policy="smooth_weighted_round_robin",
        legacy_instance_id=mock_backend.id,
        routing_generation=1,
    )
    db.add(mock_pool)
    await db.flush()
    db.add(
        MLBackendPoolMember(
            pool_id=mock_pool.id,
            registry_id=mock_backend.id,
            traffic_state="active",
            weight=1,
        )
    )
    db.add(
        ProjectMLBackendPool(
            project_id=project.id,
            pool_id=mock_pool.id,
            enabled=True,
        )
    )
    await db.flush()
    project.ai_enabled = True
    project.ml_backend_pool_id = mock_pool.id
    await db.commit()

    return SeedReset(
        admin_email=admin.email,
        annotator_email=annotator.email,
        reviewer_email=reviewer.email,
        project_id=str(project.id),
        task_ids=[str(t.id) for t in tasks],
        ml_backend_id=str(mock_backend.id),
    )


class SeedLidar(BaseModel):
    """v0.16.x · 点云 E2E 基线 fixture（拆 3D 整簇前的 Playwright 守护网用)。

    造 1 个 lidar 项目 + 2 帧(同一 .pcd)point_cloud task。最小版:走 manifest 的
    task.file_path 回退路径(无 DatasetItem link / 无相机 / 无 scene),足够冒烟
    (headless 加载点云 + 渲染 + 零 console error)与多数交互断言(选/改/gizmo/点掩膜)。
    相机投影面板 + 跨帧 scene 待后续按 P2 需要补 link 图。
    """

    lidar_project_id: str
    lidar_task_ids: list[str]


def _make_test_pcd_bytes(n_side: int = 8) -> bytes:
    """生成一个 n_side³ 的小立方体点阵 ASCII PCD(512 点,够 PCDLoader 加载 + 渲染)。"""
    pts: list[tuple[float, float, float]] = []
    span = max(n_side - 1, 1)
    for i in range(n_side):
        for j in range(n_side):
            for k in range(n_side):
                pts.append(
                    (
                        -2.0 + 4.0 * i / span,
                        -2.0 + 4.0 * j / span,
                        4.0 * k / span,
                    )
                )
    n = len(pts)
    header = (
        "# .PCD v0.7 - Point Cloud Data file format\n"
        "VERSION 0.7\n"
        "FIELDS x y z\n"
        "SIZE 4 4 4\n"
        "TYPE F F F\n"
        "COUNT 1 1 1\n"
        f"WIDTH {n}\n"
        "HEIGHT 1\n"
        "VIEWPOINT 0 0 0 1 0 0 0\n"
        f"POINTS {n}\n"
        "DATA ascii\n"
    )
    body = "".join(f"{x:.4f} {y:.4f} {z:.4f}\n" for x, y, z in pts)
    return (header + body).encode("utf-8")


@router.post(
    "/seed/lidar",
    response_model=SeedLidar,
    status_code=200,
    include_in_schema=False,
)
async def seed_lidar(db: AsyncSession = Depends(get_db)) -> SeedLidar:
    """造点云 E2E fixture(幂等)。需先调 /seed/reset(复用其 E2E 用户),缺则补建。"""
    _ensure_non_production()

    from sqlalchemy import select

    from app.db.models.annotation import Annotation
    from app.db.models.project import Project
    from app.db.models.project_member import ProjectMember
    from app.db.models.task import Task
    from app.db.models.task_batch import TaskBatch
    from app.db.models.user import User
    from app.services.storage import storage_service
    from tests.factory import create_user

    await db.execute(text("SET LOCAL \"app.allow_audit_update\" = 'true'"))

    async def _try_delete(sql: str, params: dict | None = None) -> None:
        async with db.begin_nested() as sp:
            try:
                await db.execute(text(sql), params or {})
            except Exception:
                await sp.rollback()

    # 复用 reset 造的 E2E 用户;缺则补建(令 /seed/lidar 可独立调用)。
    async def _user(role: str, email: str, name: str) -> User:
        existing = (
            await db.execute(select(User).where(User.email == email))
        ).scalar_one_or_none()
        return existing or await create_user(db, role, email, name)

    admin = await _user("super_admin", "admin@e2e.test", "E2E Admin")
    annotator = await _user("annotator", "anno@e2e.test", "E2E Annotator")

    # 幂等:删旧 lidar fixture(name='E2E Lidar Project',含 task/annotation/锁/草稿链)。
    old_pids = [
        r[0]
        for r in (
            await db.execute(
                text("SELECT id FROM projects WHERE name = 'E2E Lidar Project'")
            )
        ).fetchall()
    ]
    if old_pids:
        old_tids = [
            r[0]
            for r in (
                await db.execute(
                    text("SELECT id FROM tasks WHERE project_id = ANY(:pids)"),
                    {"pids": old_pids},
                )
            ).fetchall()
        ]
        await _try_delete(
            "DELETE FROM annotations WHERE project_id = ANY(:pids)", {"pids": old_pids}
        )
        if old_tids:
            await _try_delete(
                "DELETE FROM task_locks WHERE task_id = ANY(:tids)", {"tids": old_tids}
            )
            await _try_delete(
                "DELETE FROM annotation_drafts WHERE task_id = ANY(:tids)",
                {"tids": old_tids},
            )
        await _try_delete(
            "DELETE FROM tasks WHERE project_id = ANY(:pids)", {"pids": old_pids}
        )
        # 删 project 级联带走 task_batches / project_members。
        await _try_delete(
            "DELETE FROM projects WHERE id = ANY(:pids)", {"pids": old_pids}
        )
    await db.flush()

    # 上传测试点云到 datasets_bucket(presign GET 才能 200,前端 loadPcd 才成功)。
    suffix = secrets.token_hex(3)
    pcd_key = f"e2e/lidar/{suffix}.pcd"
    storage_service.client.put_object(
        Bucket=storage_service.datasets_bucket,
        Key=pcd_key,
        Body=_make_test_pcd_bytes(),
    )

    # 建 lidar 项目(data_type 默认 image,必须显式 lidar;manifest 据此放行点云端点)。
    # tool_bindings 必须把类别落在 lidar_box_3d unit(前端 LIDAR_TOOL_UNIT 据此取 boxClasses /
    # 校验 PATCH);coalesce 会误落 bbox unit,故此处显式构造。
    tool_bindings = {
        "lidar_box_3d": {
            "classes": [{"name": "car", "order": 0}],
            "enabled": True,
            "attribute_schema": {"fields": []},
        },
        # point_mask_3d unit 带类别 → 前端 pointMaskPlaceClass 非空,point-mask 工具可用
        # (供 usePointMask 拆分的 polygon 护栏 spec)。
        "point_mask_3d": {
            "classes": [{"name": "ground", "order": 0}],
            "enabled": True,
            "attribute_schema": {"fields": []},
        },
    }
    project = Project(
        display_id=f"P-E2E-LIDAR-{suffix}",
        name="E2E Lidar Project",
        type_label="点云标注",
        type_key="lidar",
        data_type="lidar",
        owner_id=admin.id,
        tool_bindings=tool_bindings,
        ai_enabled=False,
    )
    db.add(project)
    await db.flush()

    db.add(
        ProjectMember(
            project_id=project.id,
            user_id=annotator.id,
            role="annotator",
            assigned_by=admin.id,
        )
    )
    batch = TaskBatch(
        project_id=project.id,
        display_id=f"B-E2E-LIDAR-{suffix}",
        name="E2E Lidar Batch",
        status="annotating",
        annotator_id=annotator.id,
        assigned_user_ids=[str(annotator.id)],
        created_by=admin.id,
    )
    db.add(batch)
    await db.flush()

    tasks = []
    for idx in range(2):
        t = Task(
            display_id=f"T-E2E-LIDAR-{suffix}-{idx}",
            project_id=project.id,
            status="pending",
            file_name=f"e2e-lidar-{suffix}-{idx}.pcd",
            file_path=pcd_key,
            file_type="point_cloud",
            batch_id=batch.id,
        )
        db.add(t)
        tasks.append(t)
    await db.flush()
    batch.total_tasks = len(tasks)

    # 每帧注入 1 个 box_3d 标注(落在点阵范围内),供 P2 选中 / 改 PSR / gizmo 断言。
    # 几何 = ISO 8855 系;center/size 单位 m,rotation 单位 rad(roll,pitch,yaw)。
    for t in tasks:
        db.add(
            Annotation(
                task_id=t.id,
                project_id=project.id,
                user_id=annotator.id,
                source="manual",
                annotation_type="box_3d",
                tool_unit_id="lidar_box_3d",
                class_name="car",
                geometry={
                    "type": "box_3d",
                    "center": [1.0, 0.0, 1.0],
                    "size": [4.0, 2.0, 1.5],
                    "rotation": [0.0, 0.0, 0.0],
                    "convention_at_create": "iso_8855",
                },
            )
        )
    await db.flush()
    await db.commit()

    return SeedLidar(
        lidar_project_id=str(project.id),
        lidar_task_ids=[str(t.id) for t in tasks],
    )


class SeedLoginRequest(BaseModel):
    email: str


class SeedLoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


@router.post(
    "/seed/login",
    response_model=SeedLoginResponse,
    include_in_schema=False,
)
async def seed_login(
    payload: SeedLoginRequest,
    db: AsyncSession = Depends(get_db),
) -> SeedLoginResponse:
    """跳过密码验证发 JWT（仅 E2E 测试用）。"""
    _ensure_non_production()

    from sqlalchemy import select
    from app.db.models.user import User

    res = await db.execute(select(User).where(User.email == payload.email))
    user = res.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail=f"user {payload.email} not found")

    token = create_access_token(subject=str(user.id), role=user.role)
    return SeedLoginResponse(
        access_token=token,
        user=UserOut.model_validate(user),
    )


class SeedPeekResponse(BaseModel):
    """v0.8.7 F4 · 截图自动化只读窥探：返回首个 super_admin 用户 + 首个项目 + 首个任务。

    与 `seed/reset` 不同，本端点**不修改任何数据**，仅查询 LIMIT 1 → 让
    `pnpm screenshots` 在开发者本地真实数据上跑，不破坏现有数据集 / 项目。
    任意字段可为 None（对应记录不存在时），调用方需自行处理缺失场景。
    """

    admin_email: str | None = None
    project_id: str | None = None
    task_id: str | None = None


@router.get(
    "/seed/catalog",
    include_in_schema=False,
)
async def seed_catalog(
    profile: Literal["screenshots"] = "screenshots",
    db: AsyncSession = Depends(get_db),
) -> dict:
    """解析 screenshots profile 的稳定逻辑键；数据漂移时明确失败。"""
    _ensure_non_production()

    from app.services.screenshot_seed_catalog import (
        ScreenshotSeedCatalogError,
        build_screenshot_seed_catalog,
    )

    try:
        return await build_screenshot_seed_catalog(db)
    except ScreenshotSeedCatalogError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "screenshot_seed_not_ready",
                "issues": exc.issues,
            },
        ) from exc


@router.get(
    "/seed/peek",
    response_model=SeedPeekResponse,
    include_in_schema=False,
)
async def seed_peek(db: AsyncSession = Depends(get_db)) -> SeedPeekResponse:
    """只读窥探现有数据，给截图自动化用（不破坏开发数据）。"""
    _ensure_non_production()

    from sqlalchemy import select
    from app.db.models.project import Project
    from app.db.models.task import Task
    from app.db.models.user import User

    # 优先选「不像 E2E fixture」的 admin（@e2e.test 邮箱排到末尾），让截图脚本
    # 优先用开发者真实账号（如 seed.py 的 admin）。
    admin = (
        await db.execute(
            select(User)
            .where(User.role == "super_admin")
            .order_by(User.email.like("%@e2e.test").asc(), User.created_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    # 项目 / 任务同样按 created_at desc，优先最新（开发者刚操作过的）。
    project = (
        await db.execute(select(Project).order_by(Project.created_at.desc()).limit(1))
    ).scalar_one_or_none()
    task = (
        await db.execute(select(Task).order_by(Task.created_at.desc()).limit(1))
    ).scalar_one_or_none()

    return SeedPeekResponse(
        admin_email=admin.email if admin else None,
        project_id=str(project.id) if project else None,
        task_id=str(task.id) if task else None,
    )


class InjectPredictionRequest(BaseModel):
    """v0.10.10 · I11 e2e 辅助：直接 INSERT 一条 polygon prediction，
    绕过 ml-backend 让 mask 编辑器「AI prediction 精修」入口可测。"""

    task_id: str
    project_id: str
    label: str
    polygon: list[list[float]]  # 归一化 [0,1] points
    score: float = 0.9


class InjectPredictionResponse(BaseModel):
    prediction_id: str


@router.post(
    "/seed/inject-prediction",
    response_model=InjectPredictionResponse,
    include_in_schema=False,
)
async def seed_inject_prediction(
    payload: InjectPredictionRequest,
    db: AsyncSession = Depends(get_db),
) -> InjectPredictionResponse:
    """直插一条 polygonlabels 类型的 prediction。"""
    _ensure_non_production()

    from uuid import UUID
    from app.db.models.prediction import Prediction

    # DB 存 LabelStudio 标准 list[shape]，read 路径会走 to_internal_shape 转内部 schema。
    result = [
        {
            "type": "polygonlabels",
            "value": {
                "points": payload.polygon,
                "polygonlabels": [payload.label],
            },
            "score": payload.score,
        }
    ]
    pred = Prediction(
        task_id=UUID(payload.task_id),
        project_id=UUID(payload.project_id),
        score=payload.score,
        result=result,
    )
    db.add(pred)
    await db.flush()
    pred_id = str(pred.id)
    await db.commit()
    return InjectPredictionResponse(prediction_id=pred_id)


class ConfigureRasterMaskRequest(BaseModel):
    project_id: str
    enabled: bool


class ConfigureRasterMaskResponse(BaseModel):
    project_id: str
    enabled: bool


@router.post(
    "/seed/configure-raster-mask",
    response_model=ConfigureRasterMaskResponse,
    include_in_schema=False,
)
async def seed_configure_raster_mask(
    payload: ConfigureRasterMaskRequest,
    db: AsyncSession = Depends(get_db),
) -> ConfigureRasterMaskResponse:
    """切换 E2E 项目的原生 Mask opt-in。

    部署级 read/create 总闸仍由当前 API 进程的环境变量决定，
    本辅助端点只改项目级灰度开关。
    """
    _ensure_non_production()

    from uuid import UUID

    from app.db.models.project import Project

    project = await db.get(Project, UUID(payload.project_id))
    if project is None:
        raise HTTPException(status_code=404, detail="project not found")
    project.raster_mask_native_editing_enabled = payload.enabled
    await db.commit()
    return ConfigureRasterMaskResponse(
        project_id=str(project.id),
        enabled=project.raster_mask_native_editing_enabled,
    )


class SeedVideoTaskRequest(BaseModel):
    project_id: str


class SeedVideoTaskResponse(BaseModel):
    task_id: str


@router.post(
    "/seed/video-task",
    response_model=SeedVideoTaskResponse,
    include_in_schema=False,
)
async def seed_video_task(
    payload: SeedVideoTaskRequest,
    db: AsyncSession = Depends(get_db),
) -> SeedVideoTaskResponse:
    """Add one deterministic video task to the reset fixture for workbench E2E."""
    _ensure_non_production()

    from pathlib import Path
    from uuid import UUID

    from sqlalchemy import select

    from app.db.models.dataset import DatasetItem
    from app.db.models.task import Task
    from app.db.models.task_batch import TaskBatch
    from app.services.storage import storage_service

    project_id = UUID(payload.project_id)
    image_task = (
        await db.execute(
            select(Task)
            .where(Task.project_id == project_id, Task.dataset_item_id.is_not(None))
            .order_by(Task.created_at)
        )
    ).scalars().first()
    batch = (
        await db.execute(
            select(TaskBatch)
            .where(TaskBatch.project_id == project_id)
            .order_by(TaskBatch.created_at)
        )
    ).scalars().first()
    if image_task is None or batch is None:
        raise HTTPException(status_code=404, detail="project fixture not found")
    image_item = await db.get(DatasetItem, image_task.dataset_item_id)
    if image_item is None:
        raise HTTPException(status_code=404, detail="dataset fixture not found")

    source_path = (
        Path(__file__).resolve().parents[5]
        / "docs-site/public/home/sam-tools/smart-point.webm"
    )
    video = source_path.read_bytes()
    video_key = "e2e/video/native-mask.webm"
    storage_service.client.put_object(
        Bucket=storage_service.datasets_bucket,
        Key=video_key,
        Body=video,
        ContentType="video/webm",
    )
    item = DatasetItem(
        dataset_id=image_item.dataset_id,
        file_name="native-mask.webm",
        file_path=video_key,
        file_type="video",
        file_size=len(video),
        width=1440,
        height=810,
        metadata_={
            "video": {
                "duration_ms": 5000,
                "fps": 12,
                "frame_count": 60,
                "width": 1440,
                "height": 810,
                "codec": "vp9",
            }
        },
    )
    db.add(item)
    await db.flush()
    task = Task(
        project_id=project_id,
        batch_id=batch.id,
        dataset_item_id=item.id,
        display_id=f"T-E2E-VIDEO-{secrets.token_hex(3)}",
        file_name=item.file_name,
        file_path=item.file_path,
        file_type="video",
        status="pending",
    )
    db.add(task)
    batch.total_tasks = int(batch.total_tasks or 0) + 1
    await db.flush()
    task_id = str(task.id)
    await db.commit()
    return SeedVideoTaskResponse(task_id=task_id)


class SeedNativeMaskPromptSource(BaseModel):
    annotation_id: str
    source_version: int
    source_digest: str


class SeedNativeMaskCandidateRequest(BaseModel):
    task_id: str
    variant: Literal["default", "negative_scribble"] = "default"
    prompt_family: Literal["point", "scribble"] = "point"
    negative_scribbles: int = 0
    prompt_source: SeedNativeMaskPromptSource | None = None


class SeedNativeMaskCandidateResponse(BaseModel):
    response: dict
    rle: dict


@router.post(
    "/seed/native-mask-candidate",
    response_model=SeedNativeMaskCandidateResponse,
    include_in_schema=False,
)
async def seed_native_mask_candidate(
    payload: SeedNativeMaskCandidateRequest,
    db: AsyncSession = Depends(get_db),
) -> SeedNativeMaskCandidateResponse:
    """Issue a real signed receipt for a deterministic transient Mask candidate."""
    _ensure_non_production()

    import hashlib
    from uuid import UUID

    from aap_protocol_v2 import (
        CocoRlePayload,
        canonical_rle_bytes,
        native_mask_candidate_id,
    )

    from app.db.models.dataset import DatasetItem
    from app.db.models.ml_backend_pool import MLBackendServicePool
    from app.db.models.project import Project
    from app.db.models.task import Task
    from app.services.ai_mask_receipt import issue_ai_mask_receipt

    task = await db.get(Task, UUID(payload.task_id))
    if task is None or task.dataset_item_id is None:
        raise HTTPException(status_code=404, detail="task fixture not found")
    item = await db.get(DatasetItem, task.dataset_item_id)
    project = await db.get(Project, task.project_id)
    if item is None or project is None or item.width is None or item.height is None:
        raise HTTPException(status_code=404, detail="media fixture not found")
    if project.ml_backend_pool_id is None:
        raise HTTPException(status_code=404, detail="backend pool fixture not found")
    pool = await db.get(MLBackendServicePool, project.ml_backend_pool_id)
    if pool is None or pool.legacy_instance_id is None:
        raise HTTPException(status_code=404, detail="backend fixture not found")

    total = int(item.width) * int(item.height)
    foreground_start = total // 4
    foreground_length = max(
        1,
        total // 4 if payload.variant == "negative_scribble" else total // 3,
    )
    rle_model = CocoRlePayload(
        encoding="coco_rle",
        size=(int(item.height), int(item.width)),
        counts=(
            foreground_start,
            foreground_length,
            total - foreground_start - foreground_length,
        ),
    )
    rle = rle_model.model_dump(mode="json")
    prompt_revision = (
        f"e2e-native-mask:{task.id}:{payload.variant}:{payload.prompt_family}"
    )
    candidate_id = native_mask_candidate_id(
        rle_model,
        prompt_revision=prompt_revision,
        candidate_index=0,
    )
    routing = {
        "requested_backend_id": str(pool.legacy_instance_id),
        "backend_pool_id": str(pool.id),
        "backend_instance_id": str(pool.legacy_instance_id),
        "model_id": "e2e-native-mask",
    }
    inference = {
        "model_version": "e2e-native-mask",
        "inference_time_ms": 7.0,
        "cache_hit": False,
        "model_load_ms": 0.0,
    }
    # E2E 的视频任务复用图片项目，必须按实际媒体而不是 project.data_type 绑定 receipt。
    frame_index = 0 if item.file_type == "video" else None
    prompt_summary = {
        "family": payload.prompt_family,
        "positive_points": 1 if payload.prompt_family == "point" else 0,
        "negative_points": 0,
        "boxes": 0,
        "positive_scribbles": 0,
        "negative_scribbles": payload.negative_scribbles,
        "multimask": payload.prompt_family == "point",
        "parameters_digest": None,
    }
    content_digest = hashlib.sha256(canonical_rle_bytes(rle_model)).hexdigest()
    prompt_source = (
        {
            "source_annotation_id": payload.prompt_source.annotation_id,
            "source_version": payload.prompt_source.source_version,
            "source_digest": payload.prompt_source.source_digest,
        }
        if payload.prompt_source is not None
        else None
    )
    accept_target = {
        "mode": "refine" if prompt_source is not None else "create",
        "source_annotation_id": (
            prompt_source["source_annotation_id"] if prompt_source else None
        ),
        "source_version": prompt_source["source_version"] if prompt_source else None,
        "frame_index": frame_index,
    }
    receipt = issue_ai_mask_receipt(
        {
            "task_id": str(task.id),
            "frame_index": frame_index,
            "candidate_id": candidate_id,
            "candidate_index": 0,
            "content_digest": content_digest,
            "prompt_revision": prompt_revision,
            "score": 0.95,
            "routing": routing,
            "inference": inference,
            "prompt_summary": prompt_summary,
            "prompt_source": prompt_source,
            "accept_target": accept_target,
        }
    )
    response = {
        "result": [
            {
                "type": "mask",
                "value": {"rle": rle, "masklabels": ["object"]},
                "score": 0.95,
                "candidate_id": candidate_id,
            }
        ],
        "score": 0.95,
        "model_version": inference["model_version"],
        "inference_time_ms": inference["inference_time_ms"],
        "cache_hit": inference["cache_hit"],
        "model_load_ms": inference["model_load_ms"],
        "mask_input_next": None,
        "diagnostic": None,
        "prompt_revision": prompt_revision,
        "output_geometry": "mask",
        "frame_index": frame_index,
        "routing": routing,
        "prompt_summary": prompt_summary,
        "accept_receipts": {candidate_id: receipt},
    }
    return SeedNativeMaskCandidateResponse(response=response, rle=rle)


RasterMaskFixtureVariant = Literal["single", "donut_three", "corrupt"]


class InjectRasterMaskRequest(BaseModel):
    task_id: str
    user_email: str
    variant: RasterMaskFixtureVariant = "single"
    label: str = "car"
    locked: bool = False


class InjectRasterMaskResponse(BaseModel):
    annotation_id: str
    variant: RasterMaskFixtureVariant
    mask: dict


class InjectRasterPredictionResponse(BaseModel):
    prediction_id: str
    mask: dict


def _make_test_raster_mask(variant: RasterMaskFixtureVariant) -> list[int]:
    """生成 64×48 row-major fixture；donut_three = 3 个分量 + 1 个孔洞。"""
    width, height = 64, 48
    pixels = [0] * (width * height)

    def _rect(x0: int, y0: int, x1: int, y1: int, value: int = 1) -> None:
        for y in range(y0, y1):
            offset = y * width
            for x in range(x0, x1):
                pixels[offset + x] = value

    if variant == "single":
        _rect(12, 10, 43, 34)
    elif variant == "donut_three":
        _rect(3, 3, 21, 21)
        _rect(8, 8, 16, 16, 0)
        _rect(29, 5, 41, 18)
        _rect(46, 29, 60, 43)
    else:
        # 损坏 fixture 使用独立形状，并故意不存对象。
        _rect(6, 30, 18, 42)
    return pixels


@router.post(
    "/seed/inject-raster-mask",
    response_model=InjectRasterMaskResponse,
    include_in_schema=False,
)
async def seed_inject_raster_mask(
    payload: InjectRasterMaskRequest,
    db: AsyncSession = Depends(get_db),
) -> InjectRasterMaskResponse:
    """直插原生 raster annotation，用于 reader / corrupt / lock E2E。

    端点只在非生产环境挂载，刻意绕过 create gate，以便在
    ``read=true/create=false`` 矩阵中构造“已有内容可读”的真实基线。
    """
    _ensure_non_production()

    from uuid import UUID

    from sqlalchemy import select

    from app.db.models.annotation import Annotation
    from app.db.models.task import Task
    from app.db.models.user import User
    from app.services.raster_mask_storage import (
        build_rle_reference,
        rle_object_key,
        store_coco_rle,
    )
    from app.utils.raster_mask_rle import encode_coco_rle

    task = await db.get(Task, UUID(payload.task_id))
    user = (
        await db.execute(select(User).where(User.email == payload.user_email))
    ).scalar_one_or_none()
    if task is None or user is None:
        raise HTTPException(status_code=404, detail="task or user not found")

    rle = encode_coco_rle(_make_test_raster_mask(payload.variant), 64, 48)
    if payload.variant == "corrupt":
        reference = build_rle_reference(rle)
        missing_digest = secrets.token_hex(32)
        reference = {
            **reference,
            "sha256": missing_digest,
            "object_key": rle_object_key(missing_digest),
        }
    else:
        reference = await store_coco_rle(rle)

    annotation = Annotation(
        task_id=task.id,
        project_id=task.project_id,
        user_id=user.id,
        source="manual",
        annotation_type="raster_mask",
        tool_unit_id="region",
        class_name=payload.label,
        geometry={"type": "raster_mask", "mask": reference},
        confidence=1,
        is_locked=payload.locked,
    )
    db.add(annotation)
    task.total_annotations = int(task.total_annotations or 0) + 1
    await db.flush()
    annotation_id = str(annotation.id)
    await db.commit()
    return InjectRasterMaskResponse(
        annotation_id=annotation_id,
        variant=payload.variant,
        mask=reference,
    )


@router.post(
    "/seed/inject-raster-prediction",
    response_model=InjectRasterPredictionResponse,
    include_in_schema=False,
)
async def seed_inject_raster_prediction(
    payload: InjectRasterMaskRequest,
    db: AsyncSession = Depends(get_db),
) -> InjectRasterPredictionResponse:
    """构造待接受的 raster prediction，用于验证 accept write gate。"""
    _ensure_non_production()

    from uuid import UUID

    from app.db.models.prediction import Prediction
    from app.db.models.task import Task
    from app.services.raster_mask_storage import store_coco_rle
    from app.utils.raster_mask_rle import encode_coco_rle

    task = await db.get(Task, UUID(payload.task_id))
    if task is None:
        raise HTTPException(status_code=404, detail="task not found")
    rle = encode_coco_rle(_make_test_raster_mask("single"), 64, 48)
    reference = await store_coco_rle(rle)
    prediction = Prediction(
        task_id=task.id,
        project_id=task.project_id,
        tool_unit_id="region",
        score=0.9,
        source="ml_backend",
        result=[
            {
                "type": "raster_mask",
                "tool_unit_id": "region",
                "class_name": payload.label,
                "geometry": {"type": "raster_mask", "mask": reference},
                "confidence": 0.9,
            }
        ],
    )
    db.add(prediction)
    await db.flush()
    prediction_id = str(prediction.id)
    await db.commit()
    return InjectRasterPredictionResponse(
        prediction_id=prediction_id,
        mask=reference,
    )


class AdvanceTaskRequest(BaseModel):
    """v0.8.5 · E2E 辅助：直接把 task 推到目标状态，绕过 UI 链路。

    主要服务于 batch-flow.spec 的多角色串联（避免每个 spec 都重复画 bbox）。
    """

    task_id: str
    to_status: str  # pending | annotating | submitted | review | completed | rejected
    annotator_email: str | None = None
    reviewer_email: str | None = None


class AdvanceTaskResponse(BaseModel):
    task_id: str
    status: str


@router.post(
    "/seed/advance_task",
    response_model=AdvanceTaskResponse,
    include_in_schema=False,
)
async def seed_advance_task(
    payload: AdvanceTaskRequest,
    db: AsyncSession = Depends(get_db),
) -> AdvanceTaskResponse:
    """绕过状态机直接置 task 到目标状态。E2E 写实化用，不调审计。"""
    _ensure_non_production()

    from datetime import datetime, timezone
    from uuid import UUID
    from sqlalchemy import select
    from app.db.models.task import Task
    from app.db.models.user import User

    res = await db.execute(select(Task).where(Task.id == UUID(payload.task_id)))
    task = res.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail=f"task {payload.task_id} not found")

    now = datetime.now(timezone.utc)
    task.status = payload.to_status

    if payload.annotator_email:
        anno_res = await db.execute(
            select(User).where(User.email == payload.annotator_email)
        )
        anno = anno_res.scalar_one_or_none()
        if anno:
            task.assignee_id = anno.id
            task.assigned_at = task.assigned_at or now
    if payload.reviewer_email:
        rev_res = await db.execute(
            select(User).where(User.email == payload.reviewer_email)
        )
        rev = rev_res.scalar_one_or_none()
        if rev:
            task.reviewer_id = rev.id
            task.reviewer_claimed_at = task.reviewer_claimed_at or now

    if payload.to_status == "submitted":
        task.submitted_at = task.submitted_at or now
        task.is_labeled = True
    elif payload.to_status in ("completed", "rejected"):
        task.reviewed_at = now

    await db.commit()
    return AdvanceTaskResponse(task_id=str(task.id), status=task.status)
