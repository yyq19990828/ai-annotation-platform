"""v0.15.3 · workbench 偏好四子树。

覆盖三块：
1. PATCH /auth/me/preferences 子树合并（只动提交字段，其余回默认值）
2. legacy 平铺键提升器（旧 tab 兼容,v0.16 移除）：旧键提升 / 新旧同现以新为准 / 未知键仍 422
3. 0103 迁移 SQL：旧平铺 JSONB → 子树形态、幂等、down 还原（直接对测试库执行迁移模块
   暴露的 UP_BATCH_SQL / DOWN_BATCH_SQL，验证的就是迁移真实跑的那份 SQL）
"""

import copy
import importlib.util
from pathlib import Path

import sqlalchemy as sa

from app.schemas.user import UserPreferences

PREFS_URL = "/api/v1/auth/me/preferences"


def _bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


# ── 1. PATCH 子树合并 ────────────────────────────────────────────────


async def test_patch_image_subtree_only_touches_submitted_field(
    httpx_client, annotator
):
    _, token = annotator
    resp = await httpx_client.patch(
        PREFS_URL,
        json={"workbench": {"image": {"controlPointsSize": 10}}},
        headers=_bearer(token),
    )
    assert resp.status_code == 200
    wb = resp.json()["workbench"]
    assert wb["image"]["controlPointsSize"] == 10
    # 其余字段保持默认值（回归红线：默认值 = 拆分前现状值）
    assert wb["image"]["smoothImage"] is True
    assert wb["image"]["cssImageFilter"] == ""
    assert wb["image"]["snapToGrid"] is False
    assert wb["image"]["afterBoxCreate"] == "pick_class"
    assert wb["image"]["snapThresholdPx"] == 8
    assert wb["image"]["zoomStepFactor"] == 1.1
    assert wb["image"]["fadedOpacity"] == 0.35
    assert wb["image"]["showBoxLabels"] is True
    assert wb["image"]["maskOverlayOpacity"] == 0.45
    assert wb["common"]["longTaskSampleRate"] == 0.05
    assert wb["common"]["confirmDelete"] == "never"
    assert wb["common"]["recentClassesLimit"] == 5

    # GET 读回同形态
    resp = await httpx_client.get(PREFS_URL, headers=_bearer(token))
    assert resp.status_code == 200
    assert resp.json()["workbench"]["image"]["controlPointsSize"] == 10


# ── 2. legacy 平铺键提升器 ───────────────────────────────────────────


async def test_patch_legacy_flat_keys_promoted_to_subtrees(httpx_client, annotator):
    _, token = annotator
    resp = await httpx_client.patch(
        PREFS_URL,
        json={
            "workbench": {
                "smoothImage": False,
                "snapToGrid": True,
                "longTaskSampleRate": 0.5,
            }
        },
        headers=_bearer(token),
    )
    assert resp.status_code == 200
    wb = resp.json()["workbench"]
    assert wb["image"]["smoothImage"] is False
    assert wb["image"]["snapToGrid"] is True
    assert wb["common"]["longTaskSampleRate"] == 0.5


async def test_patch_legacy_and_new_keys_new_subtree_wins(httpx_client, annotator):
    _, token = annotator
    resp = await httpx_client.patch(
        PREFS_URL,
        json={
            "workbench": {
                "controlPointsSize": 4,
                "image": {"controlPointsSize": 12},
            }
        },
        headers=_bearer(token),
    )
    assert resp.status_code == 200
    assert resp.json()["workbench"]["image"]["controlPointsSize"] == 12


async def test_patch_unknown_keys_still_422(httpx_client, annotator):
    _, token = annotator
    # 子树内未知键
    resp = await httpx_client.patch(
        PREFS_URL,
        json={"workbench": {"image": {"bogusKey": 1}}},
        headers=_bearer(token),
    )
    assert resp.status_code == 422
    # workbench 顶层未知键（提升器只认 5 个已知旧键，不放松 forbid）
    resp = await httpx_client.patch(
        PREFS_URL,
        json={"workbench": {"bogusFlat": True}},
        headers=_bearer(token),
    )
    assert resp.status_code == 422
    # 提升后的值仍走 pydantic 约束（越界 422）
    resp = await httpx_client.patch(
        PREFS_URL,
        json={"workbench": {"controlPointsSize": 99}},
        headers=_bearer(token),
    )
    assert resp.status_code == 422


