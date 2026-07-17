"""Compatibility facade for the video tracker runner.

The implementation has moved to :mod:`app.services.video_tracking.runner` as part of the
v0.23.0 service-domain modularization. This module re-exports the previous public
symbols with unchanged object identity so legacy import paths keep working. The runner
now resolves task URLs via :func:`app.services.storage.resolve_task_url` instead of the
former service → API reverse dependency on ``ml_backends._resolve_task_url``.

Pure re-export facade: no logic, no ``import *``.
"""

from __future__ import annotations

from app.services.video_tracking.runner import (
    COMBO_DISCOVERY_WINDOW_FRAMES,
    MAX_TRACKER_STAGED_BYTES,
    TrackerEventPublisher,
    TrackerJobStateConflict,
    accept_tracker_job,
    apply_tracker_results,
    discard_tracker_job,
    publish_tracker_event,
    run_tracker_job,
)

__all__ = [
    "COMBO_DISCOVERY_WINDOW_FRAMES",
    "MAX_TRACKER_STAGED_BYTES",
    "TrackerEventPublisher",
    "TrackerJobStateConflict",
    "accept_tracker_job",
    "apply_tracker_results",
    "discard_tracker_job",
    "publish_tracker_event",
    "run_tracker_job",
]
