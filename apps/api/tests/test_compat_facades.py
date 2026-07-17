"""Compatibility facade tests for the v0.23.0 service-domain modularization.

Every legacy module that becomes a compatibility facade must preserve the public
object identity and re-export contract declared in the plan (§4.3): ``old is new``
must hold for each re-exported symbol, and the facade must not wrap or shadow.

This module defines a data-driven framework. Each facade lands one entry in
``FACADE_SPECS`` once it exists; the tests then:

1. Assert every declared facade module is importable.
2. Assert every declared new-package module is importable.
3. Assert identity equality for each declared symbol.
4. Spawn **cold** subprocesses to import in both orders (old→new and new→old) and
   confirm no import-time error and that identity still holds (guards against
   ``sys.modules`` caching hiding a split-brain object).

Pre-P1 (no facade yet) all tests skip.
"""

from __future__ import annotations

import subprocess
import sys
import textwrap
from dataclasses import dataclass, field

import pytest

_PROJECT_ROOT_PYTHONPATH = "."  # tests run from apps/api; app/ is on path


@dataclass(frozen=True)
class FacadeSpec:
    """One legacy facade and the symbols it must re-export from the new package."""

    facade_module: str  # e.g. "app.services.gpu_arbiter_store"
    new_module: str  # e.g. "app.services.gpu_arbitration.ledger.store"
    # (symbol, submodule_of_new_module_to_import_from). When the second element is
    # None the symbol is imported from new_module itself.
    symbols: tuple[str, ...] = field(default_factory=tuple)


# Add one entry per facade as it lands.
FACADE_SPECS: tuple[FacadeSpec, ...] = (
    FacadeSpec(
        facade_module="app.services.gpu_arbiter_store",
        new_module="app.services.gpu_arbitration.ledger",
        symbols=(
            "GPUArbiterStore",
            "GPUArbiterStoreError",
            "GPUAllocation",
            "GPUAllocationState",
            "GPUBackendDomainMember",
            "GPUCardSnapshot",
            "GPU_EVICTION_OPERATION",
            "GPU_COLD_ADMISSION_OPERATION",
            "gpu_arbiter_keys",
            "normalize_gpu_backend_max_concurrency",
        ),
    ),
    FacadeSpec(
        facade_module="app.services.video_tracker_adapters",
        new_module="app.services.video_tracking.adapters",
        symbols=("get_tracker_adapter", "TrackerContext", "TrackerFrameResult"),
    ),
    FacadeSpec(
        facade_module="app.services.video_tracker_job_service",
        new_module="app.services.video_tracking.jobs",
        symbols=("create_tracker_job", "get_tracker_job", "cancel_tracker_job"),
    ),
    FacadeSpec(
        facade_module="app.services.video_tracker_runner",
        new_module="app.services.video_tracking.runner",
        symbols=("run_tracker_job", "TrackerJobStateConflict", "accept_tracker_job"),
    ),
    FacadeSpec(
        facade_module="app.services.export",
        new_module="app.services.exporting.service",
        symbols=("ExportService", "UnsupportedExportError"),
    ),
    FacadeSpec(
        facade_module="app.services.export_packaging",
        new_module="app.services.exporting.packaging",
        symbols=("build_export_zip", "clean_export_targets", "ALL_EXPORT_TARGETS"),
    ),
    FacadeSpec(
        facade_module="app.services.export_cache",
        new_module="app.services.exporting.cache",
        symbols=("compute_cache_key", "lookup", "record"),
    ),
    FacadeSpec(
        facade_module="app.services.data_manager",
        new_module="app.services.data_management.service",
        symbols=("DataManagerService", "build_data_manager_schema"),
    ),
    FacadeSpec(
        facade_module="app.services.task_views",
        new_module="app.services.data_management.views",
        symbols=("TaskViewService", "compile_filter", "visible_tasks_stmt"),
    ),
)

_HAS_FACADES = any(
    __import__("importlib").util.find_spec(spec.facade_module) is not None
    and __import__("importlib").util.find_spec(spec.new_module) is not None
    for spec in FACADE_SPECS
)
pytestmark = pytest.mark.skipif(
    not _HAS_FACADES, reason="no facade landed yet (P0 baseline)"
)


@pytest.mark.parametrize("spec", FACADE_SPECS, ids=lambda s: s.facade_module)
def test_facade_identity(spec: FacadeSpec) -> None:
    import importlib

    facade = importlib.import_module(spec.facade_module)
    new = importlib.import_module(spec.new_module)
    for name in spec.symbols:
        old_obj = getattr(facade, name, _Missing)
        new_obj = getattr(new, name, _Missing)
        assert old_obj is not _Missing, (
            f"{spec.facade_module}.{name} missing from facade"
        )
        assert new_obj is not _Missing, (
            f"{spec.new_module}.{name} missing from new module"
        )
        assert old_obj is new_obj, (
            f"{spec.facade_module}.{name} is not {spec.new_module}.{name} "
            "(identity must match; facade must re-export, not wrap)"
        )


class _Missing:
    """Sentinel for missing attributes."""


@pytest.mark.parametrize("spec", FACADE_SPECS, ids=lambda s: s.facade_module)
def test_facade_cold_import_both_orders(spec: FacadeSpec) -> None:
    """Import in old→new and new→old order in fresh processes; identity must hold."""
    if not spec.symbols:
        pytest.skip("no symbols declared")
    symbol = spec.symbols[0]  # one representative symbol is enough for cold-start check
    probe = textwrap.dedent(
        f"""
        import importlib
        m_first = importlib.import_module("{spec.facade_module}")
        m_second = importlib.import_module("{spec.new_module}")
        a = getattr(m_first, "{symbol}")
        b = getattr(m_second, "{symbol}")
        assert a is b, "old->new identity mismatch"
        """
    )
    probe_rev = textwrap.dedent(
        f"""
        import importlib
        m_first = importlib.import_module("{spec.new_module}")
        m_second = importlib.import_module("{spec.facade_module}")
        a = getattr(m_first, "{symbol}")
        b = getattr(m_second, "{symbol}")
        assert a is b, "new->old identity mismatch"
        """
    )
    for label, code in (("old_first", probe), ("new_first", probe_rev)):
        result = subprocess.run(
            [sys.executable, "-c", code],
            cwd=_PROJECT_ROOT_PYTHONPATH,
            capture_output=True,
            text=True,
            env={"PYTHONPATH": _PROJECT_ROOT_PYTHONPATH, "PATH": ""},
        )
        assert result.returncode == 0, (
            f"cold import ({label}) failed:\n"
            f"stdout:\n{result.stdout}\nstderr:\n{result.stderr}"
        )


@pytest.mark.parametrize("spec", FACADE_SPECS, ids=lambda s: s.facade_module)
def test_facade_no_import_star(spec: FacadeSpec) -> None:
    """Facade must use explicit re-export, never ``import *`` (plan §4.3)."""
    import ast
    import pathlib

    parts = spec.facade_module.split(".")
    path = pathlib.Path(*parts).with_suffix(".py")
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    star = [
        n
        for n in ast.walk(tree)
        if isinstance(n, ast.ImportFrom) and any(a.name == "*" for a in n.names)
    ]
    assert not star, f"{spec.facade_module} uses 'import *' (forbidden in facade)"
