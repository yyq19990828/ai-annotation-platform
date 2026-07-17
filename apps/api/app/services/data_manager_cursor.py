"""Compatibility facade for the Data Manager cursor helpers.

The implementation has moved to :mod:`app.services.data_management.cursor` as part of
the v0.23.0 service-domain modularization. Pure re-export facade.
"""

from __future__ import annotations

from app.services.data_management.cursor import (
    decode_cursor,
    encode_cursor,
    keyset_after,
)

__all__ = ["decode_cursor", "encode_cursor", "keyset_after"]
