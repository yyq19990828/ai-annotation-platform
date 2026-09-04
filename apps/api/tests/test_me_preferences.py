"""v0.15.3 · workbench 偏好四子树。

覆盖三块：
1. PATCH /auth/me/preferences 子树合并（只动提交字段，其余回默认值）
2. legacy 平铺键提升器（旧 tab 兼容,v0.16 移除）：旧键提升 / 新旧同现以新为准 / 未知键仍 422
3. 0103 迁移 SQL：旧平铺 JSONB → 子树形态、幂等、down 还原（直接对测试库执行迁移模块
   暴露的 UP_BATCH_SQL / DOWN_BATCH_SQL，验证的就是迁移真实跑的那份 SQL）
"""

import copy
import importlib.util
import json
from pathlib import Path

import pytest
import sqlalchemy as sa
from pydantic import ValidationError

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
    assert wb["image"]["maskOverlayOpacity"] == 0.45
    assert wb["common"]["longTaskSampleRate"] == 0.05
    assert wb["common"]["confirmDelete"] == "never"
    assert wb["common"]["recentClassesLimit"] == 5
    # v0.15.27 · 标注视觉默认值(= 统一后基准)
    assert wb["common"]["labelFontSize"] == 12
    assert wb["common"]["labelVisibility"] == "always"
    assert wb["common"]["labelContent"] == {
        "single": [],
        "track": ["id", "state"],
        "ai": ["source", "score"],
    }
    assert wb["common"]["strokeWidth"] == 1.5
    assert wb["common"]["fillOpacity"] == 0.07
    assert wb["common"]["fillOpacitySelected"] == 0.12

    # GET 读回同形态
    resp = await httpx_client.get(PREFS_URL, headers=_bearer(token))
    assert resp.status_code == 200
    assert resp.json()["workbench"]["image"]["controlPointsSize"] == 10


async def test_patch_ai_subtree_deep_merges_params_and_model(httpx_client, annotator):
    """v0.18.25 · ai 子树深一层合并: params_by_backend / model_by_backend 由不同前端 hook
    各自只提交自己那半子键, 互不冲掉 (区别于 workbench 的整子树替换)。"""
    _, token = annotator
    bid = "11111111-1111-1111-1111-111111111111"

    # 1) 先写参数偏好 (模拟 useAiToolParamPrefs)。
    resp = await httpx_client.patch(
        PREFS_URL,
        json={"ai": {"params_by_backend": {bid: {"score_threshold": 0.3}}}},
        headers=_bearer(token),
    )
    assert resp.status_code == 200

    # 2) 再写模型选择偏好 (模拟 useAiToolModelPref) — 不应冲掉上一步的参数。
    resp = await httpx_client.patch(
        PREFS_URL,
        json={"ai": {"model_by_backend": {bid: "detect-yoloe"}}},
        headers=_bearer(token),
    )
    assert resp.status_code == 200
    ai = resp.json()["ai"]
    assert ai["params_by_backend"] == {bid: {"score_threshold": 0.3}}
    assert ai["model_by_backend"] == {bid: "detect-yoloe"}

    # 3) 反向: 再改参数, 模型选择仍在。
    resp = await httpx_client.patch(
        PREFS_URL,
        json={"ai": {"params_by_backend": {bid: {"score_threshold": 0.9}}}},
        headers=_bearer(token),
    )
    assert resp.status_code == 200
    ai = resp.json()["ai"]
    assert ai["params_by_backend"] == {bid: {"score_threshold": 0.9}}
    assert ai["model_by_backend"] == {bid: "detect-yoloe"}

    # GET 读回一致。
    resp = await httpx_client.get(PREFS_URL, headers=_bearer(token))
    assert resp.json()["ai"]["model_by_backend"] == {bid: "detect-yoloe"}


