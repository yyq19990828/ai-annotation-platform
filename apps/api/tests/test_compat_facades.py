"""Compatibility facade tests for the v0.23.0 service-domain modularization.

Every legacy module that becomes a compatibility facade must preserve the public
object identity and re-export contract declared in the plan (§4.3): ``old is new``
must hold for each independently frozen symbol/source mapping, and the facade must
not wrap or shadow.

This module defines a data-driven framework. Each facade lands one entry in
``FACADE_SPECS`` once it exists; the tests then:

1. Assert every declared facade module is importable.
2. Assert every independently declared implementation module is importable.
3. Assert the facade ``__all__`` exactly matches the frozen 123-symbol manifest.
4. Assert identity equality for each frozen symbol and exact implementation source.
5. Spawn **cold** subprocesses to import in both orders (old→new and new→old) and
   confirm no import-time error and that identity still holds (guards against
   ``sys.modules`` caching hiding a split-brain object).
6. Spawn separate cold processes that import each real API/worker/service consumer
   directly, without preloading either facade or implementation modules.
"""

from __future__ import annotations

import ast
import os
import subprocess
import sys
import textwrap
from dataclasses import dataclass
from pathlib import Path

import pytest

_PROJECT_ROOT_PYTHONPATH = "."  # tests run from apps/api; app/ is on path


@dataclass(frozen=True)
class ExportGroup:
    """Frozen public symbols whose objects are defined by one implementation module."""

    module: str
    names: tuple[str, ...]


@dataclass(frozen=True)
class FacadeSpec:
    """One legacy facade and its independently frozen re-export contract."""

    facade_module: str
    public_module: str
    exports: tuple[ExportGroup, ...]
    consumer_modules: tuple[str, ...]

    @property
    def implementation_modules(self) -> tuple[str, ...]:
        return tuple(group.module for group in self.exports)

    @property
    def expected_names(self) -> tuple[str, ...]:
        return tuple(name for group in self.exports for name in group.names)


def _exports(module: str, *names: str) -> ExportGroup:
    return ExportGroup(module=module, names=tuple(names))


