"""Strict deployment configuration shared by first-party ML backends."""

from __future__ import annotations

import os


def deployment_verified_flag(name: str) -> bool:
    """Read a deployment qualification gate that accepts only literal 0 or 1."""

    value = os.environ.get(name, "0")
    if value not in {"0", "1"}:
        raise ValueError(f"{name} must be exactly 0 or 1")
    return value == "1"
