import json
import uuid
import zipfile
from io import BytesIO
from xml.etree import ElementTree

from sqlalchemy import select

from app.db.models.annotation import Annotation
from app.db.models.project import Project
from app.db.models.task import Task
from app.services.export import ExportService


def _tool_bindings() -> dict:
    return {
        "bbox": {
            "enabled": True,
            "classes": [{"name": "car", "order": 0}],
            "attribute_schema": {
                "fields": [{"key": "color", "label": "Color", "type": "text"}]
            },
        }
    }


async def _create_orphan_fixture(db_session, owner_id: uuid.UUID):
    project = Project(
        display_id=f"P-ORPH-{uuid.uuid4().hex[:6]}",
        name="Orphan cleanup",
        type_key="image-det",
        type_label="Image Detection",
        data_type="image",
        owner_id=owner_id,
        tool_bindings=_tool_bindings(),
        total_tasks=1,
    )
    db_session.add(project)
    await db_session.flush()

    task = Task(
        project_id=project.id,
        display_id=f"T-ORPH-{uuid.uuid4().hex[:6]}",
        file_name="image.jpg",
        file_path="dataset/image.jpg",
        file_type="image",
        total_annotations=2,
        is_labeled=True,
        status="in_progress",
    )
    db_session.add(task)
    await db_session.flush()

    valid = Annotation(
        task_id=task.id,
        project_id=project.id,
        user_id=owner_id,
        source="manual",
        annotation_type="bbox",
        tool_unit_id="bbox",
        class_name="car",
        geometry={"type": "bbox", "x": 0.1, "y": 0.2, "w": 0.3, "h": 0.4},
        attributes={"color": "red", "legacy": "stale", "_imported": True},
    )
    orphan_class = Annotation(
        task_id=task.id,
        project_id=project.id,
        user_id=owner_id,
        source="manual",
        annotation_type="bbox",
        tool_unit_id="bbox",
        class_name="dog",
        geometry={"type": "bbox", "x": 0.5, "y": 0.5, "w": 0.2, "h": 0.2},
        attributes={"color": "brown"},
    )
    db_session.add_all([valid, orphan_class])
    await db_session.flush()
    return project, task, valid, orphan_class


async def test_class_usage_and_cleanup_orphans(
    db_session,
    httpx_client,
    auth_headers,
    super_admin,
):
    user, _ = super_admin
    project, task, valid, orphan_class = await _create_orphan_fixture(
        db_session,
        user.id,
    )

    usage = (
        await httpx_client.get(
            f"/api/v1/projects/{project.id}/class-usage",
            headers=auth_headers,
        )
    ).json()
    assert usage["classes"] == {"car": 1, "dog": 1}
    assert usage["attributes"]["color"] == 2
    assert usage["attributes"]["legacy"] == 1

    preview = (
        await httpx_client.post(
            f"/api/v1/projects/{project.id}/cleanup-orphans",
            headers=auth_headers,
            json={"dry_run": True},
        )
    ).json()
    assert preview == {
        "orphan_annotations": 1,
        "orphan_attribute_keys": {"legacy": 1},
    }
    await db_session.refresh(valid)
    await db_session.refresh(orphan_class)
    assert valid.attributes["legacy"] == "stale"
    assert orphan_class.is_active is True

    result = (
        await httpx_client.post(
            f"/api/v1/projects/{project.id}/cleanup-orphans",
            headers=auth_headers,
            json={"dry_run": False},
        )
    ).json()
    assert result == preview

    await db_session.refresh(valid)
    await db_session.refresh(orphan_class)
    await db_session.refresh(task)
    assert orphan_class.is_active is False
    assert valid.attributes == {"color": "red", "_imported": True}
    assert task.total_annotations == 1


async def test_export_skips_orphan_class_and_prunes_orphan_attributes(
    db_session,
    super_admin,
):
    user, _ = super_admin
    project, _task, _valid, _orphan_class = await _create_orphan_fixture(
        db_session,
        user.id,
    )
    svc = ExportService(db_session)

    coco = json.loads(await svc.export_coco(project.id))
    assert [ann["category_id"] for ann in coco["annotations"]] == [0]
    assert coco["annotations"][0]["attributes"] == {"color": "red"}

    yolo_zip = zipfile.ZipFile(BytesIO(await svc.export_yolo(project.id)))
    assert yolo_zip.read("classes.txt").decode() == "car"
    assert yolo_zip.read("labels/image.txt").decode().startswith("0 ")
    assert json.loads(yolo_zip.read("labels/image.attrs.json")) == {
        "attributes": [{"color": "red"}]
    }

    voc_zip = zipfile.ZipFile(BytesIO(await svc.export_voc(project.id)))
    voc_root = ElementTree.fromstring(
        voc_zip.read("Annotations/image.xml").decode(),
    )
    assert [node.text for node in voc_root.findall("./object/name")] == ["car"]
    assert [node.tag for node in voc_root.findall("./object/extra/*")] == ["color"]

    aap = json.loads(await svc.export_aap_json(project.id))
    annotations = aap["tasks"][0]["annotations"]
    assert [ann["class_name"] for ann in annotations] == ["car"]
    assert annotations[0]["attributes"] == {"color": "red"}

    active = (
        (
            await db_session.execute(
                select(Annotation).where(
                    Annotation.project_id == project.id,
                    Annotation.is_active.is_(True),
                )
            )
        )
        .scalars()
        .all()
    )
    assert {ann.class_name for ann in active} == {"car", "dog"}
