"""Concurrency-safe YOLO model pool with build and borrower accounting."""

from __future__ import annotations

import asyncio
import gc
import logging
import time
from collections import OrderedDict
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import TYPE_CHECKING, Any, Literal

from observability import (
    record_pool_evict,
    record_pool_idle_unload,
    record_pool_load,
    update_pool_size,
)

if TYPE_CHECKING:
    from ultralytics import YOLO

logger = logging.getLogger("yolo-backend.pool")

UTC = timezone.utc
ModelKey = tuple[str, str, str]
EvictReason = Literal["lru", "manual", "idle_timeout"]


class PoolBusyError(RuntimeError):
    """No pool slot can be released without touching active work."""


class ModelBuildTimeout(TimeoutError):
    """The caller stopped waiting, while the real builder remains tracked."""

    def __init__(
        self,
        message: str,
        *,
        builder: asyncio.Task[_BuildResult],
    ) -> None:
        super().__init__(message)
        self.builder = builder


@dataclass(slots=True)
class _PoolEntry:
    key: ModelKey
    model: "YOLO"
    loaded_at: datetime
    last_used_at: datetime
    last_used_monotonic: float
    hit_count: int = 0
    borrowers: int = 0
    use_lock: asyncio.Lock = field(default_factory=asyncio.Lock)


@dataclass(frozen=True, slots=True)
class ModelLease:
    """Model handle whose lifetime is bounded by ``ModelPool.borrow``."""

    key: ModelKey
    model: "YOLO"
    cache_hit: bool
    model_load_ms: int | None


@dataclass(frozen=True, slots=True)
class _BuildResult:
    load_ms: int
    evicted_key: str | None