async def test_patch_workbench_layout_deep_merges_new_collapse_flags(
    httpx_client, annotator
):
    """workbench.layout 深合并: 四个新的分组折叠字段 (aiSectionCollapsed /
    manualSectionCollapsed / discussionCollapsed / attrPanelCollapsed) 由不同 writer
    单键 PATCH, 互不冲掉。守护 v0.20.19 已修的 ui.* / ai.* 同源 bug 不在 workbench.layout 复发。"""
    _, token = annotator

    # 1) 先展开状态改一次 attrPanelCollapsed。
    resp = await httpx_client.patch(
        PREFS_URL,
        json={"workbench": {"layout": {"attrPanelCollapsed": True}}},
        headers=_bearer(token),
    )
    assert resp.status_code == 200

    # 2) 再单独提交 aiSectionCollapsed — 不应冲掉 attrPanelCollapsed。
    resp = await httpx_client.patch(
        PREFS_URL,
        json={"workbench": {"layout": {"aiSectionCollapsed": True}}},
        headers=_bearer(token),
    )
    assert resp.status_code == 200
    layout = resp.json()["workbench"]["layout"]
    assert layout["attrPanelCollapsed"] is True
    assert layout["aiSectionCollapsed"] is True

    # 3) 单独提交 manualSectionCollapsed + trackSectionCollapsed + discussionCollapsed
    #    - 前两键仍在。
    resp = await httpx_client.patch(
        PREFS_URL,
        json={
            "workbench": {
                "layout": {
                    "manualSectionCollapsed": True,
                    "trackSectionCollapsed": True,
                    "discussionCollapsed": True,
                }
            }
        },
        headers=_bearer(token),
    )
    assert resp.status_code == 200
    layout = resp.json()["workbench"]["layout"]
    assert layout["attrPanelCollapsed"] is True
    assert layout["aiSectionCollapsed"] is True
    assert layout["manualSectionCollapsed"] is True
    assert layout["trackSectionCollapsed"] is True
    assert layout["discussionCollapsed"] is True


async def test_patch_camera_panels_replaces_role_map(httpx_client, annotator):
    """cameraPanels 是前端提交的整份 role map；删掉 role 必须真正清除旧状态。"""
    _, token = annotator
    headers = _bearer(token)

    resp = await httpx_client.patch(
        PREFS_URL,
        json={
            "workbench": {
                "layout": {
                    "cameraPanels": {
                        "camera_CAM_FRONT": {
                            "x": None,
                            "y": None,
                            "collapsed": True,
                        },
                        "camera_CAM_BACK": {
                            "x": 120,
                            "y": 80,
                            "collapsed": True,
                        },
                    }
                }
            }
        },
        headers=headers,
    )
    assert resp.status_code == 200

    # 宽屏下点「展开相机」会删掉该 role，用缺省值表示展开。
    resp = await httpx_client.patch(
        PREFS_URL,
        json={
            "workbench": {
                "layout": {
                    "cameraPanels": {
                        "camera_CAM_BACK": {
                            "x": 120,
                            "y": 80,
                            "collapsed": True,
                        }
                    }
                }
            }
        },
        headers=headers,
    )
    assert resp.status_code == 200
    assert resp.json()["workbench"]["layout"]["cameraPanels"] == {
        "camera_CAM_BACK": {"x": 120.0, "y": 80.0, "collapsed": True}
    }

    # 未提交 cameraPanels 的其他 layout 单键 PATCH 仍须保留当前 map。
    resp = await httpx_client.patch(
        PREFS_URL,
        json={"workbench": {"layout": {"attrPanelCollapsed": True}}},
        headers=headers,
    )
    assert resp.status_code == 200
    assert resp.json()["workbench"]["layout"]["cameraPanels"] == {
        "camera_CAM_BACK": {"x": 120.0, "y": 80.0, "collapsed": True}
    }

    # 「传感器融合 / 重置相机布局」用空 map 清掉所有 role。
    resp = await httpx_client.patch(
        PREFS_URL,
        json={"workbench": {"layout": {"cameraPanels": {}}}},
        headers=headers,
    )
    assert resp.status_code == 200
    assert resp.json()["workbench"]["layout"]["cameraPanels"] == {}


