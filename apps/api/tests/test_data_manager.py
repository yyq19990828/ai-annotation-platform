from __future__ import annotations

import httpx
import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.annotation import Annotation
from app.db.models.dataset import Dataset, DatasetItem, Scene
from app.db.models.prediction import (
    INTERACTIVE_ACCEPT_PREDICTION_SOURCE,
    Prediction,
)
from app.db.models.project_member import ProjectMember
from app.db.models.task_batch import TaskBatch
from app.db.models.video_tracker_job import VideoTrackerJob
from tests.factory import create_project, create_task


pytestmark = pytest.mark.asyncio


async def test_schema_is_capability_driven_for_video_and_attributes(
    httpx_client: httpx.AsyncClient,
    project_admin,
    db_session: AsyncSession,
):
    owner, token = project_admin
    project = await create_project(
        db_session, owner_id=owner.id, type_key="video-track"
    )
    project.data_type = "video"
    project.scene_mode = False
    project.tool_bindings = {
        "bbox": {
            "enabled": True,
            "classes": ["car"],
            "attribute_schema": {
                "fields": [
                    {
                        "key": "color",
                        "label": "颜色",
                        "type": "select",
                        "options": [
                            {"value": "red", "label": "红"},
                            {"value": "blue", "label": "蓝"},
                        ],
                    }
                ]
            },
        }
    }
    await db_session.flush()

    response = await httpx_client.get(
        f"/api/v1/projects/{project.id}/data-manager/schema",
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["project_kind"] == {
        "data_type": "video",
        "type_key": "video-track",
        "scene_mode": False,
    }
    field_keys = {field["key"] for field in body["filter_fields"]}
    assert "scene.scene_name" not in field_keys
    assert "scene.frame_index" not in field_keys
    assert "annotation.attribute.bbox.color" in field_keys
    assert "keyframe.source" in field_keys
    assert "prediction.model_version" in field_keys
    assert "ai.low_confidence_prediction_shape_count" in field_keys
    color = next(
        field
        for field in body["filter_fields"]
        if field["key"] == "annotation.attribute.bbox.color"
    )
    assert color["operators"] == ["eq", "in", "exists", "missing"]
    column_keys = {column["key"] for column in body["columns"]}
    assert column_keys.issuperset({"duration", "fps", "frame_count", "keyframe_count"})
    assert "low_confidence_prediction_shape_count" in column_keys
    assert "model_versions" not in column_keys
    assert "avg_prediction_confidence" not in column_keys
    assert {"tracker-review", "with-tracks"}.issubset(body["builtin_views"])


async def test_schema_adds_scene_fields_only_for_scene_projects(
    httpx_client: httpx.AsyncClient,
    project_admin,
    db_session: AsyncSession,
):
    owner, token = project_admin
    project = await create_project(db_session, owner_id=owner.id, type_key="image-det")
    project.data_type = "image"
    project.scene_mode = True
    await db_session.flush()

    response = await httpx_client.get(
        f"/api/v1/projects/{project.id}/data-manager/schema",
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 200, response.text
    body = response.json()
    field_keys = {field["key"] for field in body["filter_fields"]}
    assert {"scene.scene_name", "scene.frame_index"}.issubset(field_keys)
    assert "ai.pending_tracker_job_count" not in field_keys
    assert {"scene_name", "frame_index"}.issubset(body["default_columns"])
    assert "interpolated" in body["builtin_views"]


async def test_scene_task_query_returns_name_frame_and_total(
    httpx_client: httpx.AsyncClient,
    project_admin,
    db_session: AsyncSession,
):
    owner, token = project_admin
    project = await create_project(db_session, owner_id=owner.id, type_key="lidar")
    project.data_type = "lidar"
    project.scene_mode = True
    dataset = Dataset(
        display_id="D-DM-SCENE",
        name="scene",
        data_type="lidar",
        created_by=owner.id,
    )
    db_session.add(dataset)
    await db_session.flush()
    scene = Scene(
        display_id="S-DM-SCENE",
        dataset_id=dataset.id,
        name="scene-alpha",
        created_by=owner.id,
    )
    db_session.add(scene)
    await db_session.flush()
    items = [
        DatasetItem(
            dataset_id=dataset.id,
            file_name=f"frame-{index}.pcd",
            file_path=f"frame-{index}.pcd",
            file_type="lidar",
            scene_id=scene.id,
            frame_index=index,
        )
        for index in range(2)
    ]
    db_session.add_all(items)
    await db_session.flush()
    task = await create_task(db_session, project_id=project.id, display_id="T-DM-SCENE")
    task.dataset_item_id = items[1].id
    task.file_type = "lidar"
    await db_session.flush()

    response = await httpx_client.post(
        f"/api/v1/projects/{project.id}/tasks/query",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "filter_json": {},
            "columns_json": [
                "display_id",
                "scene_name",
                "frame_index",
                "scene_total_frames",
            ],
        },
    )
    assert response.status_code == 200, response.text
    row = response.json()["items"][0]
    assert row["scene_name"] == "scene-alpha"
    assert row["frame_index"] == 1
    assert row["scene_total_frames"] == 2


async def test_summary_uses_real_annotation_and_pending_shape_counts(
    httpx_client: httpx.AsyncClient,
    project_admin,
    db_session: AsyncSession,
):
    owner, token = project_admin
    project = await create_project(db_session, owner_id=owner.id, type_key="image-det")
    task_a = await create_task(
        db_session, project_id=project.id, display_id="T-DM-SUM-A", status="pending"
    )
    task_b = await create_task(
        db_session, project_id=project.id, display_id="T-DM-SUM-B", status="review"
    )
    prediction = Prediction(
        task_id=task_a.id,
        project_id=project.id,
        model_version="detector-v1",
        result=[
            {"type": "rectanglelabels", "value": {}, "score": 0.9},
            {"type": "rectanglelabels", "value": {}, "score": 0.8},
            {"type": "rectanglelabels", "value": {}, "score": 0.4},
        ],
        rejected_shape_indexes=[1],
    )
    second_prediction = Prediction(
        task_id=task_b.id,
        project_id=project.id,
        model_version="detector-v2",
        result=[
            {"type": "rectanglelabels", "value": {}, "score": 0.8},
            {"type": "rectanglelabels", "value": {}, "score": 0.2},
        ],
    )
    interactive_accept_provenance = Prediction(
        task_id=task_b.id,
        project_id=project.id,
        model_version="sam-interactive",
        source=INTERACTIVE_ACCEPT_PREDICTION_SOURCE,
        result=[{"type": "raster_mask", "value": {}, "score": 0.1}],
    )
    db_session.add_all([prediction, second_prediction, interactive_accept_provenance])
    await db_session.flush()
    db_session.add_all(
        [
            Annotation(
                task_id=task_a.id,
                project_id=project.id,
                user_id=owner.id,
                source="prediction_based",
                annotation_type="bbox",
                tool_unit_id="bbox",
                class_name="car",
                geometry={"type": "bbox", "x": 1, "y": 1, "w": 2, "h": 2},
                parent_prediction_id=prediction.id,
                attributes={"_shape_index": 0, "color": "red"},
            ),
            Annotation(
                task_id=task_b.id,
                project_id=project.id,
                user_id=owner.id,
                source="manual",
                annotation_type="bbox",
                tool_unit_id="bbox",
                class_name="person",
                geometry={"type": "bbox", "x": 2, "y": 2, "w": 3, "h": 3},
                track_id="trk_summary",
                attributes={"_imported": True},
            ),
        ]
    )
    await db_session.flush()

    response = await httpx_client.post(
        f"/api/v1/projects/{project.id}/data-manager/summary",
        headers={"Authorization": f"Bearer {token}"},
        json={"filter_json": {}},
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["scope"] == {"visible_task_total": 2, "matched_task_total": 2}
    assert body["task_status"] == {"pending": 1, "review": 1}
    assert body["annotations"]["total"] == 2
    assert body["annotations"]["tracked"] == 1
    assert body["annotations"]["distinct_tracks"] == 1
    assert body["annotations"]["imported"] == 1
    assert body["annotations"]["by_source"] == {
        "manual": 1,
        "prediction_based": 1,
    }
    assert body["ai_review"] == {
        "prediction_shapes": 3,
        "low_confidence_prediction_shapes": 2,
        "tracker_jobs": 0,
        "confidence_threshold": 0.5,
        "by_model_version": {"detector-v1": 1, "detector-v2": 2},
        "confidence_buckets": {
            "lt_025": 1,
            "025_049": 1,
            "gte_075": 1,
        },
    }

    query_response = await httpx_client.post(
        f"/api/v1/projects/{project.id}/tasks/query",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "filter_json": {},
            "columns_json": [
                "display_id",
                "annotation_source_counts",
                "track_count",
                "pending_prediction_shape_count",
                "low_confidence_prediction_shape_count",
            ],
        },
    )
    assert query_response.status_code == 200, query_response.text
    by_id = {item["id"]: item for item in query_response.json()["items"]}
    assert by_id[str(task_a.id)]["pending_prediction_shape_count"] == 1
    assert by_id[str(task_a.id)]["low_confidence_prediction_shape_count"] == 1
    assert by_id[str(task_b.id)]["pending_prediction_shape_count"] == 2
    assert by_id[str(task_b.id)]["low_confidence_prediction_shape_count"] == 1
    assert by_id[str(task_a.id)]["annotation_source_counts"]["prediction_based"] == 1
    assert by_id[str(task_b.id)]["track_count"] == 1

    low_confidence_response = await httpx_client.post(
        f"/api/v1/projects/{project.id}/tasks/query",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "filter_json": {
                "field": "ai.low_confidence_prediction_shape_count",
                "op": "gt",
                "value": 0,
            },
            "columns_json": [
                "display_id",
                "low_confidence_prediction_shape_count",
            ],
        },
    )
    assert low_confidence_response.status_code == 200, low_confidence_response.text
    assert low_confidence_response.json()["total"] == 2

    matches = await httpx_client.post(
        f"/api/v1/projects/{project.id}/tasks/{task_b.id}/data-manager/matches",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "filter_json": {
                "field": "ai.pending_prediction_shape_count",
                "op": "gt",
                "value": 0,
            }
        },
    )
    assert matches.status_code == 200, matches.text
    assert matches.json()["total"] == 2