# ── 3. v0.15.4 图片子树 + common 首批 ────────────────────────────────


async def test_patch_image_workbench_settings_fields(httpx_client, annotator):
    _, token = annotator
    resp = await httpx_client.patch(
        PREFS_URL,
        json={
            "workbench": {
                "common": {
                    "confirmDelete": "multi_only",
                    "recentClassesLimit": 12,
                },
                "image": {
                    "afterBoxCreate": "reuse_active",
                    "snapThresholdPx": 12,
                    "zoomStepFactor": 1.15,
                    "fadedOpacity": 0.5,
                    "showBoxLabels": False,
                    "maskOverlayOpacity": 0.6,
                },
            }
        },
        headers=_bearer(token),
    )
    assert resp.status_code == 200
    wb = resp.json()["workbench"]
    assert wb["common"]["confirmDelete"] == "multi_only"
    assert wb["common"]["recentClassesLimit"] == 12
    assert wb["image"]["afterBoxCreate"] == "reuse_active"
    assert wb["image"]["snapThresholdPx"] == 12
    assert wb["image"]["zoomStepFactor"] == 1.15
    assert wb["image"]["fadedOpacity"] == 0.5
    assert wb["image"]["showBoxLabels"] is False
    assert wb["image"]["maskOverlayOpacity"] == 0.6
    # 未提交字段保持默认值。
    assert wb["image"]["smoothImage"] is True
    assert wb["common"]["longTaskSampleRate"] == 0.05


async def test_patch_image_workbench_range_and_enum_violations_422(
    httpx_client, annotator
):
    _, token = annotator
    for bad_subtree in (
        {"common": {"confirmDelete": "single_only"}},
        {"common": {"recentClassesLimit": 2}},
        {"common": {"recentClassesLimit": 21}},
        {"image": {"afterBoxCreate": "silent"}},
        {"image": {"snapThresholdPx": 3}},
        {"image": {"snapThresholdPx": 17}},
        {"image": {"zoomStepFactor": 1.07}},
        {"image": {"fadedOpacity": 0.05}},
        {"image": {"fadedOpacity": 0.9}},
        {"image": {"maskOverlayOpacity": 0.1}},
        {"image": {"maskOverlayOpacity": 0.9}},
    ):
        resp = await httpx_client.patch(
            PREFS_URL,
            json={"workbench": bad_subtree},
            headers=_bearer(token),
        )
        assert resp.status_code == 422, bad_subtree


# ── 4. v0.15.5 视频子树 ───────────────────────────────────────────────


async def test_patch_video_subtree_fields(httpx_client, annotator):
    _, token = annotator
    resp = await httpx_client.patch(
        PREFS_URL,
        json={
            "workbench": {
                "video": {
                    "defaultPlaybackRate": 0.5,
                    "largeFrameStep": "grid",
                }
            }
        },
        headers=_bearer(token),
    )
    assert resp.status_code == 200
    video = resp.json()["workbench"]["video"]
    assert video["defaultPlaybackRate"] == 0.5
    assert video["largeFrameStep"] == "grid"

    # GET 读回同形态,未提交字段不丢默认。
    resp = await httpx_client.get(PREFS_URL, headers=_bearer(token))
    assert resp.status_code == 200
    assert resp.json()["workbench"]["video"] == {
        "defaultPlaybackRate": 0.5,
        "largeFrameStep": "grid",
        "autoFitOnResize": True,
    }


async def test_patch_video_range_and_enum_violations_422(httpx_client, annotator):
    _, token = annotator
    for bad_video in (
        {"defaultPlaybackRate": 3},
        {"defaultPlaybackRate": 0.75},
        {"largeFrameStep": 1},
        {"largeFrameStep": "sampling"},
    ):
        resp = await httpx_client.patch(
            PREFS_URL,
            json={"workbench": {"video": bad_video}},
            headers=_bearer(token),
        )
        assert resp.status_code == 422, bad_video