FACADE_SPECS: tuple[FacadeSpec, ...] = (
    FacadeSpec(
        facade_module="app.services.gpu_arbiter_store",
        public_module="app.services.gpu_arbitration.ledger",
        exports=(
            _exports(
                "app.services.gpu_arbitration.ledger.keys",
                "GPUArbiterKeys",
                "gpu_arbiter_keys",
            ),
            _exports(
                "app.services.gpu_arbitration.ledger.store",
                "GPUArbiterStore",
            ),
            _exports(
                "app.services.gpu_arbitration.ledger.types",
                "GPU_COLD_ADMISSION_OPERATION",
                "GPU_EVICTION_OPERATION",
                "GPUAdmissionResult",
                "GPUAllocation",
                "GPUAllocationState",
                "GPUArbiterStoreError",
                "GPUBackendDomainEvolutionResult",
                "GPUBackendDomainMember",
                "GPUBackendMembershipState",
                "GPUCardSnapshot",
                "GPUEvictionBranchResult",
                "GPUIdleEvictionResult",
                "GPULeaseMutationResult",
                "GPUProofResetCAS",
                "GPUProofResetContext",
                "GPUQueueResult",
                "GPUQueueTicket",
                "GPUReconcileLeaseCleanup",
                "GPUReconcileResult",
                "GPURequestLease",
                "GPURequestLeaseState",
                "GPUTombstoneGCReceipt",
                "GPUTombstoneGCResult",
                "GPUTransitionOwnerResult",
                "GPUTransitionResult",
            ),
            _exports(
                "app.services.gpu_arbitration.ledger.validation",
                "normalize_gpu_backend_max_concurrency",
            ),
        ),
        consumer_modules=(
            "app.api.v1.admin_ml_integrations",
            "app.services.gpu_arbiter",
            "app.services.gpu_dispatch_authority",
            "app.workers.ml_health",
        ),
    ),
    FacadeSpec(
        facade_module="app.services.gpu_admission_signer",
        public_module="app.services.gpu_arbitration.signing",
        exports=(
            _exports(
                "app.services.gpu_arbitration.signing",
                "GPUAdmissionSignerConfigError",
                "GPUAdmissionTokenSigner",
            ),
        ),
        consumer_modules=(
            "app.services.gpu_dispatch_authority",
            "app.services.gpu_membership_activation",
            "app.services.gpu_rollout_control",
            "scripts.validate_gpu_arbitration",
        ),
    ),
    FacadeSpec(
        facade_module="app.services.gpu_arbiter_rollout",
        public_module="app.services.gpu_arbitration.rollout_state",
        exports=(
            _exports(
                "app.services.gpu_arbitration.rollout_state",
                "GPUArbiterRolloutConflict",
                "GPUArbiterRolloutDecision",
                "GPUArbiterRolloutSnapshot",
                "GPUArbiterRolloutUnavailable",
                "begin_gpu_arbiter_rollout",
                "block_gpu_arbiter_rollout",
                "classify_gpu_arbiter_rollout",
                "complete_gpu_arbiter_rollout",
                "gpu_arbiter_rollout_snapshot",
                "gpu_rollout_boundary_active",
                "read_gpu_arbiter_rollout",
                "read_gpu_arbiter_rollouts",
                "resolve_gpu_arbiter_rollout",
            ),
        ),
        consumer_modules=(
            "app.api.v1.admin_ml_integrations",
            "app.services.ml_client",
            "app.workers.ml_health",
        ),
    ),
    FacadeSpec(
        facade_module="app.services.gpu_collector_database",
        public_module="app.services.gpu_arbitration.collector_database",
        exports=(
            _exports(
                "app.services.gpu_arbitration.collector_database",
                "GPUCollectorDatabase",
                "GPUCollectorDatabaseConfigError",
                "load_gpu_collector_database_url",
                "open_gpu_collector_database",
                "validate_gpu_collector_role_boundary",
            ),
        ),
        consumer_modules=("app.workers.ml_health",),
    ),
    FacadeSpec(
        facade_module="app.services.video_tracker_adapters",
        public_module="app.services.video_tracking.adapters",
        exports=(
            _exports(
                "app.services.video_tracking.adapters",
                "MLBackendVideoTrackerAdapter",
                "MockBboxTrackerAdapter",
                "TrackerAdapter",
                "TrackerContext",
                "TrackerFrameResult",
                "get_tracker_adapter",
                "registered_tracker_models",
            ),
        ),
        consumer_modules=(
            "app.api.v1.tasks.video",
            "app.api.v1.video_tracker_jobs",
            "app.workers.video_tracker",
        ),
    ),
    FacadeSpec(
        facade_module="app.services.video_tracker_job_service",
        public_module="app.services.video_tracking.jobs",
        exports=(
            _exports(
                "app.services.video_tracking.jobs",
                "accept_tracker_job",
                "cancel_tracker_job",
                "create_tracker_job",
                "discard_tracker_job",
                "get_tracker_job",
                "list_active_tracker_jobs",
                "list_reviewable_tracker_jobs",
                "tracker_job_out",
            ),
        ),
        consumer_modules=(
            "app.api.v1.tasks.video",
            "app.api.v1.video_tracker_jobs",
            "app.workers.video_tracker",
        ),
    ),
    FacadeSpec(
        facade_module="app.services.video_tracker_runner",
        public_module="app.services.video_tracking.runner",
        exports=(
            _exports(
                "app.services.video_tracking.runner",
                "COMBO_DISCOVERY_WINDOW_FRAMES",
                "MAX_TRACKER_STAGED_BYTES",
                "TrackerEventPublisher",
                "TrackerJobStateConflict",
                "accept_tracker_job",
                "apply_tracker_results",
                "discard_tracker_job",
                "publish_tracker_event",
                "run_tracker_job",
            ),
        ),
        consumer_modules=(
            "app.api.v1.tasks.video",
            "app.api.v1.video_tracker_jobs",
            "app.workers.video_tracker",
        ),
    ),
    FacadeSpec(
        facade_module="app.services.export",
        public_module="app.services.exporting.service",
        exports=(
            _exports(
                "app.services.exporting.service",
                "ExportService",
                "UnsupportedExportError",
            ),
        ),
        consumer_modules=(
            "app.api.v1.batches",
            "app.api.v1.projects",
            "app.workers.export",
        ),
    ),
    FacadeSpec(
        facade_module="app.services.export_packaging",
        public_module="app.services.exporting.packaging",
        exports=(
            _exports(
                "app.services.exporting.packaging",
                "ALL_EXPORT_TARGETS",
                "IMAGE_EXPORT_TARGETS",
                "LIDAR_EXPORT_TARGETS",
                "PRESIGN_EXPIRES_SECONDS",
                "VIDEO_EXPORT_FORMATS",
                "YOLO_TARGETS",
                "build_export_zip",
                "clean_export_targets",
                "relative_path_from_file_path",
            ),
        ),
        consumer_modules=(
            "app.api.v1.batches",
            "app.api.v1.projects",
            "app.workers.export",
        ),
    ),
    FacadeSpec(
        facade_module="app.services.export_cache",
        public_module="app.services.exporting.cache",
        exports=(
            _exports(
                "app.services.exporting.cache",
                "compute_cache_key",
                "lookup",
                "record",
            ),
        ),
        consumer_modules=(
            "app.api.v1.batches",
            "app.api.v1.projects",
            "app.workers.export",
        ),
    ),
    FacadeSpec(
        facade_module="app.services.export_video",
        public_module="app.services.exporting.video",
        exports=(
            _exports(
                "app.services.exporting.video",
                "VIDEO_SINGLE_FRAME_GEOMETRY_TYPES",
                "VIDEO_TRACK_GEOMETRY_TYPES",
                "build_coco_frames_seg",
                "build_kitti_labels",
                "build_mot_gt",
                "build_mot_seqinfo",
                "build_yolo_frame_det_labels",
                "build_yolo_frame_seg_labels",
                "effective_fps",
                "points_to_bbox_norm",
                "single_frame_bbox",
                "source_to_grid",
                "track_grid_rows",
                "yolo_seg_line",
            ),
        ),
        consumer_modules=(
            "app.api.v1.batches",
            "app.api.v1.projects",
            "app.workers.export",
        ),
    ),
    FacadeSpec(
        facade_module="app.services.export_lidar",
        public_module="app.services.exporting.lidar",
        exports=(
            _exports(
                "app.services.exporting.lidar",
                "BoxExportAttrs",
                "LidarFrameExportCtx",
                "build_kitti_lidar_label_lines",
                "build_nuscenes_frame_records",
                "build_pointmask_label_bytes",
                "category_map_json",
            ),
        ),
        consumer_modules=(
            "app.api.v1.batches",
            "app.api.v1.projects",
            "app.workers.export",
        ),
    ),
    FacadeSpec(
        facade_module="app.services.export_davis",
        public_module="app.services.exporting.davis",
        exports=(
            _exports(
                "app.services.exporting.davis",
                "DAVIS_MAX_OBJECTS",
                "build_davis_palette_png",
                "davis_palette",
                "derive_davis_object_ids",
            ),
        ),
        consumer_modules=(
            "app.api.v1.batches",
            "app.api.v1.projects",
            "app.workers.export",
        ),
    ),
    FacadeSpec(
        facade_module="app.services.data_manager",
        public_module="app.services.data_management.service",
        exports=(
            _exports(
                "app.services.data_management.service",
                "DataManagerService",
            ),
            _exports(
                "app.services.data_management.schema",
                "build_data_manager_schema",
            ),
            _exports(
                "app.services.data_management.task_metrics",
                "LOW_CONFIDENCE_THRESHOLD",
                "low_confidence_pending_prediction_shapes_expr",
                "pending_prediction_shapes_expr",
                "pending_tracker_jobs_expr",
            ),
        ),
        consumer_modules=("app.api.v1.data_manager", "app.api.v1.task_views"),
    ),
    FacadeSpec(
        facade_module="app.services.task_views",
        public_module="app.services.data_management.views",
        exports=(
            _exports(
                "app.services.data_management.task_filters",
                "apply_task_visibility",
                "compile_filter",
                "visible_tasks_stmt",
            ),
            _exports(
                "app.services.data_management.views",
                "DEFAULT_COLUMNS",
                "TaskViewService",
                "apply_sort",
                "builtin_views",
                "compile_annotation_match_filter",
                "invalid_filter_fields",
                "validate_columns",
                "validate_filter",
                "validate_sort",
            ),
            _exports(
                "app.services.data_management.schema",
                "builtin_view_keys",
            ),
        ),
        consumer_modules=("app.api.v1.data_manager", "app.api.v1.task_views"),
    ),
    FacadeSpec(
        facade_module="app.services.data_manager_cursor",
        public_module="app.services.data_management.cursor",
        exports=(
            _exports(
                "app.services.data_management.cursor",
                "decode_cursor",
                "encode_cursor",
                "keyset_after",
            ),
        ),
        consumer_modules=("app.api.v1.data_manager", "app.api.v1.task_views"),
    ),
    FacadeSpec(
        facade_module="app.services.data_manager_entities",
        public_module="app.services.data_management.entities",
        exports=(
            _exports(
                "app.services.data_management.entities",
                "COMPACT_TRACK_TYPES",
                "DataManagerObjectService",
                "object_from_row",
                "task_dataset_item_id_expr",
            ),
        ),
        consumer_modules=("app.api.v1.data_manager", "app.api.v1.task_views"),
    ),
    FacadeSpec(
        facade_module="app.services.data_manager_entity_filter",
        public_module="app.services.data_management.entity_filters",
        exports=(
            _exports(
                "app.services.data_management.entity_filters",
                "builtin_entity_views",
                "compile_entity_filter",
                "count_entity_filters",
                "invalid_entity_filter_fields",
                "validate_entity_view",
            ),
        ),
        consumer_modules=("app.api.v1.data_manager", "app.api.v1.task_views"),
    ),
    FacadeSpec(
        facade_module="app.services.data_manager_tracks",
        public_module="app.services.data_management.tracks",
        exports=(
            _exports(
                "app.services.data_management.tracks",
                "DataManagerTrackService",
            ),
        ),
        consumer_modules=("app.api.v1.data_manager", "app.api.v1.task_views"),
    ),
)