async def test_patch_ai_secondary_by_model_deep_merges_per_backend_bucket(
    httpx_client, annotator
):
    """ai.secondary_by_model 深度 2 合并: 单 backend 桶 PATCH 不覆盖其它 backend 桶。
    (useSecondaryParamPrefs debounce 单 backend 写时不冲掉相邻 backend 偏好。)"""
    _, token = annotator
    b1 = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
    b2 = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"

    # 1) 先写 backend1 的桶。
    resp = await httpx_client.patch(
        PREFS_URL,
        json={
            "ai": {
                "secondary_by_model": {b1: {"model-a": {"params": {"threshold": 0.3}}}}
            }
        },
        headers=_bearer(token),
    )
    assert resp.status_code == 200

    # 2) 单独写 backend2 的桶 — 不应冲掉 backend1 的桶。
    resp = await httpx_client.patch(
        PREFS_URL,
        json={
            "ai": {
                "secondary_by_model": {b2: {"model-b": {"params": {"threshold": 0.5}}}}
            }
        },
        headers=_bearer(token),
    )
    assert resp.status_code == 200
    sbm = resp.json()["ai"]["secondary_by_model"]
    assert sbm[b1] == {"model-a": {"params": {"threshold": 0.3}}}
    assert sbm[b2] == {"model-b": {"params": {"threshold": 0.5}}}

    # 3) 反向: 再改 backend1 桶里某 model 参数 — backend2 仍在。
    resp = await httpx_client.patch(
        PREFS_URL,
        json={
            "ai": {
                "secondary_by_model": {b1: {"model-a": {"params": {"threshold": 0.9}}}}
            }
        },
        headers=_bearer(token),
    )
    assert resp.status_code == 200
    sbm = resp.json()["ai"]["secondary_by_model"]
    assert sbm[b1] == {"model-a": {"params": {"threshold": 0.9}}}
    assert sbm[b2] == {"model-b": {"params": {"threshold": 0.5}}}


async def test_patch_ui_subtree_deep_merges_theme_and_secondary_bar(
    httpx_client, annotator
):
    """v0.20.19 · ui 子树深一层合并: theme (useTheme) 与 secondary_bar_hidden
    (二次推理面板显隐) 由不同 writer 各自只提交自己那半键, 互不冲掉。"""
    _, token = annotator

    # 1) 先写主题 (模拟 useTheme)。
    resp = await httpx_client.patch(
        PREFS_URL, json={"ui": {"theme": "dark"}}, headers=_bearer(token)
    )
    assert resp.status_code == 200

    # 2) 再写二次推理面板显隐 — 不应冲掉主题。
    resp = await httpx_client.patch(
        PREFS_URL,
        json={"ui": {"secondary_bar_hidden": True}},
        headers=_bearer(token),
    )
    assert resp.status_code == 200
    ui = resp.json()["ui"]
    assert ui["theme"] == "dark"
    assert ui["secondary_bar_hidden"] is True

    # 3) 反向: 再改主题, 显隐仍在。
    resp = await httpx_client.patch(
        PREFS_URL, json={"ui": {"theme": "light"}}, headers=_bearer(token)
    )
    assert resp.status_code == 200
    ui = resp.json()["ui"]
    assert ui["theme"] == "light"
    assert ui["secondary_bar_hidden"] is True


