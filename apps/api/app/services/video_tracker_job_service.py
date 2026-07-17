"""Compatibility facade for the video tracker job service.

The implementation has moved to :mod:`app.services.video_tracking.jobs` as part of the
v0.23.0 service-domain modularization. This module re-exports the previous public
symbols with unchanged object identity so legacy import paths keep working.

Pure re-export facade: no logic, no ``import *``.
"""

from __future__ import annotations

from app.services.video_tracking.jobs import (
    accept_tracker_job,
    cancel_tracker_job,
    create_tracker_job,
    discard_tracker_job,
    get_tracker_job,
    list_active_tracker_jobs,
    list_reviewable_tracker_jobs,
    tracker_job_out,
)

__all__ = [
    "accept_tracker_job",
    "cancel_tracker_job",
    "create_tracker_job",
    "discard_tracker_job",
    "get_tracker_job",
    "list_active_tracker_jobs",
    "list_reviewable_tracker_jobs",
    "tracker_job_out",
]