_EXPECTED_FACADES = {
    "app.services.gpu_arbiter_store",
    "app.services.gpu_admission_signer",
    "app.services.gpu_arbiter_rollout",
    "app.services.gpu_collector_database",
    "app.services.video_tracker_adapters",
    "app.services.video_tracker_job_service",
    "app.services.video_tracker_runner",
    "app.services.export",
    "app.services.export_packaging",
    "app.services.export_cache",
    "app.services.export_video",
    "app.services.export_lidar",
    "app.services.export_davis",
    "app.services.data_manager",
    "app.services.task_views",
    "app.services.data_manager_cursor",
    "app.services.data_manager_entities",
    "app.services.data_manager_entity_filter",
    "app.services.data_manager_tracks",
}

_HAS_FACADES = any(
    __import__("importlib").util.find_spec(spec.facade_module) is not None
    and __import__("importlib").util.find_spec(spec.public_module) is not None
    for spec in FACADE_SPECS
)
pytestmark = pytest.mark.skipif(
    not _HAS_FACADES, reason="no facade landed yet (P0 baseline)"
)


def _public_names(module: object) -> tuple[str, ...]:
    names = getattr(module, "__all__", None)
    assert isinstance(names, (list, tuple)), "facade must declare __all__"
    assert names, "facade __all__ must not be empty"
    assert all(isinstance(name, str) and name for name in names)
    assert len(names) == len(set(names)), "facade __all__ contains duplicates"
    return tuple(names)


