"""Compatibility facade for the export service.

The implementation has moved to :mod:`app.services.exporting.service` as part of the
v0.23.0 service-domain modularization. This module re-exports the previous public
symbols with unchanged object identity so legacy import paths keep working.

Pure re-export facade: no logic, no ``import *``.
"""

from __future__ import annotations

from app.services.exporting.service import ExportService, UnsupportedExportError

__all__ = ["ExportService", "UnsupportedExportError"]