async def test_keyword_search_matches_task_id_and_file_name(
    httpx_client: httpx.AsyncClient,
    project_admin,
    db_session: AsyncSession,
):
    owner, token = project_admin
    project = await create_project(db_session, owner_id=owner.id, type_key="image-det")
    task_a = await create_task(
        db_session, project_id=project.id, display_id="T-SPECIAL-42"
    )
    task_b = await create_task(db_session, project_id=project.id, display_id="T-OTHER")
    task_b.file_name = "factory-floor-special.jpg"
    await db_session.flush()

    response = await httpx_client.post(
        f"/api/v1/projects/{project.id}/tasks/query",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "filter_json": {
                "op": "and",
                "rules": [
                    {"field": "task.keyword", "op": "contains", "value": "special"}
                ],
            }
        },
    )

    assert response.status_code == 200, response.text
    assert {item["id"] for item in response.json()["items"]} == {
        str(task_a.id),
        str(task_b.id),
    }


async def test_attribute_value_and_origin_filters_use_project_schema(
    httpx_client: httpx.AsyncClient,
    project_admin,
    db_session: AsyncSession,
):
    owner, token = project_admin
    project = await create_project(db_session, owner_id=owner.id, type_key="image-det")
    project.tool_bindings = {
        "bbox": {
            "enabled": True,
            "classes": ["car"],
            "attribute_schema": {
                "fields": [
                    {
                        "key": "paint.color",
                        "label": "车漆颜色",
                        "type": "select",
                        "options": [
                            {"value": "red", "label": "红"},
                            {"value": "blue", "label": "蓝"},
                        ],
                    }
                ]
            },
        }
    }
    task_red = await create_task(
        db_session, project_id=project.id, display_id="T-ATTR-RED"
    )
    task_blue = await create_task(
        db_session, project_id=project.id, display_id="T-ATTR-BLUE"
    )
    db_session.add_all(
        [
            Annotation(
                task_id=task_red.id,
                project_id=project.id,
                user_id=owner.id,
                source="manual",
                annotation_type="bbox",
                tool_unit_id="bbox",
                class_name="car",
                geometry={"type": "bbox"},
                attributes={"paint.color": "red"},
            ),
            Annotation(
                task_id=task_blue.id,
                project_id=project.id,
                user_id=owner.id,
                source="prediction_based",
                annotation_type="bbox",
                tool_unit_id="bbox",
                class_name="car",
                geometry={"type": "bbox"},
                attributes={"paint.color": "blue"},
                attributes_meta={"paint.color": {"origin": "ai"}},
            ),
        ]
    )
    await db_session.flush()

    value_response = await httpx_client.post(
        f"/api/v1/projects/{project.id}/tasks/query",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "filter_json": {
                "op": "and",
                "rules": [
                    {
                        "field": "annotation.attribute.bbox.paint.color",
                        "op": "eq",
                        "value": "red",
                    }
                ],
            }
        },
    )
    assert value_response.status_code == 200, value_response.text
    assert [item["id"] for item in value_response.json()["items"]] == [str(task_red.id)]

    origin_response = await httpx_client.post(
        f"/api/v1/projects/{project.id}/tasks/query",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "filter_json": {
                "op": "and",
                "rules": [
                    {
                        "field": "annotation.attribute_origin.bbox.paint.color",
                        "op": "eq",
                        "value": "ai",
                    }
                ],
            }
        },
    )
    assert origin_response.status_code == 200, origin_response.text
    assert [item["id"] for item in origin_response.json()["items"]] == [
        str(task_blue.id)
    ]

    matches_response = await httpx_client.post(
        f"/api/v1/projects/{project.id}/tasks/{task_blue.id}/data-manager/matches",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "filter_json": {
                "op": "and",
                "rules": [
                    {
                        "field": "annotation.attribute_origin.bbox.paint.color",
                        "op": "eq",
                        "value": "ai",
                    }
                ],
            }
        },
    )
    assert matches_response.status_code == 200, matches_response.text
    matches = matches_response.json()
    assert matches["total"] == 1
    assert matches["items"][0]["entity_kind"] == "annotation"
    assert matches["items"][0]["attributes"] == {"paint.color": "blue"}
    assert "geometry" not in matches["items"][0]

    summary_response = await httpx_client.post(
        f"/api/v1/projects/{project.id}/data-manager/summary",
        headers={"Authorization": f"Bearer {token}"},
        json={"filter_json": {}},
    )
    assert summary_response.status_code == 200, summary_response.text
    attribute_summary = summary_response.json()["attributes"][0]
    assert attribute_summary["eligible"] == 2
    assert attribute_summary["present"] == 2
    assert attribute_summary["missing"] == 0
    assert attribute_summary["values"] == {"blue": 1, "red": 1}