def _child_env() -> dict[str, str]:
    child_env = os.environ.copy()
    child_env.update(
        {
            "PYTHONPATH": _PROJECT_ROOT_PYTHONPATH,
            "PYTHONDONTWRITEBYTECODE": "1",
        }
    )
    return child_env


def test_all_compatibility_facades_are_registered() -> None:
    """The data-driven suite must not silently omit a landed legacy facade."""
    assert {spec.facade_module for spec in FACADE_SPECS} == _EXPECTED_FACADES
    all_names = [name for spec in FACADE_SPECS for name in spec.expected_names]
    assert len(all_names) == 143
    for spec in FACADE_SPECS:
        assert len(spec.expected_names) == len(set(spec.expected_names)), (
            f"frozen manifest duplicates a name for {spec.facade_module}"
        )


@pytest.mark.parametrize("spec", FACADE_SPECS, ids=lambda s: s.facade_module)
def test_facade_identity(spec: FacadeSpec) -> None:
    import importlib

    facade = importlib.import_module(spec.facade_module)
    public = importlib.import_module(spec.public_module)
    actual_names = _public_names(facade)
    assert set(actual_names) == set(spec.expected_names), (
        f"{spec.facade_module} public contract drifted: "
        f"expected={sorted(spec.expected_names)!r}, actual={sorted(actual_names)!r}"
    )

    for group in spec.exports:
        source = importlib.import_module(group.module)
        for name in group.names:
            old_obj = getattr(facade, name, _Missing)
            public_obj = getattr(public, name, _Missing)
            source_obj = getattr(source, name, _Missing)
            assert old_obj is not _Missing, (
                f"{spec.facade_module}.{name} missing from facade"
            )
            assert public_obj is not _Missing, (
                f"{spec.public_module}.{name} missing from public module"
            )
            assert source_obj is not _Missing, f"{group.module}.{name} missing"
            assert old_obj is public_obj is source_obj, (
                f"{spec.facade_module}.{name} is not the exact object from "
                f"{group.module}.{name}"
            )