class ModelPool:
    """LRU pool that never evicts a builder, waiter, or borrowed model.

    The invariant ``resident entries + reserved build slots <= cap`` is changed only
    under ``_lock``. Model destruction, CUDA cleanup, model construction, and inference
    never run while that lock is held.
    """

    def __init__(
        self,
        cap: int,
        build_model: Callable[[str, str, str], "YOLO"],
        free_gpu_memory: Callable[[], None],
        *,
        build_timeout: float = 30.0,
    ) -> None:
        if cap <= 0:
            raise ValueError("cap must be positive")
        if build_timeout <= 0:
            raise ValueError("build_timeout must be positive")
        self._cap = cap
        self._build_model = build_model
        self._free_gpu_memory = free_gpu_memory
        self._build_timeout = build_timeout

        self._entries: OrderedDict[ModelKey, _PoolEntry] = OrderedDict()
        self._builders: dict[ModelKey, asyncio.Task[_BuildResult]] = {}
        self._waiters: dict[ModelKey, int] = {}
        self._class_names: dict[str, list[dict[str, Any]]] = {}
        self._last_evict: dict[str, Any] | None = None
        self._cleanup_in_progress = False
        self._cleanup_failed = False

        self._lock = asyncio.Lock()
        # ``main._build_model`` temporarily changes process cwd, so callbacks must be
        # serialized even when multiple keys own independent pool reservations.
        self._build_serial_lock = asyncio.Lock()

    @property
    def cap(self) -> int:
        return self._cap

    def __len__(self) -> int:
        return len(self._entries)

    def has(self, key: ModelKey) -> bool:
        return key in self._entries

    def class_names(self, task: str) -> list[dict[str, Any]] | None:
        """Return the class table cached after the first successful task build."""

        return self._class_names.get(task)

    @staticmethod
    def _key_str(key: ModelKey) -> str:
        task, series, size = key
        return f"{series}/{size}/{task}"

    @asynccontextmanager
    async def borrow(
        self,
        task: str,
        series: str,
        size: str,
    ) -> AsyncIterator[ModelLease]:
        """Borrow one model and serialize mutable ultralytics use per entry."""

        entry, cache_hit, load_ms = await self._acquire_borrower((task, series, size))
        use_lock_acquired = False
        try:
            await entry.use_lock.acquire()
            use_lock_acquired = True
            yield ModelLease(
                key=entry.key,
                model=entry.model,
                cache_hit=cache_hit,
                model_load_ms=load_ms,
            )
        finally:
            if use_lock_acquired:
                entry.use_lock.release()
            await asyncio.shield(self._release_borrower(entry))

    async def warmup(
        self,
        task: str,
        series: str,
        size: str,
    ) -> tuple[bool, int | None, str | None]:
        """Ensure one model is resident without borrowing it for inference."""

        key: ModelKey = (task, series, size)
        async with self._lock:
            entry = self._entries.get(key)
            if entry is not None:
                self._touch_locked(entry, count_hit=False)
                return True, None, None
            builder = self._get_or_start_builder_locked(key)
            self._waiters[key] = self._waiters.get(key, 0) + 1

        try:
            result = await self._wait_for_builder(key, builder)
        finally:
            await self._drop_waiter_cancellation_safe(key)
        return False, result.load_ms, result.evicted_key

    async def _acquire_borrower(
        self,
        key: ModelKey,
    ) -> tuple[_PoolEntry, bool, int | None]:
        async with self._lock:
            entry = self._entries.get(key)
            if entry is not None:
                entry.borrowers += 1
                self._touch_locked(entry, count_hit=True)
                return entry, True, None
            builder = self._get_or_start_builder_locked(key)
            self._waiters[key] = self._waiters.get(key, 0) + 1

        try:
            result = await self._wait_for_builder(key, builder)
            async with self._lock:
                entry = self._entries.get(key)
                if entry is None:
                    raise RuntimeError(f"completed builder did not publish {key!r}")
                entry.borrowers += 1
                self._touch_locked(entry, count_hit=False)
                self._drop_waiter_locked(key)
                return entry, False, result.load_ms
        except BaseException:
            await self._drop_waiter_cancellation_safe(key)
            raise

    async def _release_borrower(self, entry: _PoolEntry) -> None:
        async with self._lock:
            current = self._entries.get(entry.key)
            if current is not entry or entry.borrowers <= 0:
                raise RuntimeError(f"invalid borrower release for {entry.key!r}")
            entry.borrowers -= 1
            self._touch_locked(entry, count_hit=False)

    def _get_or_start_builder_locked(
        self,
        key: ModelKey,
    ) -> asyncio.Task[_BuildResult]:
        builder = self._builders.get(key)
        if builder is not None:
            return builder
        if self._cleanup_in_progress:
            raise PoolBusyError("model pool cleanup is in progress")

        evicted: tuple[ModelKey, _PoolEntry] | None = None
        if len(self._entries) + len(self._builders) >= self._cap:
            for candidate_key, candidate in self._entries.items():
                if (
                    candidate.borrowers == 0
                    and self._waiters.get(candidate_key, 0) == 0
                ):
                    evicted = (candidate_key, candidate)
                    break
            if evicted is None:
                raise PoolBusyError("all model pool slots are active")
            self._entries.pop(evicted[0])
            self._record_evict_locked(evicted[0], "lru")
            update_pool_size(len(self._entries))

        task = asyncio.create_task(self._build_and_publish(key, evicted))
        self._builders[key] = task
        task.add_done_callback(self._consume_builder_result)
        self._assert_capacity_locked()
        return task

    async def _build_and_publish(
        self,
        key: ModelKey,
        evicted: tuple[ModelKey, _PoolEntry] | None,
    ) -> _BuildResult:
        current_task = asyncio.current_task()
        evicted_key: ModelKey | None = None
        model: YOLO | None = None
        try:
            if evicted is not None:
                evicted_key = evicted[0]
                models_to_release = [evicted[1].model]
                # Do not keep the removed entry/model alive while the replacement builds.
                evicted = None
                await asyncio.get_running_loop().run_in_executor(
                    None,
                    self._release_models_sync,
                    models_to_release,
                )

            task, series, size = key
            started = time.monotonic()
            async with self._build_serial_lock:
                model = await asyncio.get_running_loop().run_in_executor(
                    None,
                    self._build_model,
                    task,
                    series,
                    size,
                )
            load_ms = int((time.monotonic() - started) * 1000)
            built_at = datetime.now(UTC)
            entry = _PoolEntry(
                key=key,
                model=model,
                loaded_at=built_at,
                last_used_at=built_at,
                last_used_monotonic=time.monotonic(),
            )

            async with self._lock:
                if self._builders.get(key) is not current_task:
                    raise RuntimeError(f"builder ownership changed for {key!r}")
                self._cache_class_names_locked(task, model)
                self._builders.pop(key)
                self._entries[key] = entry
                self._assert_capacity_locked()
                update_pool_size(len(self._entries))
            record_pool_load(task, series, size)
            return _BuildResult(
                load_ms=load_ms,
                evicted_key=self._key_str(evicted_key)
                if evicted_key is not None
                else None,
            )
        except BaseException:
            models_to_release = [model] if model is not None else []
            model = None
            try:
                await asyncio.get_running_loop().run_in_executor(
                    None,
                    self._release_models_sync,
                    models_to_release,
                )
            except BaseException:
                logger.exception("model_pool cleanup after failed build also failed")
            async with self._lock:
                if self._builders.get(key) is current_task:
                    self._builders.pop(key)
                # A failed builder may have allocated GPU state before raising. Only a
                # later successful full-pool cleanup may restore a trusted false value.
                self._cleanup_failed = True
                self._assert_capacity_locked()
            raise

    async def _wait_for_builder(
        self,
        key: ModelKey,
        builder: asyncio.Task[_BuildResult],
    ) -> _BuildResult:
        try:
            return await asyncio.wait_for(
                asyncio.shield(builder),
                timeout=self._build_timeout,
            )
        except asyncio.TimeoutError as exc:
            raise ModelBuildTimeout(
                f"model build timeout ({self._build_timeout}s) for {key!r}; "
                "builder remains tracked",
                builder=builder,
            ) from exc

    async def builder_for(
        self,
        task: str,
        series: str,
        size: str,
    ) -> asyncio.Task[_BuildResult] | None:
        """Return the real owner task for cancellation-safe lifecycle tracking."""

        async with self._lock:
            return self._builders.get((task, series, size))

    async def _drop_waiter(self, key: ModelKey) -> None:
        async with self._lock:
            self._drop_waiter_locked(key)

    async def _drop_waiter_cancellation_safe(self, key: ModelKey) -> None:
        """Drop exactly one waiter even if cancellation lands during lock acquisition."""

        cleanup = asyncio.create_task(self._drop_waiter(key))
        cancelled = False
        while not cleanup.done():
            try:
                await asyncio.shield(cleanup)
            except asyncio.CancelledError:
                cancelled = True
        cleanup.result()
        if cancelled:
            raise asyncio.CancelledError

    def _drop_waiter_locked(self, key: ModelKey) -> None:
        waiters = self._waiters.get(key, 0)
        if waiters <= 0:
            return
        if waiters == 1:
            self._waiters.pop(key, None)
        else:
            self._waiters[key] = waiters - 1

    @staticmethod
    def _consume_builder_result(task: asyncio.Task[_BuildResult]) -> None:
        if not task.cancelled():
            task.exception()

    def _cache_class_names_locked(self, task: str, model: "YOLO") -> None:
        if task in self._class_names:
            return
        names = getattr(model, "names", None)
        if isinstance(names, dict) and names:
            self._class_names[task] = [
                {"index": int(index), "name": str(name)}
                for index, name in sorted(names.items(), key=lambda item: int(item[0]))
            ]

    def _touch_locked(self, entry: _PoolEntry, *, count_hit: bool) -> None:
        self._entries.move_to_end(entry.key)
        entry.last_used_at = datetime.now(UTC)
        entry.last_used_monotonic = time.monotonic()
        if count_hit:
            entry.hit_count += 1

    def _record_evict_locked(self, key: ModelKey, reason: EvictReason) -> None:
        self._last_evict = {
            "key": self._key_str(key),
            "at": datetime.now(UTC),
            "reason": reason,
        }
        if reason == "lru":
            record_pool_evict()
        logger.info("model_pool evicted %s (reason=%s)", key, reason)

    def _assert_capacity_locked(self) -> None:
        if len(self._entries) + len(self._builders) > self._cap:
            raise RuntimeError("model pool capacity invariant violated")

    def _release_models_sync(self, models: list["YOLO"]) -> None:
        models.clear()
        gc.collect()
        self._free_gpu_memory()

    async def _release_models_async(self, models: list["YOLO"]) -> None:
        await asyncio.get_running_loop().run_in_executor(
            None,
            self._release_models_sync,
            models,
        )

    async def unload_all(
        self,
        *,
        reason: str = "idle",
        idle_before: float | None = None,
        force_cleanup: bool = False,
    ) -> int:
        """Release the complete pool without crossing active/building work."""

        async with self._lock:
            if self._cleanup_in_progress:
                if reason == "idle":
                    return 0
                raise PoolBusyError("model pool cleanup is already in progress")
            if idle_before is not None and any(
                entry.last_used_monotonic > idle_before
                for entry in self._entries.values()
            ):
                return 0
            if (
                self._builders
                or self._waiters
                or any(entry.borrowers > 0 for entry in self._entries.values())
            ):
                if reason == "idle":
                    return 0
                raise PoolBusyError(
                    "model pool has active builders, waiters, or borrowers"
                )

            count = len(self._entries)
            if count == 0 and not force_cleanup:
                return 0
            last_key = next(reversed(self._entries), None)
            models = [entry.model for entry in self._entries.values()]
            self._entries.clear()
            self._cleanup_in_progress = True
            update_pool_size(0)

        cleanup = asyncio.create_task(self._release_models_async(models))
        cancelled = False
        while not cleanup.done():
            try:
                await asyncio.shield(cleanup)
            except asyncio.CancelledError:
                cancelled = True
            except BaseException:
                # Inspect the owner task below so pool truth is updated first.
                pass

        cleanup_error: BaseException | None = None
        try:
            cleanup.result()
        except BaseException as exc:  # keep pool truth before propagating the outcome
            cleanup_error = exc

        if cleanup_error is not None:
            async with self._lock:
                self._cleanup_in_progress = False
                self._cleanup_failed = True
            if cancelled:
                raise asyncio.CancelledError from cleanup_error
            raise cleanup_error

        async with self._lock:
            self._cleanup_in_progress = False
            self._cleanup_failed = False
            if last_key is not None:
                evict_reason: EvictReason = (
                    "idle_timeout" if reason == "idle" else "manual"
                )
                self._record_evict_locked(last_key, evict_reason)

        if reason == "idle":
            for _ in range(count):
                record_pool_idle_unload()
        logger.info("model_pool unloaded all %d models (reason=%s)", count, reason)
        if cancelled:
            raise asyncio.CancelledError
        return count

    async def unload_idle(self, *, idle_before: float) -> int:
        """Atomically unload only if no use occurred after ``idle_before``."""

        return await self.unload_all(reason="idle", idle_before=idle_before)

    async def shutdown(self) -> None:
        """Wait for real builders before the final full cleanup."""

        while True:
            async with self._lock:
                builders = list(self._builders.values())
            if not builders:
                break
            await asyncio.gather(
                *(asyncio.shield(task) for task in builders), return_exceptions=True
            )
        await self.unload_all(reason="shutdown", force_cleanup=True)

    async def snapshot(self) -> dict[str, Any]:
        """Return one atomic observability/lifecycle snapshot."""

        async with self._lock:
            loaded_keys = [
                {
                    "key": self._key_str(entry.key),
                    "loaded_at": entry.loaded_at.isoformat(),
                    "last_used_at": entry.last_used_at.isoformat(),
                    "hit_count": entry.hit_count,
                    "borrowers": entry.borrowers,
                }
                for entry in self._entries.values()
            ]
            last_evict = None
            if self._last_evict is not None:
                last_evict = {
                    "key": self._last_evict["key"],
                    "at": self._last_evict["at"].isoformat(),
                    "reason": self._last_evict["reason"],
                }
            raw_devices = [
                getattr(entry.model, "device", None) for entry in self._entries.values()
            ]
            devices = {str(device) for device in raw_devices if device is not None}
            unknown_device = any(device is None for device in raw_devices)
            builders = len(self._builders)
            borrowers = sum(entry.borrowers for entry in self._entries.values())
            if builders or self._cleanup_in_progress or self._cleanup_failed:
                gpu_resident: bool | None = None
            elif not self._entries:
                gpu_resident = False
            elif any(device.lower().startswith(("cuda", "mps")) for device in devices):
                gpu_resident = True
            elif unknown_device or any(
                not device.lower().startswith("cpu") for device in devices
            ):
                gpu_resident = None
            else:
                gpu_resident = False
            return {
                "cap": self._cap,
                "current_size": len(self._entries),
                "loaded_keys": loaded_keys,
                "last_evict": last_evict,
                "builders": builders,
                "reserved_build_slots": builders,
                "borrowers": borrowers,
                "waiters": sum(self._waiters.values()),
                "cleanup_in_progress": self._cleanup_in_progress,
                "cleanup_failed": self._cleanup_failed,
                "gpu_resident": gpu_resident,
                "device": next(iter(devices)) if len(devices) == 1 else None,
            }


__all__ = [
    "ModelBuildTimeout",
    "ModelKey",
    "ModelLease",
    "ModelPool",
    "PoolBusyError",
]