async def test_annotation_conditions_in_same_and_group_match_one_object(
    httpx_client: httpx.AsyncClient,
    project_admin,
    db_session: AsyncSession,
):
    owner, token = project_admin
    project = await create_project(db_session, owner_id=owner.id, type_key="image-det")
    cross_object = await create_task(
        db_session, project_id=project.id, display_id="T-CROSS-OBJECT"
    )
    same_object = await create_task(
        db_session, project_id=project.id, display_id="T-SAME-OBJECT"
    )

    def annotation(task_id, class_name: str, source: str) -> Annotation:
        return Annotation(
            task_id=task_id,
            project_id=project.id,
            user_id=owner.id,
            source=source,
            annotation_type="bbox",
            tool_unit_id="bbox",
            class_name=class_name,
            geometry={"type": "bbox"},
        )

    db_session.add_all(
        [
            annotation(cross_object.id, "car", "manual"),
            annotation(cross_object.id, "person", "prediction_based"),
            annotation(same_object.id, "car", "prediction_based"),
        ]
    )
    await db_session.flush()

    response = await httpx_client.post(
        f"/api/v1/projects/{project.id}/tasks/query",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "filter_json": {
                "op": "and",
                "rules": [
                    {"field": "annotation.class_name", "op": "eq", "value": "car"},
                    {
                        "field": "annotation.source",
                        "op": "eq",
                        "value": "prediction_based",
                    },
                ],
            }
        },
    )

    assert response.status_code == 200, response.text
    assert [item["id"] for item in response.json()["items"]] == [str(same_object.id)]


