"""Compatibility facade for the video tracker adapters.

The implementation has moved to :mod:`app.services.video_tracking.adapters` as part of
the v0.23.0 service-domain modularization. This module re-exports the previous public
symbols with unchanged object identity so legacy import paths keep working.

Pure re-export facade: no logic, no ``import *``.
"""

from __future__ import annotations

from app.services.video_tracking.adapters import (
    MLBackendVideoTrackerAdapter,
    MockBboxTrackerAdapter,
    TrackerAdapter,
    TrackerContext,
    TrackerFrameResult,
    get_tracker_adapter,
    registered_tracker_models,
)

__all__ = [
    "MLBackendVideoTrackerAdapter",
    "MockBboxTrackerAdapter",
    "TrackerAdapter",
    "TrackerContext",
    "TrackerFrameResult",
    "get_tracker_adapter",
    "registered_tracker_models",
]