# ── 5. v0.15.6 点云子树 + common.crossFrameOverlayK ──────────────────


async def test_patch_pointcloud_subtree_fields(httpx_client, annotator):
    _, token = annotator
    resp = await httpx_client.patch(
        PREFS_URL,
        json={
            "workbench": {
                "pointcloud": {
                    "pointSize": 0.12,
                    "persistCameraView": True,
                    "colorizeWithCamera": True,
                    "colorizeContrast": 1.4,
                    "colorizeBrightness": 0.15,
                    "colorizeGamma": 1.2,
                    "showDepthHint": True,
                    "pointMaskSelectMode": "lasso",
                    "showGrid": False,
                    "neighborPointOverlay": True,
                    "neighborPointOverlayK": 2,
                    "neighborPointCull": "align",
                },
                "common": {
                    "crossFrameOverlayEnabled": True,
                    "crossFrameOverlayK": 5,
                    "performanceTier": "aggressive",
                },
            }
        },
        headers=_bearer(token),
    )
    assert resp.status_code == 200
    wb = resp.json()["workbench"]
    assert wb["pointcloud"]["pointSize"] == 0.12
    assert wb["pointcloud"]["persistCameraView"] is True
    assert wb["pointcloud"]["colorizeWithCamera"] is True
    assert wb["pointcloud"]["colorizeContrast"] == 1.4
    assert wb["pointcloud"]["colorizeBrightness"] == 0.15
    assert wb["pointcloud"]["colorizeGamma"] == 1.2
    assert wb["pointcloud"]["showDepthHint"] is True
    assert wb["pointcloud"]["pointMaskSelectMode"] == "lasso"
    assert wb["pointcloud"]["showGrid"] is False
    assert wb["pointcloud"]["neighborPointOverlay"] is True
    assert wb["pointcloud"]["neighborPointOverlayK"] == 2
    assert wb["pointcloud"]["neighborPointCull"] == "align"
    # 未提交字段保持默认值（默认值 = 现状红线）
    assert wb["pointcloud"]["showAxisGizmo"] is True
    assert wb["pointcloud"]["cameraDamping"] == 0.1
    assert wb["common"]["crossFrameOverlayEnabled"] is True
    assert wb["common"]["crossFrameOverlayK"] == 5
    assert wb["common"]["performanceTier"] == "aggressive"


async def test_patch_pointcloud_camera_layout_snapshot(httpx_client, annotator):
    _, token = annotator
    camera = {
        "position": [1.0, -2.0, 3.5],
        "target": [0.0, 0.0, 1.0],
        "up": [0.0, 0.0, 1.0],
        "mode": "orbit",
    }
    resp = await httpx_client.patch(
        PREFS_URL,
        json={"workbench": {"layout": {"pointcloudCamera": camera}}},
        headers=_bearer(token),
    )
    assert resp.status_code == 200
    assert resp.json()["workbench"]["layout"]["pointcloudCamera"] == camera


async def test_patch_pointcloud_range_and_enum_violations_422(httpx_client, annotator):
    _, token = annotator
    for bad_subtree in (
        {"pointcloud": {"pointSize": 0.5}},  # > 0.3
        {"pointcloud": {"pointSize": 0.001}},  # < 0.01
        {"pointcloud": {"colorizeContrast": 0.1}},  # < 0.5
        {"pointcloud": {"colorizeBrightness": 0.8}},  # > 0.5
        {"pointcloud": {"colorizeGamma": 4}},  # > 3
        {"pointcloud": {"cameraDamping": 0.01}},  # < 0.05
        {"pointcloud": {"pointMaskSelectMode": "circle"}},  # 非法枚举
        {"pointcloud": {"neighborPointOverlayK": 4}},  # 点云最多前后 3 帧
        {"pointcloud": {"neighborPointCull": "ghost"}},  # 只允许 keep/cull/align
        {"common": {"crossFrameOverlayK": 2}},  # 档位只允许 0/1/3/5/7
        {"common": {"performanceTier": "max"}},  # 只允许 light/standard/aggressive
    ):
        resp = await httpx_client.patch(
            PREFS_URL,
            json={"workbench": bad_subtree},
            headers=_bearer(token),
        )
        assert resp.status_code == 422, bad_subtree