async def test_saved_view_with_removed_attribute_is_listed_as_invalid_and_repairable(
    httpx_client: httpx.AsyncClient,
    project_admin,
    db_session: AsyncSession,
):
    owner, token = project_admin
    project = await create_project(db_session, owner_id=owner.id, type_key="image-det")
    project.tool_bindings = {
        "bbox": {
            "enabled": True,
            "classes": ["car"],
            "attribute_schema": {
                "fields": [{"key": "color", "label": "颜色", "type": "text"}]
            },
        }
    }
    await db_session.flush()

    created = await httpx_client.post(
        f"/api/v1/projects/{project.id}/task-views",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "name": "颜色视图",
            "visibility": "private",
            "filter_json": {
                "op": "and",
                "rules": [
                    {
                        "field": "annotation.attribute.bbox.color",
                        "op": "eq",
                        "value": "red",
                    }
                ],
            },
            "sort_json": [],
            "columns_json": ["display_id"],
        },
    )
    assert created.status_code == 201, created.text
    view_id = created.json()["id"]

    project.tool_bindings = {
        "bbox": {
            "enabled": True,
            "classes": ["car"],
            "attribute_schema": {"fields": []},
        }
    }
    await db_session.flush()

    listed = await httpx_client.get(
        f"/api/v1/projects/{project.id}/task-views",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert listed.status_code == 200, listed.text
    saved = next(item for item in listed.json()["items"] if item["id"] == view_id)
    assert saved["task_count"] is None
    assert saved["invalid_fields"] == ["annotation.attribute.bbox.color"]

    repaired = await httpx_client.patch(
        f"/api/v1/projects/{project.id}/task-views/{view_id}",
        headers={"Authorization": f"Bearer {token}"},
        json={"filter_json": {}},
    )
    assert repaired.status_code == 200, repaired.text


async def test_tracker_candidates_share_task_visibility_and_owner_scope(
    httpx_client: httpx.AsyncClient,
    project_admin,
    annotator,
    db_session: AsyncSession,
):
    owner, owner_token = project_admin
    annotator_user, annotator_token = annotator
    project = await create_project(
        db_session, owner_id=owner.id, type_key="video-track"
    )
    project.data_type = "video"
    db_session.add(
        ProjectMember(
            project_id=project.id,
            user_id=annotator_user.id,
            role="annotator",
            assigned_by=owner.id,
        )
    )
    dataset = Dataset(
        display_id="D-DM-TRACKER",
        name="video",
        data_type="video",
        created_by=owner.id,
    )
    db_session.add(dataset)
    await db_session.flush()
    item = DatasetItem(
        dataset_id=dataset.id,
        file_name="tracker.mp4",
        file_path="tracker.mp4",
        file_type="video",
        metadata_={"video": {"duration_ms": 1000, "frame_count": 30}},
    )
    db_session.add(item)
    await db_session.flush()
    batch = TaskBatch(
        project_id=project.id,
        display_id="B-DM-TRACKER",
        name="tracker",
        status="active",
        annotator_id=annotator_user.id,
        created_by=owner.id,
    )
    db_session.add(batch)
    await db_session.flush()
    task = await create_task(
        db_session, project_id=project.id, display_id="T-DM-TRACKER"
    )
    task.dataset_item_id = item.id
    task.file_name = item.file_name
    task.file_path = item.file_path
    task.file_type = "video"
    task.batch_id = batch.id
    prompt_annotation = Annotation(
        task_id=task.id,
        project_id=project.id,
        user_id=owner.id,
        annotation_type="video_track_bbox",
        tool_unit_id="bbox",
        class_name="car",
        geometry={
            "type": "video_track_bbox",
            "track_id": "trk_prompt",
            "keyframes": [{"frame_index": 0, "source": "manual"}],
        },
        track_id="trk_prompt",
    )
    db_session.add(prompt_annotation)
    await db_session.flush()
    for creator, status in (
        (owner.id, "pending_review"),
        (annotator_user.id, "cancelled"),
    ):
        db_session.add(
            VideoTrackerJob(
                task_id=task.id,
                dataset_item_id=item.id,
                annotation_id=prompt_annotation.id,
                created_by=creator,
                status=status,
                model_key="sam2_video",
                direction="forward",
                from_frame=0,
                to_frame=2,
                prompt={},
                staged_result={"results": [{"frame_index": 1}]},
                event_channel=f"video-tracker-job:{creator}",
            )
        )
    await db_session.flush()

    filter_json = {
        "op": "and",
        "rules": [{"field": "ai.pending_tracker_job_count", "op": "gt", "value": 0}],
    }
    owner_summary = await httpx_client.post(
        f"/api/v1/projects/{project.id}/data-manager/summary",
        headers={"Authorization": f"Bearer {owner_token}"},
        json={"filter_json": filter_json},
    )
    assert owner_summary.status_code == 200, owner_summary.text
    assert owner_summary.json()["ai_review"]["tracker_jobs"] == 2

    annotator_summary = await httpx_client.post(
        f"/api/v1/projects/{project.id}/data-manager/summary",
        headers={"Authorization": f"Bearer {annotator_token}"},
        json={"filter_json": filter_json},
    )
    assert annotator_summary.status_code == 200, annotator_summary.text
    assert annotator_summary.json()["scope"]["matched_task_total"] == 1
    assert annotator_summary.json()["ai_review"]["tracker_jobs"] == 1

    matches = await httpx_client.post(
        f"/api/v1/projects/{project.id}/tasks/{task.id}/data-manager/matches",
        headers={"Authorization": f"Bearer {annotator_token}"},
        json={"filter_json": filter_json},
    )
    assert matches.status_code == 200, matches.text
    assert matches.json()["total"] == 1
    assert matches.json()["items"][0]["entity_kind"] == "tracker_job"


async def test_required_attribute_summary_and_builtin_respect_eligibility(
    httpx_client: httpx.AsyncClient,
    project_admin,
    db_session: AsyncSession,
):
    owner, token = project_admin
    project = await create_project(db_session, owner_id=owner.id, type_key="image-det")
    project.tool_bindings = {
        "bbox": {
            "enabled": True,
            "classes": [{"name": "car"}, {"name": "person"}],
            "attribute_schema": {
                "fields": [
                    {
                        "key": "vehicle",
                        "label": "车辆",
                        "type": "boolean",
                    },
                    {
                        "key": "color",
                        "label": "颜色",
                        "type": "select",
                        "required": True,
                        "applies_to": ["car"],
                        "visible_if": {"key": "vehicle", "equals": True},
                        "options": [{"value": "red", "label": "红"}],
                    },
                ]
            },
        }
    }
    task = await create_task(
        db_session, project_id=project.id, display_id="T-DM-REQUIRED"
    )
    db_session.add_all(
        [
            Annotation(
                task_id=task.id,
                project_id=project.id,
                user_id=owner.id,
                annotation_type="bbox",
                tool_unit_id="bbox",
                class_name="car",
                geometry={"type": "bbox"},
                attributes={"vehicle": True},
            ),
            Annotation(
                task_id=task.id,
                project_id=project.id,
                user_id=owner.id,
                annotation_type="bbox",
                tool_unit_id="bbox",
                class_name="person",
                geometry={"type": "bbox"},
                attributes={},
            ),
        ]
    )
    await db_session.flush()

    summary = await httpx_client.post(
        f"/api/v1/projects/{project.id}/data-manager/summary",
        headers={"Authorization": f"Bearer {token}"},
        json={"filter_json": {}},
    )
    assert summary.status_code == 200, summary.text
    color = next(
        item for item in summary.json()["attributes"] if item["key"] == "color"
    )
    assert color == {
        "tool_unit_id": "bbox",
        "key": "color",
        "label": "颜色",
        "eligible": 1,
        "present": 0,
        "missing": 1,
        "values": {},
    }

    views = await httpx_client.get(
        f"/api/v1/projects/{project.id}/task-views",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert views.status_code == 200, views.text
    missing = next(
        item
        for item in views.json()["items"]
        if item["key"] == "missing-required-attributes"
    )
    assert missing["task_count"] == 1