async def test_patch_ai_interactive_backend_independent(httpx_client, annotator):
    """v0.18.31 · 第三个 ai 子键 interactive_backend_by_project (交互后端选择, 按 project)
    与 params/model 独立深合并, 三键互不覆盖。"""
    _, token = annotator
    bid = "22222222-2222-2222-2222-222222222222"
    pid = "33333333-3333-3333-3333-333333333333"

    # 先写 model + params。
    await httpx_client.patch(
        PREFS_URL,
        json={"ai": {"model_by_backend": {bid: "detect"}}},
        headers=_bearer(token),
    )
    await httpx_client.patch(
        PREFS_URL,
        json={"ai": {"params_by_backend": {bid: {"score_threshold": 0.5}}}},
        headers=_bearer(token),
    )

    # 再写交互后端选择 (模拟 useInteractiveBackendPref) — 不冲掉前两者。
    resp = await httpx_client.patch(
        PREFS_URL,
        json={"ai": {"interactive_backend_by_project": {pid: bid}}},
        headers=_bearer(token),
    )
    assert resp.status_code == 200
    ai = resp.json()["ai"]
    assert ai["interactive_backend_by_project"] == {pid: bid}
    assert ai["model_by_backend"] == {bid: "detect"}
    assert ai["params_by_backend"] == {bid: {"score_threshold": 0.5}}

    # GET 读回三键齐全。
    resp = await httpx_client.get(PREFS_URL, headers=_bearer(token))
    ai = resp.json()["ai"]
    assert ai["interactive_backend_by_project"] == {pid: bid}
    assert ai["model_by_backend"] == {bid: "detect"}


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
                    "labelVisibility": "selected",
                    "labelFontSize": 16,
                    "strokeWidth": 2.5,
                    "fillOpacity": 0.2,
                    "fillOpacitySelected": 0.4,
                },
                "image": {
                    "afterBoxCreate": "reuse_active",
                    "snapThresholdPx": 12,
                    "zoomStepFactor": 1.15,
                    "fadedOpacity": 0.5,
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
    assert wb["image"]["maskOverlayOpacity"] == 0.6
    # v0.15.27 · 标注视觉字段(common 共享)
    assert wb["common"]["labelVisibility"] == "selected"
    assert wb["common"]["labelFontSize"] == 16
    assert wb["common"]["strokeWidth"] == 2.5
    assert wb["common"]["fillOpacity"] == 0.2
    assert wb["common"]["fillOpacitySelected"] == 0.4
    # 未提交字段保持默认值。
    assert wb["image"]["smoothImage"] is True
    assert wb["common"]["longTaskSampleRate"] == 0.05
    assert wb["common"]["labelContent"] == {
        "single": [],
        "track": ["id", "state"],
        "ai": ["source", "score"],
    }


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
        # v0.15.27 · 标注视觉字段范围 / 枚举越界
        {"common": {"labelFontSize": 7}},
        {"common": {"labelFontSize": 25}},
        {"common": {"labelVisibility": "hover"}},
        {"common": {"strokeWidth": 0.5}},
        {"common": {"strokeWidth": 6}},
        {"common": {"fillOpacity": -0.1}},
        {"common": {"fillOpacity": 0.7}},
        {"common": {"fillOpacitySelected": 0.9}},
        {"common": {"labelContent": {"ai": ["unknown"]}}},
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
        "trackContinueAutoAdvance": False,
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


# ── 9. v0.15.27 · 标注视觉字段 + 0106 showBoxLabels→labelVisibility 迁移 ──────


def test_label_content_migrates_legacy_flat_list():
    """v0.16.7 · 旧扁平 labelContent list 迁移为按标注类型分段对象。"""

    def parse(value):
        return UserPreferences.model_validate(
            {"workbench": {"common": {"labelContent": value}}}
        ).workbench.common.labelContent

    # 旧默认 ["class","score"] → 图片观感不变（ai 补 source 保前缀），track 用默认。
    migrated = parse(["class", "score"])
    assert migrated.single == []
    assert migrated.track == ["id", "state"]
    assert migrated.ai == ["source", "score"]

    # 旧值带 id/attrs → single/ai 分发，class 丢弃，非法 token 过滤。
    migrated2 = parse(["class", "id", "attrs", "bogus"])
    assert migrated2.single == ["id", "attrs"]
    assert migrated2.ai == ["source", "id", "attrs"]
    assert migrated2.track == ["id", "state"]


def test_label_content_object_dedups_and_rejects_unknown_token():
    """v0.16.7 · 新对象格式：各段去重保序；缺省段补默认；非法 token 触发校验错误。"""
    import pytest
    from pydantic import ValidationError

    parsed = UserPreferences.model_validate(
        {
            "workbench": {
                "common": {"labelContent": {"ai": ["score", "score", "source"]}}
            }
        }
    ).workbench.common.labelContent
    assert parsed.ai == ["score", "source"]  # 去重保序
    assert parsed.track == ["id", "state"]  # 缺省段补默认
    assert parsed.single == []

    with pytest.raises(ValidationError):
        UserPreferences.model_validate(
            {"workbench": {"common": {"labelContent": {"single": ["bogus"]}}}}
        )


def _load_migration_0106():
    path = (
        Path(__file__).resolve().parents[1]
        / "alembic"
        / "versions"
        / "0106_label_visual_settings.py"
    )
    spec = importlib.util.spec_from_file_location("migration_0106", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_migration_0106_upgrade_false_to_none_and_strip():
    mod = _load_migration_0106()
    out = mod._upgrade_prefs(
        {"workbench": {"image": {"showBoxLabels": False, "fadedOpacity": 0.5}}}
    )
    assert out is not None
    assert out["workbench"]["common"]["labelVisibility"] == "none"
    # 旧键剥离，image 其他键保留。
    assert "showBoxLabels" not in out["workbench"]["image"]
    assert out["workbench"]["image"]["fadedOpacity"] == 0.5
    UserPreferences.model_validate(out)


def test_migration_0106_upgrade_true_strips_without_writing_visibility():
    mod = _load_migration_0106()
    out = mod._upgrade_prefs({"workbench": {"image": {"showBoxLabels": True}}})
    assert out is not None
    assert "showBoxLabels" not in out["workbench"]["image"]
    # showBoxLabels=True → 不写 common（schema 默认 "always" 覆盖）。
    assert "labelVisibility" not in out["workbench"].get("common", {})
    UserPreferences.model_validate(out)


def test_migration_0106_upgrade_skips_rows_without_key():
    mod = _load_migration_0106()
    for prefs in (
        {"workbench": {"common": {"labelVisibility": "none"}}},  # 已是新形态
        {"workbench": {"image": {"smoothImage": True}}},  # image 无 showBoxLabels
        {"ui": {"theme": "dark"}},  # 无 workbench
        {"workbench": "nope"},
        "not-a-dict",
    ):
        assert mod._upgrade_prefs(copy.deepcopy(prefs)) is None


def test_migration_0106_downgrade_visibility_to_bool_and_strip_new_keys():
    mod = _load_migration_0106()
    out = mod._downgrade_prefs(
        {
            "workbench": {
                "common": {
                    "labelVisibility": "none",
                    "labelFontSize": 16,
                    "strokeWidth": 2.5,
                    "longTaskSampleRate": 0.1,
                }
            }
        }
    )
    assert out is not None
    # none → showBoxLabels False
    assert out["workbench"]["image"]["showBoxLabels"] is False
    # 本版新增 common 键全部剥离，旧字段保留。
    assert "labelVisibility" not in out["workbench"]["common"]
    assert "labelFontSize" not in out["workbench"]["common"]
    assert "strokeWidth" not in out["workbench"]["common"]
    assert out["workbench"]["common"]["longTaskSampleRate"] == 0.1


def test_migration_0106_downgrade_selected_maps_to_true_lossy():
    """down 非双射：selected 无 bool 等价 → showBoxLabels True。"""
    mod = _load_migration_0106()
    out = mod._downgrade_prefs(
        {"workbench": {"common": {"labelVisibility": "selected"}}}
    )
    assert out is not None
    assert out["workbench"]["image"]["showBoxLabels"] is True


def test_migration_0106_upgrade_idempotent():
    mod = _load_migration_0106()
    once = mod._upgrade_prefs({"workbench": {"image": {"showBoxLabels": False}}})
    assert once is not None
    assert "showBoxLabels" not in once["workbench"]["image"]
    assert mod._upgrade_prefs(once) is None


def _workspace_envelope(version=1):
    panels = ["canvas", "task-queue", "class-palette", "inspector", "discussion"]
    if version == 3:
        panels += ["ai-task", "video-tracker"]
    return {
        "schemaVersion": version,
        "snapshot": {
            "layout": {
                "grid": {
                    "root": {
                        "type": "branch",
                        "data": [
                            {
                                "type": "leaf",
                                "data": {"id": "canvas", "views": ["canvas"]},
                            },
                            {
                                "type": "leaf",
                                "data": {"id": "right", "views": panels[1:]},
                            },
                        ],
                    },
                    "width": 1440,
                    "height": 900,
                    "orientation": "HORIZONTAL",
                },
                "panels": {
                    panel: {
                        "id": panel,
                        "contentComponent": "workbench-panel",
                        "renderer": "always",
                    }
                    for panel in panels
                },
                "activeGroup": "canvas",
            },
            "returns": {},
        },
    }


def _workspace_patch(envelope, context="annotate:image"):
    return {
        "workbench": {
            "layout": {
                "workspace": {
                    "engine": "dockview@8",
                    "contexts": {context: envelope},
                }
            }
        }
    }


@pytest.mark.parametrize("version", [1, 2, 3])
async def test_workspace_round_trip_versions_and_context_atomic_replace(
    httpx_client, annotator, version
):
    _, token = annotator
    envelope = _workspace_envelope(version)
    if version == 3:
        envelope["snapshot"]["visibilityIntent"] = {
            "ai-task": "hidden",
            "video-tracker": "shown",
        }
    response = await httpx_client.patch(
        PREFS_URL, json=_workspace_patch(envelope), headers=_bearer(token)
    )
    assert response.status_code == 200, response.text
    assert (
        response.json()["workbench"]["layout"]["workspace"]["contexts"][
            "annotate:image"
        ]
        == envelope
    )

    # A whole context replaces removed groups, return descriptors and optional keys.
    old = copy.deepcopy(envelope)
    old["snapshot"]["layout"]["floatingGroups"] = [
        {
            "data": {"id": "floating", "views": ["discussion"]},
            "position": {"left": 20, "top": 30, "width": 360, "height": 480},
        }
    ]
    old["snapshot"]["layout"]["grid"]["root"]["data"][1]["data"]["views"].remove(
        "discussion"
    )
    old["snapshot"]["returns"] = {"discussion": {"group": "right", "index": 3}}
    response = await httpx_client.patch(
        PREFS_URL, json=_workspace_patch(old), headers=_bearer(token)
    )
    assert response.status_code == 200, response.text
    response = await httpx_client.patch(
        PREFS_URL, json=_workspace_patch(envelope), headers=_bearer(token)
    )
    assert response.status_code == 200, response.text
    response = await httpx_client.get(PREFS_URL, headers=_bearer(token))
    assert (
        response.json()["workbench"]["layout"]["workspace"]["contexts"][
            "annotate:image"
        ]
        == envelope
    )


async def test_workspace_schema_downgrade_rejects_entire_patch(httpx_client, annotator):
    user, token = annotator
    response = await httpx_client.patch(
        PREFS_URL, json=_workspace_patch(_workspace_envelope(3)), headers=_bearer(token)
    )
    assert response.status_code == 200
    previous = copy.deepcopy(user.preferences)
    patch = _workspace_patch(_workspace_envelope(1))
    patch["ui"] = {"theme": "dark"}
    response = await httpx_client.patch(PREFS_URL, json=patch, headers=_bearer(token))
    assert response.status_code == 409
    assert response.json()["detail"] == "layout_schema_downgrade"
    assert user.preferences == previous


async def test_workspace_invalid_patch_returns_422_without_writing(
    httpx_client, annotator
):
    user, token = annotator
    previous = copy.deepcopy(user.preferences)
    envelope = _workspace_envelope()
    envelope["snapshot"]["layout"]["popoutGroups"] = []
    response = await httpx_client.patch(
        PREFS_URL, json=_workspace_patch(envelope), headers=_bearer(token)
    )
    assert response.status_code == 422
    assert user.preferences == previous


async def test_workspace_overflow_number_returns_422_without_writing(
    httpx_client, annotator
):
    user, token = annotator
    previous = copy.deepcopy(user.preferences)
    # A valid JSON exponent overflows Python's float. Send raw HTTP JSON so the
    # client's own finite-number encoder cannot reject it before reaching the API.
    body = json.dumps(_workspace_patch(_workspace_envelope())).replace(
        '"width": 1440', '"width": 1e309'
    )
    response = await httpx_client.patch(
        PREFS_URL,
        content=body,
        headers={**_bearer(token), "Content-Type": "application/json"},
    )
    assert response.status_code == 422
    assert "finite JSON values" in response.json()["detail"][0]["msg"]
    assert user.preferences == previous


@pytest.mark.parametrize(
    "workspace",
    [
        {
            "engine": "dockview@8",
            "contexts": {
                "annotate:image": {
                    "schemaVersion": 99,
                    "snapshot": {"future": [1, 2, 3]},
                }
            },
        },
        {
            "engine": "future-engine",
            "contexts": {"annotate:image": {"schemaVersion": 1, "snapshot": "broken"}},
        },
    ],
)
async def test_workspace_get_and_unrelated_patch_preserve_unknown_or_corrupt_values(
    httpx_client, annotator, db_session, workspace
):
    user, token = annotator
    user.preferences = {
        "workbench": {"layout": {"workspace": copy.deepcopy(workspace)}}
    }
    await db_session.flush()
    response = await httpx_client.get(PREFS_URL, headers=_bearer(token))
    assert response.status_code == 200
    assert response.json()["workbench"]["layout"]["workspace"] == workspace
    response = await httpx_client.patch(
        PREFS_URL, json={"ui": {"theme": "dark"}}, headers=_bearer(token)
    )
    assert response.status_code == 200
    assert response.json()["workbench"]["layout"]["workspace"] == workspace
    assert user.preferences["workbench"]["layout"]["workspace"] == workspace


def test_workspace_rejects_invalid_grammar_and_resource_limits():
    envelope = _workspace_envelope()
    invalid = []
    for path, value in [
        (("schemaVersion",), True),
        (("schemaVersion",), 4),
        (("snapshot", "layout", "grid", "width"), float("inf")),
        (("snapshot", "layout", "grid", "height"), -1),
        (("snapshot", "layout", "grid", "root", "data", 0, "data", "views"), []),
        (
            ("snapshot", "layout", "grid", "root", "data", 1, "data", "views"),
            ["canvas"],
        ),
        (
            ("snapshot", "layout", "grid", "root", "data", 0, "data", "id"),
            "moved-canvas",
        ),
        (("snapshot", "layout", "grid", "root", "data", 1, "data", "id"), "canvas"),
        (
            ("snapshot", "layout", "grid", "root", "data", 1, "data", "id"),
            "compact-overlay",
        ),
        (("snapshot", "layout", "grid", "root", "data", 1, "visible"), False),
        (("snapshot", "layout", "grid", "maximizedNode"), {"location": [1]}),
        (("snapshot", "layout", "grid", "maximizedNode"), {"location": [9]}),
        (
            ("snapshot", "layout", "panels", "canvas", "params"),
            {"taskId": "business-data"},
        ),
        (("snapshot", "layout", "panels", "canvas", "renderer"), "onlyWhenVisible"),
        (("snapshot", "layout", "panels", "inspector", "id"), "discussion"),
        (("snapshot", "layout", "popoutGroups"), []),
        (("snapshot", "layout", "edgeGroups"), {}),
        (("snapshot", "layout", "activeGroup"), "missing"),
        (("snapshot", "returns"), {"canvas": {"group": "right", "index": 0}}),
        (("snapshot", "returns"), {"discussion": {"group": "parking", "index": 0}}),
        (("snapshot", "returns"), {"discussion": {"group": "right", "index": -1}}),
        (
            ("snapshot", "returns"),
            {"discussion": {"group": "right", "index": 0, "taskId": "business"}},
        ),
        (("snapshot", "visibilityIntent"), {"ai-task": "hidden"}),
        (("snapshot", "unknown"), "x" * 65536),
    ]:
        changed = copy.deepcopy(envelope)
        target = changed
        for key in path[:-1]:
            target = target[key]
        target[path[-1]] = value
        invalid.append(changed)
    deep = copy.deepcopy(envelope)
    for _ in range(13):
        grid = deep["snapshot"]["layout"]["grid"]
        grid["root"] = {"type": "branch", "data": [grid["root"]]}
    invalid.append(deep)
    for changed in invalid:
        with pytest.raises(ValidationError):
            UserPreferences.model_validate(_workspace_patch(changed))
    for workspace in [
        None,
        {"engine": "dockview@9", "contexts": {}},
        {"engine": "dockview@8", "contexts": {"unknown": envelope}},
    ]:
        with pytest.raises(ValidationError):
            UserPreferences.model_validate(
                {"workbench": {"layout": {"workspace": workspace}}}
            )


def test_workspace_parking_movable_canvas_and_maximized_canvas():
    envelope = _workspace_envelope(2)
    grid = envelope["snapshot"]["layout"]["grid"]
    grid["maximizedNode"] = {"location": [0]}
    right = grid["root"]["data"][1]
    right["data"]["id"] = "parking"
    right["data"]["hideHeader"] = True
    right["visible"] = False
    UserPreferences.model_validate(_workspace_patch(envelope))
    moved = copy.deepcopy(envelope)
    moved["snapshot"]["layout"]["grid"]["root"]["data"][0]["data"]["id"] = (
        "moved-canvas"
    )
    with pytest.raises(ValidationError):
        UserPreferences.model_validate(_workspace_patch(moved))
    right["visible"] = True
    with pytest.raises(ValidationError):
        UserPreferences.model_validate(_workspace_patch(envelope))


async def test_workspace_concurrent_context_writes_refresh_locked_identity(test_engine):
    """Both callers authenticate before either write; each must merge the latest row."""
    import asyncio
    import uuid

    from fastapi import HTTPException
    from sqlalchemy.ext.asyncio import async_sessionmaker

    from app.api.v1.me import update_preferences
    from app.db.models.user import User

    maker = async_sessionmaker(test_engine, expire_on_commit=False)
    user_id = uuid.uuid4()
    async with maker() as setup:
        setup.add(
            User(
                id=user_id,
                email=f"workspace-{user_id}@test.local",
                name="Workspace",
                password_hash="unused",
            )
        )
        await setup.commit()
    try:
        async with maker() as first, maker() as second:
            user_a = await first.get(User, user_id)
            user_b = await second.get(User, user_id)
            await asyncio.gather(
                update_preferences(
                    _workspace_patch(_workspace_envelope(), "annotate:image"),
                    first,
                    user_a,
                ),
                update_preferences(
                    _workspace_patch(_workspace_envelope(), "review:video"),
                    second,
                    user_b,
                ),
            )
            await first.refresh(user_a)
            assert set(
                user_a.preferences["workbench"]["layout"]["workspace"]["contexts"]
            ) == {"annotate:image", "review:video"}
            # The second identity remains stale while the first upgrades a context.
            await update_preferences(
                _workspace_patch(_workspace_envelope(3)), first, user_a
            )
            with pytest.raises(HTTPException) as caught:
                await update_preferences(
                    _workspace_patch(_workspace_envelope()), second, user_b
                )
            assert caught.value.status_code == 409
            await second.rollback()
    finally:
        async with maker() as cleanup:
            await cleanup.execute(sa.delete(User).where(User.id == user_id))
            await cleanup.commit()
