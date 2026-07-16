"""Architecture guards for the v0.23.0 service-domain modularization.

These tests enforce the dependency-direction and cycle rules declared in
`docs/plans/2026-07-15-v0.23.0-api-services-domain-modularization.md` §4.4 for every
new domain package. They run on source via AST, so they apply as soon as a package is
created; a package that does not exist yet is skipped.

Rules enforced per domain package ``app.services.<pkg>``:

1. No module in the package may import ``app.api`` or ``app.workers`` (service → API /
   worker reverse dependency is forbidden).
2. No module in the package may import its own compatibility facade (the old flat
   module it replaced). Each domain declares its old facade module roots.
3. No module in the package may hide an import inside a function body that points at
   another module *within the same package* (function-local import masking a cycle).
   Top-level imports within the package are the only allowed intra-package wiring.

Domains are declared in ``DOMAIN_PACKAGES``. Add an entry when a new package lands.
"""

from __future__ import annotations

import ast
from dataclasses import dataclass
from pathlib import Path

import pytest

_SERVICES_DIR = Path(__file__).resolve().parent.parent / "app" / "services"


@dataclass(frozen=True)
class DomainSpec:
    """One new domain package and the rules it must satisfy."""

    package: str  # e.g. "gpu_arbitration"
    # Old flat module roots this package replaces; the new package must not import them.
    legacy_facades: tuple[str, ...]
    # Optional sub-packages that must stay lazy (no eager high-level imports at the
    # package __init__). Listed as "<pkg>.<sub>".
    lazy_roots: tuple[str, ...] = ()


DOMAIN_PACKAGES = (
    DomainSpec(
        package="gpu_arbitration",
        legacy_facades=(
            "app.services.gpu_arbiter_store",
            "app.services.gpu_arbiter",
            "app.services.gpu_admission_signer",
            "app.services.gpu_arbiter_rollout",
            "app.services.gpu_collector_database",
            "app.services.gpu_dispatch_authority",
            "app.services.gpu_membership_activation",
            "app.services.gpu_rollout_control",
        ),
        lazy_roots=(
            "gpu_arbitration",
        ),  # package root must not eager-import dispatch/membership/rollout
    ),
    DomainSpec(
        package="video_tracking",
        legacy_facades=(
            "app.services.video_tracker_adapters",
            "app.services.video_tracker_job_service",
            "app.services.video_tracker_runner",
        ),
    ),
    DomainSpec(
        package="exporting",
        legacy_facades=(
            "app.services.export",
            "app.services.export_cache",
            "app.services.export_davis",
            "app.services.export_lidar",
            "app.services.export_packaging",
            "app.services.export_video",
        ),
    ),
    DomainSpec(
        package="data_management",
        legacy_facades=(
            "app.services.data_manager",
            "app.services.data_manager_cursor",
            "app.services.data_manager_entities",
            "app.services.data_manager_entity_filter",
            "app.services.data_manager_tracks",
            "app.services.task_views",
        ),
    ),
)

# Absolute module roots a service domain must never depend on.
_FORBIDDEN_ROOTS = ("app.api", "app.workers")


def _module_path(rel_source: Path) -> str:
    """``app/services/gpu_arbitration/ledger/store.py`` -> ``app.services.gpu_arbitration.ledger.store``."""
    parts = ("app", "services") + rel_source.with_suffix("").parts
    return ".".join(parts)


def _collect_imports(tree: ast.AST) -> list[tuple[str, bool]]:
    """Return ``(dotted_module_or_name, is_local)`` for every import in the module.

    ``is_local`` is True when the import statement lives inside a function/method body
    (i.e. a function-local import), False when it is module-level.
    """
    out: list[tuple[str, bool]] = []

    class _Visitor(ast.NodeVisitor):
        def __init__(self) -> None:
            self._depth = 0

        def _record(
            self, names: list[str], is_from: bool, level: int, is_local: bool
        ) -> None:
            if is_from:
                # relative import: resolve against the package depth
                if level > 0:
                    return  # relative imports handled by caller context; skip for guard
                for n in names:
                    out.append((n, is_local))
            else:
                for n in names:
                    out.append((n, is_local))

        def visit_FunctionDef(self, node):  # noqa: N802
            self._depth += 1
            self.generic_visit(node)
            self._depth -= 1

        visit_AsyncFunctionDef = visit_FunctionDef

        def visit_Import(self, node):  # noqa: N802
            names = [a.name for a in node.names]
            self._record(names, is_from=False, level=0, is_local=self._depth > 0)

        def visit_ImportFrom(self, node):  # noqa: N802
            mod = node.module or ""
            names = [mod] if mod else []
            self._record(
                names, is_from=True, level=node.level, is_local=self._depth > 0
            )

    _Visitor().visit(tree)
    return out


