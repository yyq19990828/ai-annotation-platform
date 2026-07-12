from __future__ import annotations

import httpx
import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.annotation import Annotation
from app.db.models.dataset import Dataset, DatasetItem, Scene
from app.db.models.project_member import ProjectMember
from tests.factory import create_batch, create_project, create_task


pytestmark = pytest.mark.asyncio


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def test_object_query_uses_annotation_grain_cursor_and_location(
    httpx_client: httpx.AsyncClient,
    project_admin,
    db_session: AsyncSession,
):
    owner, token = project_admin
    project = await create_project(db_session, owner_id=owner.id, type_key="image-det")
    project.tool_bindings = {
        "bbox": {
            "enabled": True,
            "classes": ["car", "person"],
            "attribute_schema": {
                "fields": [{"key": "color", "label": "颜色", "type": "text"}]
            },
        }
    }
    task = await create_task(
        db_session, project_id=project.id, display_id="T-DM-OBJECT"
    )
    annotations = [
        Annotation(
            task_id=task.id,
            project_id=project.id,
            user_id=owner.id,
            source="manual",
            annotation_type="bbox",
            tool_unit_id="bbox",
            class_name="car",
            geometry={"type": "bbox", "x": 0.1, "y": 0.1, "w": 0.2, "h": 0.2},
            attributes={"color": "red"},
            attributes_meta={"color": {"origin": "ai"}},
        ),
        Annotation(
            task_id=task.id,
            project_id=project.id,
            user_id=owner.id,
            source="manual",
            annotation_type="bbox",
            tool_unit_id="bbox",
            class_name="person",
            geometry={"type": "bbox", "x": 0.4, "y": 0.4, "w": 0.1, "h": 0.1},
            attributes={"color": "blue"},
        ),
        Annotation(
            task_id=task.id,
            project_id=project.id,
            user_id=owner.id,
            source="manual",
            annotation_type="bbox",
            tool_unit_id="bbox",
            class_name="car",
            geometry={"type": "bbox", "x": 0.6, "y": 0.6, "w": 0.1, "h": 0.1},
            attributes={"color": "red"},
        ),
    ]
    db_session.add_all(annotations)
    await db_session.flush()

    payload = {
        "filter_json": {
            "op": "and",
            "rules": [
                {"field": "annotation.class_name", "op": "eq", "value": "car"},
                {
                    "field": "annotation.attribute.bbox.color",
                    "op": "eq",
                    "value": "red",
                },
            ],
        },
        "sort_json": [{"field": "annotation.class_name", "direction": "asc"}],
        "columns_json": ["class_name", "attributes", "task_location"],
        "limit": 1,
    }
    response = await httpx_client.post(
        f"/api/v1/projects/{project.id}/data-manager/objects/query",
        headers=_auth(token),
        json=payload,
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["total"] == 2
    assert "geometry" not in body["items"][0]
    assert body["next_cursor"]

    next_page = await httpx_client.post(
        f"/api/v1/projects/{project.id}/data-manager/objects/query",
        headers=_auth(token),
        json={**payload, "cursor": body["next_cursor"]},
    )
    assert next_page.status_code == 200, next_page.text
    assert {
        body["items"][0]["annotation_id"],
        next_page.json()["items"][0]["annotation_id"],
    } == {str(annotations[0].id), str(annotations[2].id)}
    by_id = {
        item["annotation_id"]: item
        for item in [*body["items"], *next_page.json()["items"]]
    }
    assert by_id[str(annotations[0].id)]["attribute_origins"] == {"color": "ai"}

    location = await httpx_client.get(
        f"/api/v1/projects/{project.id}/data-manager/objects/{annotations[0].id}/location",
        headers=_auth(token),
    )
    assert location.status_code == 200, location.text
    assert location.json()["task_id"] == str(task.id)
    assert location.json()["annotation_id"] == str(annotations[0].id)


async def test_object_query_facets_and_detail_share_batch_visibility(
    httpx_client: httpx.AsyncClient,
    project_admin,
    annotator,
    reviewer,
    db_session: AsyncSession,
):
    owner, _ = project_admin
    annotator_user, annotator_token = annotator
    reviewer_user, _ = reviewer
    project = await create_project(db_session, owner_id=owner.id, type_key="image-det")
    project.tool_bindings = {
        "bbox": {"enabled": True, "classes": ["visible", "hidden"]}
    }
    db_session.add(
        ProjectMember(
            project_id=project.id,
            user_id=annotator_user.id,
            role="annotator",
        )
    )
    visible_batch = await create_batch(
        db_session, project_id=project.id, status="active"
    )
    visible_batch.annotator_id = annotator_user.id
    hidden_batch = await create_batch(
        db_session, project_id=project.id, status="active"
    )
    hidden_batch.annotator_id = reviewer_user.id
    visible_task = await create_task(
        db_session, project_id=project.id, display_id="T-DM-VISIBLE"
    )
    visible_task.batch_id = visible_batch.id
    hidden_task = await create_task(
        db_session, project_id=project.id, display_id="T-DM-HIDDEN"
    )
    hidden_task.batch_id = hidden_batch.id
    visible_object = Annotation(
        task_id=visible_task.id,
        project_id=project.id,
        user_id=owner.id,
        source="manual",
        annotation_type="bbox",
        tool_unit_id="bbox",
        class_name="visible",
        geometry={"type": "bbox", "x": 0.1, "y": 0.1, "w": 0.2, "h": 0.2},
    )
    hidden_object = Annotation(
        task_id=hidden_task.id,
        project_id=project.id,
        user_id=owner.id,
        source="prediction_based",
        annotation_type="bbox",
        tool_unit_id="bbox",
        class_name="hidden",
        geometry={"type": "bbox", "x": 0.3, "y": 0.3, "w": 0.2, "h": 0.2},
    )
    db_session.add_all([visible_object, hidden_object])
    await db_session.flush()

    response = await httpx_client.post(
        f"/api/v1/projects/{project.id}/data-manager/objects/query",
        headers=_auth(annotator_token),
        json={"filter_json": {}, "columns_json": ["class_name", "task_location"]},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["total"] == 1
    assert body["facets"]["matched_total"] == 1
    assert body["facets"]["task_total"] == 1
    assert body["facets"]["by_class"] == {"visible": 1}
    assert body["facets"]["by_source"] == {"manual": 1}
    assert body["items"][0]["annotation_id"] == str(visible_object.id)

    hidden_location = await httpx_client.get(
        f"/api/v1/projects/{project.id}/data-manager/objects/{hidden_object.id}/location",
        headers=_auth(annotator_token),
    )
    assert hidden_location.status_code == 404
    hidden_detail = await httpx_client.get(
        f"/api/v1/projects/{project.id}/data-manager/objects/{hidden_object.id}/detail",
        headers=_auth(annotator_token),
    )
    assert hidden_detail.status_code == 404


async def test_compact_video_track_is_one_row_and_detail_lists_keyframes(
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
        "bbox": {"enabled": True, "classes": ["car"], "video_modes": {"track": True}}
    }
    task = await create_task(
        db_session, project_id=project.id, display_id="T-DM-COMPACT"
    )
    task.file_type = "video"
    track = Annotation(
        task_id=task.id,
        project_id=project.id,
        user_id=owner.id,
        source="ai_tracker",
        annotation_type="video_track_bbox",
        tool_unit_id="bbox",
        class_name="car",
        track_id="trk_compact",
        geometry={
            "type": "video_track_bbox",
            "track_id": "trk_compact",
            "keyframes": [
                {
                    "frame_index": 2,
                    "bbox": {"x": 0.1, "y": 0.1, "w": 0.2, "h": 0.2},
                    "source": "manual",
                },
                {
                    "frame_index": 8,
                    "bbox": {"x": 0.2, "y": 0.2, "w": 0.2, "h": 0.2},
                    "source": "prediction",
                    "occluded": True,
                },
            ],
            "outside": [{"start_frame": 5, "end_frame": 6}],
        },
    )
    db_session.add(track)
    await db_session.flush()

    response = await httpx_client.post(
        f"/api/v1/projects/{project.id}/data-manager/tracks/query",
        headers=_auth(token),
        json={
            "filter_json": {},
            "sort_json": [{"field": "track.track_id", "direction": "asc"}],
            "columns_json": ["track_id", "range", "coverage", "visibility"],
        },
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["total"] == 1
    row = body["items"][0]
    assert row["keyframe_count"] == 2
    assert row["occurrence_count"] == 1
    assert row["start_frame"] == 2
    assert row["end_frame"] == 8
    assert row["occluded_count"] == 1
    assert row["outside_range_count"] == 1
    assert "geometry" not in row

    detail = await httpx_client.get(
        f"/api/v1/projects/{project.id}/data-manager/tracks/{row['track_ref']}/detail",
        headers=_auth(token),
    )
    assert detail.status_code == 200, detail.text
    assert [item["frame_index"] for item in detail.json()["members"]] == [2, 8]


async def test_scene_track_aggregates_visible_occurrences_and_duplicate_frame(
    httpx_client: httpx.AsyncClient,
    project_admin,
    db_session: AsyncSession,
):
    owner, token = project_admin
    project = await create_project(db_session, owner_id=owner.id, type_key="image-det")
    project.data_type = "image"
    project.scene_mode = True
    project.tool_bindings = {"bbox": {"enabled": True, "classes": ["car"]}}
    dataset = Dataset(
        display_id="D-DM-ENTITY-SCENE",
        name="scene dataset",
        data_type="image",
        is_temporal=True,
        created_by=owner.id,
    )
    db_session.add(dataset)
    await db_session.flush()
    scene = Scene(
        display_id="S-DM-ENTITY-SCENE",
        dataset_id=dataset.id,
        name="street",
        created_by=owner.id,
    )
    db_session.add(scene)
    await db_session.flush()
    items = [
        DatasetItem(
            dataset_id=dataset.id,
            file_name=f"frame-{frame}.jpg",
            file_path=f"frame-{frame}.jpg",
            file_type="image",
            scene_id=scene.id,
            frame_index=frame,
        )
        for frame in (0, 1, 2)
    ]
    db_session.add_all(items)
    await db_session.flush()
    tasks = []
    for frame, item in enumerate(items):
        task = await create_task(
            db_session,
            project_id=project.id,
            display_id=f"T-DM-SCENE-{frame}",
        )
        task.dataset_item_id = item.id
        tasks.append(task)
    await db_session.flush()
    for index, task in enumerate(tasks):
        db_session.add(
            Annotation(
                task_id=task.id,
                project_id=project.id,
                user_id=owner.id,
                source="manual" if index < 2 else "interpolated",
                annotation_type="bbox",
                tool_unit_id="bbox",
                class_name="car",
                track_id="trk_scene",
                geometry={"type": "bbox", "x": 0.1, "y": 0.1, "w": 0.2, "h": 0.2},
            )
        )
    db_session.add(
        Annotation(
            task_id=tasks[1].id,
            project_id=project.id,
            user_id=owner.id,
            source="manual",
            annotation_type="bbox",
            tool_unit_id="bbox",
            class_name="car",
            track_id="trk_scene",
            geometry={"type": "bbox", "x": 0.3, "y": 0.3, "w": 0.1, "h": 0.1},
        )
    )
    await db_session.flush()

    response = await httpx_client.post(
        f"/api/v1/projects/{project.id}/data-manager/tracks/query",
        headers=_auth(token),
        json={"filter_json": {}, "columns_json": ["track_id", "coverage", "quality"]},
    )
    assert response.status_code == 200, response.text
    row = response.json()["items"][0]
    assert response.json()["total"] == 1
    assert row["occurrence_count"] == 4
    assert row["distinct_task_count"] == 3
    assert row["distinct_frame_count"] == 3
    assert row["duplicate_frame_count"] == 1
    assert "duplicate_frame" in row["quality_issues"]

    detail = await httpx_client.get(
        f"/api/v1/projects/{project.id}/data-manager/tracks/{row['track_ref']}/detail",
        headers=_auth(token),
    )
    assert detail.status_code == 200, detail.text
    assert len(detail.json()["members"]) == 4


async def test_saved_views_are_partitioned_by_entity_scope(
    httpx_client: httpx.AsyncClient,
    project_admin,
    db_session: AsyncSession,
):
    owner, token = project_admin
    project = await create_project(db_session, owner_id=owner.id, type_key="image-det")
    await create_task(db_session, project_id=project.id, display_id="T-DM-VIEW")
    await db_session.flush()
    payload = {
        "name": "全部",
        "visibility": "private",
        "filter_json": {},
        "sort_json": [{"field": "annotation.updated_at", "direction": "desc"}],
        "columns_json": ["class_name", "task_location"],
        "entity_scope": "objects",
    }
    created = await httpx_client.post(
        f"/api/v1/projects/{project.id}/task-views",
        headers=_auth(token),
        json=payload,
    )
    assert created.status_code == 201, created.text
    assert created.json()["entity_scope"] == "objects"

    object_views = await httpx_client.get(
        f"/api/v1/projects/{project.id}/task-views?entity_scope=objects",
        headers=_auth(token),
    )
    assert object_views.status_code == 200, object_views.text
    assert any(item["name"] == "全部" for item in object_views.json()["items"])
    assert all(
        item["entity_scope"] == "objects" for item in object_views.json()["items"]
    )
    task_views = await httpx_client.get(
        f"/api/v1/projects/{project.id}/task-views",
        headers=_auth(token),
    )
    assert task_views.status_code == 200, task_views.text
    assert not any(item["name"] == "全部" for item in task_views.json()["items"])
