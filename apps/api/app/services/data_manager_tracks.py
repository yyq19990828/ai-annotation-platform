"""Compatibility facade for the Data Manager track service.

The implementation has moved to :mod:`app.services.data_management.tracks` as part of
the v0.23.0 service-domain modularization. Pure re-export facade.
"""

from __future__ import annotations

from app.services.data_management.tracks import DataManagerTrackService

__all__ = ["DataManagerTrackService"]