# ── 5b. v0.15.25 UI 主题子树 ─────────────────────────────────────────


async def test_patch_ui_theme_persists_and_isolated_from_workbench(
    httpx_client, annotator
):
    _, token = annotator
    # 先写一个 workbench 字段,确认随后 PATCH ui 不会清掉它(顶层子树合并)。
    resp = await httpx_client.patch(
        PREFS_URL,
        json={"workbench": {"image": {"controlPointsSize": 9}}},
        headers=_bearer(token),
    )
    assert resp.status_code == 200

    resp = await httpx_client.patch(
        PREFS_URL,
        json={"ui": {"theme": "dark"}},
        headers=_bearer(token),
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["ui"]["theme"] == "dark"
    # workbench 子树不受影响。
    assert body["workbench"]["image"]["controlPointsSize"] == 9

    # GET 读回同形态。
    resp = await httpx_client.get(PREFS_URL, headers=_bearer(token))
    assert resp.status_code == 200
    assert resp.json()["ui"]["theme"] == "dark"
    assert resp.json()["workbench"]["image"]["controlPointsSize"] == 9


async def test_patch_ui_theme_default_and_invalid(httpx_client, annotator):
    _, token = annotator
    # 默认主题为 system(未写过 ui 时)。
    resp = await httpx_client.get(PREFS_URL, headers=_bearer(token))
    assert resp.status_code == 200
    assert resp.json()["ui"]["theme"] == "system"
    # 非法枚举 422。
    resp = await httpx_client.patch(
        PREFS_URL,
        json={"ui": {"theme": "sepia"}},
        headers=_bearer(token),
    )
    assert resp.status_code == 422
    # 子树内未知键仍 422(forbid)。
    resp = await httpx_client.patch(
        PREFS_URL,
        json={"ui": {"bogus": 1}},
        headers=_bearer(token),
    )
    assert resp.status_code == 422


# ── 6. 0103 迁移 SQL ────────────────────────────────────────────────


def _load_migration_0103():
    path = (
        Path(__file__).resolve().parents[1]
        / "alembic"
        / "versions"
        / "0103_workbench_prefs_subtrees.py"
    )
    spec = importlib.util.spec_from_file_location("migration_0103", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


LEGACY_FLAT_PREFS = {
    "workbench": {
        "smoothImage": False,
        "cssImageFilter": "contrast(1.2)",
        "controlPointsSize": 10,
        "snapToGrid": True,
        "longTaskSampleRate": 0.5,
        "layout": {"leftOpen": False, "rightOpen": True},
    },
    "ai": {"params_by_backend": {"sam": {"score_threshold": 0.7}}},
}


async def test_migration_0103_up_down_and_idempotency(db_session, annotator):
    mod = _load_migration_0103()
    user, _ = annotator
    user.preferences = copy.deepcopy(LEGACY_FLAT_PREFS)
    await db_session.flush()

    # up：平铺键搬入子树，layout / ai 不动
    res = await db_session.execute(
        sa.text(mod.UP_BATCH_SQL), {"batch_size": mod.BATCH_SIZE}
    )
    assert res.rowcount == 1
    await db_session.refresh(user)
    wb = user.preferences["workbench"]
    assert wb["image"] == {
        "smoothImage": False,
        "cssImageFilter": "contrast(1.2)",
        "controlPointsSize": 10,
        "snapToGrid": True,
    }
    assert wb["common"] == {"longTaskSampleRate": 0.5}
    assert wb["layout"] == {"leftOpen": False, "rightOpen": True}
    for flat_key in (
        "smoothImage",
        "cssImageFilter",
        "controlPointsSize",
        "snapToGrid",
        "longTaskSampleRate",
    ):
        assert flat_key not in wb
    assert user.preferences["ai"] == LEGACY_FLAT_PREFS["ai"]
    # 迁移产物可过新 schema 校验（forbid 不破）
    UserPreferences.model_validate(user.preferences)

    # 幂等：再跑一遍不命中任何行
    res = await db_session.execute(
        sa.text(mod.UP_BATCH_SQL), {"batch_size": mod.BATCH_SIZE}
    )
    assert res.rowcount == 0

    # down：逆映射回平铺，值还原
    res = await db_session.execute(
        sa.text(mod.DOWN_BATCH_SQL), {"batch_size": mod.BATCH_SIZE}
    )
    assert res.rowcount == 1
    await db_session.refresh(user)
    assert user.preferences == LEGACY_FLAT_PREFS
    # down 幂等
    res = await db_session.execute(
        sa.text(mod.DOWN_BATCH_SQL), {"batch_size": mod.BATCH_SIZE}
    )
    assert res.rowcount == 0


async def test_migration_0103_up_subtree_value_wins_over_flat(db_session, annotator):
    """窗口期同一行既有平铺键又有子树键（提升器已写过）→ 子树值为准。"""
    mod = _load_migration_0103()
    user, _ = annotator
    user.preferences = {
        "workbench": {
            "controlPointsSize": 4,
            "image": {"controlPointsSize": 12, "snapToGrid": True},
        }
    }
    await db_session.flush()

    res = await db_session.execute(
        sa.text(mod.UP_BATCH_SQL), {"batch_size": mod.BATCH_SIZE}
    )
    assert res.rowcount == 1
    await db_session.refresh(user)
    image = user.preferences["workbench"]["image"]
    assert image["controlPointsSize"] == 12
    assert image["snapToGrid"] is True


async def test_migration_0103_skips_rows_without_flat_keys(db_session, annotator):
    """已是新形态 / 只有 layout 的行不被 up 触碰。"""
    mod = _load_migration_0103()
    user, _ = annotator
    user.preferences = {"workbench": {"layout": {"leftOpen": True}}}
    await db_session.flush()

    res = await db_session.execute(
        sa.text(mod.UP_BATCH_SQL), {"batch_size": mod.BATCH_SIZE}
    )
    assert res.rowcount == 0
    await db_session.refresh(user)
    assert user.preferences == {"workbench": {"layout": {"leftOpen": True}}}


# ── 7. v0.16-pre · 运行期剥离已移除的 layout 像素键（leftWidth/rightWidth）─────
#   边栏宽度迁到 common 百分比后，WorkbenchLayoutPreferences(extra="forbid") 删了这两个
#   旧键；存量残留时 GET/PATCH 必须先剥离再校验，否则 422（0105 迁移未跑 / 灰度 / 回滚场景）。


async def test_get_preferences_strips_removed_layout_px_keys(
    httpx_client, annotator, db_session
):
    """存量行残留 layout.leftWidth/rightWidth 时 GET 不再 422，旧键剥离、合法键保留、pct 走默认。"""
    user, token = annotator
    user.preferences = {
        "workbench": {"layout": {"leftWidth": 320, "rightWidth": 360, "leftOpen": True}}
    }
    await db_session.flush()

    resp = await httpx_client.get(PREFS_URL, headers=_bearer(token))
    assert resp.status_code == 200
    wb = resp.json()["workbench"]
    assert "leftWidth" not in wb["layout"]
    assert "rightWidth" not in wb["layout"]
    assert wb["layout"]["leftOpen"] is True  # 合法键不动
    # strip 不补 pct，common 走 schema 默认 15。
    assert wb["common"]["leftWidthPct"] == 15.0
    assert wb["common"]["rightWidthPct"] == 15.0


async def test_patch_non_workbench_subtree_heals_residual_layout_keys(
    httpx_client, annotator, db_session
):
    """存量 workbench 残留旧键时，PATCH 非 workbench 子树（ui）不 422，且 merged 存回时旧键被剥离（自愈）。"""
    user, token = annotator
    user.preferences = {"workbench": {"layout": {"leftWidth": 320, "leftOpen": False}}}
    await db_session.flush()

    resp = await httpx_client.patch(
        PREFS_URL, json={"ui": {"theme": "dark"}}, headers=_bearer(token)
    )
    assert resp.status_code == 200
    layout = resp.json()["workbench"]["layout"]
    assert "leftWidth" not in layout
    assert layout["leftOpen"] is False


async def test_patch_workbench_layout_with_removed_keys_not_422(
    httpx_client, annotator
):
    """旧 tab 仍 PATCH layout.leftWidth 时，剥离器挡在 forbid 校验前 → 200，旧键不落库。"""
    _, token = annotator
    resp = await httpx_client.patch(
        PREFS_URL,
        json={"workbench": {"layout": {"leftWidth": 300, "rightOpen": True}}},
        headers=_bearer(token),
    )
    assert resp.status_code == 200
    layout = resp.json()["workbench"]["layout"]
    assert "leftWidth" not in layout
    assert layout["rightOpen"] is True


# ── 8. v0.16-pre · 0105 边栏像素↔百分比迁移（纯函数转换 + round-trip）─────────────


def _load_migration_0105():
    path = (
        Path(__file__).resolve().parents[1]
        / "alembic"
        / "versions"
        / "0105_workbench_sidebar_width_pct.py"
    )
    spec = importlib.util.spec_from_file_location("migration_0105", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_migration_0105_upgrade_px_to_pct_and_strip():
    mod = _load_migration_0105()
    out = mod._upgrade_prefs(
        {
            "workbench": {
                "layout": {"leftWidth": 720, "rightWidth": 360, "leftOpen": True}
            }
        }
    )
    assert out is not None
    # 720/1440*100=50 → clamp 上限 35；360/1440*100=25。
    assert out["workbench"]["common"]["leftWidthPct"] == 35
    assert out["workbench"]["common"]["rightWidthPct"] == 25
    # 旧键剥离，layout 合法键保留。
    assert "leftWidth" not in out["workbench"]["layout"]
    assert "rightWidth" not in out["workbench"]["layout"]
    assert out["workbench"]["layout"]["leftOpen"] is True
    # 产物可过新 schema（forbid 不破）。
    UserPreferences.model_validate(out)


def test_migration_0105_upgrade_skips_rows_without_legacy_px():
    mod = _load_migration_0105()
    for prefs in (
        {"workbench": {"common": {"leftWidthPct": 20}}},  # 已是新形态
        {"workbench": {"layout": {"leftOpen": True}}},  # layout 无旧 px
        {"ui": {"theme": "dark"}},  # 无 workbench
        {"workbench": "nope"},  # workbench 非 dict
        "not-a-dict",  # 行本身非 dict
    ):
        assert mod._upgrade_prefs(copy.deepcopy(prefs)) is None


def test_migration_0105_downgrade_pct_to_px_and_strip():
    mod = _load_migration_0105()
    out = mod._downgrade_prefs(
        {
            "workbench": {
                "common": {
                    "leftWidthPct": 35,
                    "rightWidthPct": 25,
                    "longTaskSampleRate": 0.1,
                }
            }
        }
    )
    assert out is not None
    # 35/100*1440=504 → clamp(200,560)=504；25/100*1440=360。
    assert out["workbench"]["layout"]["leftWidth"] == 504
    assert out["workbench"]["layout"]["rightWidth"] == 360
    # pct 剥离，其他 common 字段保留。
    assert "leftWidthPct" not in out["workbench"]["common"]
    assert "rightWidthPct" not in out["workbench"]["common"]
    assert out["workbench"]["common"]["longTaskSampleRate"] == 0.1


def test_migration_0105_roundtrip_lossy_at_clamp_bounds():
    """up→down 非双射：pct 下限 10 + px 下限 200 把过小的宽度截断放大。"""
    mod = _load_migration_0105()
    up = mod._upgrade_prefs({"workbench": {"layout": {"leftWidth": 100}}})
    # 100/1440*100=6.94 → round 7 → clamp 下限 10。
    assert up["workbench"]["common"]["leftWidthPct"] == 10
    down = mod._downgrade_prefs(up)
    # 10/100*1440=144 → clamp 下限 200 ≠ 原始 100。
    assert down["workbench"]["layout"]["leftWidth"] == 200


def test_migration_0105_upgrade_idempotent():
    """已剥离旧键的行再 up → None（不重复转换）。"""
    mod = _load_migration_0105()
    once = mod._upgrade_prefs({"workbench": {"layout": {"leftWidth": 300}}})
    assert once is not None
    assert "leftWidth" not in once["workbench"]["layout"]
    assert mod._upgrade_prefs(once) is None
