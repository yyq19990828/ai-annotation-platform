"""Pure tests for project-scoped notification delivery gating (B3).

No database: only the payload-to-project extraction contract is exercised here.
The batched membership recheck runs against PostgreSQL in the API suite.
"""

from __future__ import annotations

import uuid
from types import SimpleNamespace

from app.services.notification import _notification_project_id


def _row(payload):
    return SimpleNamespace(payload=payload)


def test_project_id_extracted_from_payload():
    project_id = uuid.uuid4()
    assert _notification_project_id(_row({"project_id": str(project_id)})) == project_id


def test_discussion_payload_project_scope():
    project_id = uuid.uuid4()
    row = _row({"project_id": str(project_id), "task_id": str(uuid.uuid4())})
    assert _notification_project_id(row) == project_id


def test_non_project_payload_is_ungated():
    assert _notification_project_id(_row({"kind": "audit_archive"})) is None
    assert _notification_project_id(_row({})) is None
    assert _notification_project_id(_row(None)) is None


def test_malformed_project_id_is_ungated():
    assert _notification_project_id(_row({"project_id": "not-a-uuid"})) is None