class _Missing:
    """Sentinel for missing attributes."""


def test_data_manager_schema_cold_direct_import_has_builtin_view_keys() -> None:
    """Direct schema imports must not rely on views.py registration side effects."""
    probe = textwrap.dedent(
        """
        import sys
        import uuid

        from app.db.models.project import Project
        from app.services.data_management.schema import build_data_manager_schema

        assert "app.services.data_management.views" not in sys.modules
        project = Project(
            id=uuid.uuid4(),
            owner_id=uuid.uuid4(),
            display_id="P-DM-COLD",
            name="cold schema",
            type_label="Video tracking",
            type_key="video-track",
            data_type="video",
            scene_mode=False,
            tool_bindings={
                "bbox": {
                    "enabled": True,
                    "classes": ["car"],
                    "attribute_schema": {
                        "fields": [
                            {"key": "color", "type": "select", "required": True}
                        ]
                    },
                }
            },
        )
        schema = build_data_manager_schema(project)
        assert {
            "all",
            "pending",
            "review",
            "feedback-open",
            "ai-review",
            "missing-required-attributes",
            "tracker-review",
            "with-tracks",
        } <= set(schema.builtin_views)
        assert "app.services.data_management.views" not in sys.modules
        """
    )
    result = subprocess.run(
        [sys.executable, "-c", probe],
        cwd=_PROJECT_ROOT_PYTHONPATH,
        capture_output=True,
        text=True,
        env=_child_env(),
    )
    assert result.returncode == 0, (
        "cold direct schema import failed:\n"
        f"stdout:\n{result.stdout}\nstderr:\n{result.stderr}"
    )