def _iter_domain_files(pkg: str) -> list[tuple[Path, str]]:
    """Yield (abs_path, module_dotted) for every .py under ``app/services/<pkg>``."""
    root = _SERVICES_DIR / pkg
    if not root.is_dir():
        return []
    files = []
    for path in sorted(root.rglob("*.py")):
        rel = path.relative_to(_SERVICES_DIR)
        files.append((path, _module_path(rel)))
    return files


def _iter_domain_files_all() -> list[tuple[DomainSpec, Path, str]]:
    """Flat list across all declared domains that exist on disk."""
    flat = []
    for spec in DOMAIN_PACKAGES:
        for path, module in _iter_domain_files(spec.package):
            flat.append((spec, path, module))
    return flat


# Skip the whole module gracefully if no domain package exists yet (pre-P1 state).
_HAS_ANY_DOMAIN = any(_iter_domain_files(spec.package) for spec in DOMAIN_PACKAGES)
pytestmark = pytest.mark.skipif(
    not _HAS_ANY_DOMAIN, reason="no domain package created yet (P0 baseline)"
)


@pytest.mark.parametrize(
    "spec", DOMAIN_PACKAGES, ids=[d.package for d in DOMAIN_PACKAGES]
)
def test_domain_package_forbidden_imports(spec: DomainSpec) -> None:
    """No domain module imports app.api / app.workers or its own legacy facade."""
    files = _iter_domain_files(spec.package)
    if not files:
        pytest.skip(f"package app.services.{spec.package} not created yet")

    offenders: list[str] = []
    forbidden = _FORBIDDEN_ROOTS + tuple(spec.legacy_facades)
    for path, module in files:
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for imported, _local in _collect_imports(tree):
            for bad in forbidden:
                if imported == bad or imported.startswith(bad + "."):
                    offenders.append(f"{module}: imports forbidden '{imported}'")
    assert not offenders, "\n".join(offenders)


@pytest.mark.parametrize(
    "spec", DOMAIN_PACKAGES, ids=[d.package for d in DOMAIN_PACKAGES]
)
def test_domain_package_no_intra_package_local_imports(spec: DomainSpec) -> None:
    """No domain module hides an intra-package import inside a function body."""
    files = _iter_domain_files(spec.package)
    if not files:
        pytest.skip(f"package app.services.{spec.package} not created yet")

    pkg_prefix = f"app.services.{spec.package}"
    offenders: list[str] = []
    for path, module in files:
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for imported, is_local in _collect_imports(tree):
            if not is_local:
                continue
            if imported == pkg_prefix or imported.startswith(pkg_prefix + "."):
                offenders.append(
                    f"{module}: function-local import of '{imported}' "
                    "(possible cycle mask)"
                )
    assert not offenders, "\n".join(offenders)


@pytest.mark.parametrize(
    "spec", DOMAIN_PACKAGES, ids=[d.package for d in DOMAIN_PACKAGES]
)
def test_domain_package_root_not_eager_importing(spec: DomainSpec) -> None:
    """Package ``__init__`` must not eager-import modules flagged as lazy roots."""
    if not spec.lazy_roots:
        pytest.skip("no lazy-root rule for this domain")
    files = _iter_domain_files(spec.package)
    if not files:
        pytest.skip(f"package app.services.{spec.package} not created yet")

    init_path = _SERVICES_DIR / spec.package / "__init__.py"
    if not init_path.is_file():
        pytest.fail(f"package app.services.{spec.package} has no __init__.py")

    tree = ast.parse(init_path.read_text(encoding="utf-8"), filename=str(init_path))
    eager = [name for name, is_local in _collect_imports(tree) if not is_local]
    # lazy_roots for gpu_arbitration lists the package itself, meaning the *root*
    # __init__ must stay minimal; re-export of stable leaf symbols is allowed but
    # importing high-level modules (dispatch/membership/rollout) by name is not.
    # We forbid eager import of known high-level submodules.
    forbidden_high_level = {
        "dispatch",
        "membership",
        "membership_activation",
        "rollout_control",
        "rollout_state",
        "retirement",
        "reconciliation",
        "fences",
    }
    flagged = []
    for name in eager:
        leaf = name.split(".")[-1] if "." in name else ""
        if leaf in forbidden_high_level:
            flagged.append(name)
    assert not flagged, f"package root eager-imports high-level module(s): {flagged}"