@pytest.mark.parametrize("spec", FACADE_SPECS, ids=lambda s: s.facade_module)
def test_facade_cold_import_both_orders(spec: FacadeSpec) -> None:
    """Import in old→new and new→old order in fresh processes; identity must hold."""
    exports_literal = repr(tuple((group.module, group.names) for group in spec.exports))
    names_literal = repr(spec.expected_names)
    probe = textwrap.dedent(
        f"""
        import importlib
        facade = importlib.import_module("{spec.facade_module}")
        public = importlib.import_module("{spec.public_module}")
        assert set(facade.__all__) == set({names_literal})
        sources = {{module: importlib.import_module(module) for module, _ in {exports_literal}}}
        for module, names in {exports_literal}:
            source = sources[module]
            for name in names:
                assert getattr(facade, name) is getattr(public, name)
                assert getattr(facade, name) is getattr(source, name), name
        """
    )
    probe_rev = textwrap.dedent(
        f"""
        import importlib
        sources = {{module: importlib.import_module(module) for module, _ in {exports_literal}}}
        public = importlib.import_module("{spec.public_module}")
        facade = importlib.import_module("{spec.facade_module}")
        assert set(facade.__all__) == set({names_literal})
        for module, names in {exports_literal}:
            source = sources[module]
            for name in names:
                assert getattr(facade, name) is getattr(public, name)
                assert getattr(facade, name) is getattr(source, name), name
        """
    )
    for label, code in (("old_first", probe), ("new_first", probe_rev)):
        result = subprocess.run(
            [sys.executable, "-c", code],
            cwd=_PROJECT_ROOT_PYTHONPATH,
            capture_output=True,
            text=True,
            env=_child_env(),
        )
        assert result.returncode == 0, (
            f"cold import ({label}) failed:\n"
            f"stdout:\n{result.stdout}\nstderr:\n{result.stderr}"
        )


_CONSUMER_MODULES = tuple(
    sorted({module for spec in FACADE_SPECS for module in spec.consumer_modules})
)


@pytest.mark.parametrize("consumer", _CONSUMER_MODULES)
def test_consumer_cold_import_without_facade_preload(consumer: str) -> None:
    """Each real consumer must import first in a process with no facade preloaded."""
    probe = textwrap.dedent(
        f"""
        import importlib
        import sys

        legacy = {tuple(sorted(_EXPECTED_FACADES))!r}
        assert not any(module in sys.modules for module in legacy)
        importlib.import_module({consumer!r})
        loaded = sorted(module for module in legacy if module in sys.modules)
        assert not loaded, f"consumer loaded compatibility facade(s): {{loaded}}"
        """
    )
    result = subprocess.run(
        [sys.executable, "-c", probe],
        cwd=_PROJECT_ROOT_PYTHONPATH,
        capture_output=True,
        text=True,
        env=_child_env(),
    )
    assert result.returncode == 0, (
        f"cold consumer import failed for {consumer}:\n"
        f"stdout:\n{result.stdout}\nstderr:\n{result.stderr}"
    )


@pytest.mark.parametrize("spec", FACADE_SPECS, ids=lambda s: s.facade_module)
def test_facade_no_import_star(spec: FacadeSpec) -> None:
    """Facade source is limited to explicit aliases and one ``__all__`` contract."""
    parts = spec.facade_module.split(".")
    path = Path(*parts).with_suffix(".py")
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))

    imported_names: set[str] = set()
    offenders: list[str] = []
    for node in tree.body:
        if (
            isinstance(node, ast.Expr)
            and isinstance(node.value, ast.Constant)
            and isinstance(node.value.value, str)
        ):
            continue
        if isinstance(node, ast.ImportFrom):
            if any(alias.name == "*" for alias in node.names):
                offenders.append("uses import star")
                continue
            if node.module == "__future__":
                continue
            if node.level != 0 or node.module not in spec.implementation_modules:
                offenders.append(f"imports unexpected module {node.module!r}")
                continue
            imported_names.update(alias.asname or alias.name for alias in node.names)
            continue
        if (
            isinstance(node, ast.Assign)
            and len(node.targets) == 1
            and isinstance(node.targets[0], ast.Name)
            and node.targets[0].id == "__all__"
            and isinstance(node.value, (ast.List, ast.Tuple))
            and all(
                isinstance(item, ast.Constant) and isinstance(item.value, str)
                for item in node.value.elts
            )
        ):
            continue
        offenders.append(f"contains forbidden {type(node).__name__}")

    facade = __import__(spec.facade_module, fromlist=["*"])
    public_names = set(_public_names(facade))
    if imported_names != public_names:
        offenders.append(
            f"explicit imports {sorted(imported_names)!r} do not match "
            f"__all__ {sorted(public_names)!r}"
        )
    assert not offenders, f"{spec.facade_module}: " + "; ".join(offenders)
