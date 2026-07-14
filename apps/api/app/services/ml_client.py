from __future__ import annotations

import asyncio
import logging
import time
import httpx
from dataclasses import dataclass

from fastapi import HTTPException

from app.config import settings
from app.db.models.ml_backend_registry import MLBackendRegistry
from app.observability.metrics import observe_ml_backend

logger = logging.getLogger(__name__)

# v0.9.12 BUG B-17 · per-backend asyncio.Semaphore 限速. 受 ml_backends.extra_params.max_concurrency
# 控制 (默认 4, 匹配现有 celery worker --concurrency=4 不破坏既有行为). 改 extra_params 后需 worker
# 重启才生效 (信号量按 backend_id 永久缓存; 工时换简洁性的取舍, 见 docs-site/dev/architecture/ai-models.md).
_DEFAULT_MAX_CONCURRENCY = 4
_semaphores: dict[str, asyncio.Semaphore] = {}


def _backend_detail(resp: httpx.Response) -> str:
    """提取上游 backend 的错误说明: 优先 JSON 的 detail/error/message, 回退裁剪后的 text."""
    try:
        data = resp.json()
        if isinstance(data, dict):
            for key in ("detail", "error", "message"):
                val = data.get(key)
                if val:
                    return str(val)
    except Exception:
        pass
    return (resp.text or "")[:512]


def _raise_for_backend_status(resp: httpx.Response) -> None:
    """把上游 backend 的非 2xx 映射成对前端友好的 HTTPException:

    - 上游 4xx (如 SAM3 不支持 point 的 400) → 原样透传 4xx, 不再被放大成 500.
    - 上游 5xx → 502 Bad Gateway, 表明是 backend 故障而非平台故障.

    交互式探针 (warmup) 拿到透传的 400 后, 前端全局拦截器 (只对 403/>=500 弹 toast)
    不再刷屏 "服务器错误 HTTP 500".
    """
    if resp.status_code < 400:
        return
    detail = _backend_detail(resp)
    headers: dict[str, str] | None = None
    retry_after = resp.headers.get("Retry-After")
    if retry_after:
        headers = {"Retry-After": retry_after}
    if resp.status_code < 500 or resp.status_code == 503:
        raise HTTPException(
            status_code=resp.status_code,
            detail=f"ML backend: {detail}",
            headers=headers,
        )
    raise HTTPException(status_code=502, detail=f"ML backend error: {detail}")


def _get_semaphore(backend_id: str | None, max_cc: int) -> asyncio.Semaphore | None:
    if not backend_id:
        return None
    sem = _semaphores.get(backend_id)
    if sem is None:
        sem = asyncio.Semaphore(max(1, int(max_cc)))
        _semaphores[backend_id] = sem
    return sem


@dataclass
class PredictionResult:
    task_id: str
    result: list[dict]
    score: float | None = None
    model_version: str | None = None
    inference_time_ms: int | None = None
    cache_hit: bool | None = None
    model_load_ms: int | None = None
    # v0.9.11 · token / cost 透传 (LLM-backed backend 才有, grounded-sam2 当前留 None).
    # worker 累加到 async_job.result.total_cost, prediction_meta 单条留档.
    meta: dict | None = None
    # v0.18.18 · 交互单实例精修的 low-res logits 回灌 (base64); 平台仅透传, 前端原样回带.
    mask_input_next: str | None = None


class MLBackendClient:
    def __init__(self, backend: MLBackendRegistry) -> None:
        self.base_url = backend.url.rstrip("/")
        self.auth_method = backend.auth_method
        self.auth_token = backend.auth_token
        self.backend_id = str(getattr(backend, "id", "")) or None
        extra = getattr(backend, "extra_params", None) or {}
        self.max_concurrency = int(
            extra.get("max_concurrency", _DEFAULT_MAX_CONCURRENCY)
        )
        self._semaphore = _get_semaphore(self.backend_id, self.max_concurrency)

    def _headers(self) -> dict[str, str]:
        headers: dict[str, str] = {"Content-Type": "application/json"}
        if self.auth_method == "token" and self.auth_token:
            headers["Authorization"] = f"Bearer {self.auth_token}"
        return headers

    async def health(self) -> bool:
        try:
            async with httpx.AsyncClient(timeout=settings.ml_health_timeout) as client:
                resp = await client.get(
                    f"{self.base_url}/health", headers=self._headers()
                )
                return resp.status_code == 200
        except (httpx.RequestError, httpx.TimeoutException):
            return False

    async def health_meta(self) -> tuple[bool, dict | None]:
        """v0.9.6 · 拉 /health 完整响应; 上层 service 把 gpu_info/cache/model_version 缓存到 ml_backends.health_meta.

        返回 (ok, meta?); meta 仅在 ok=True 且响应 JSON 时返回, 否则 None.
        """
        try:
            async with httpx.AsyncClient(timeout=settings.ml_health_timeout) as client:
                resp = await client.get(
                    f"{self.base_url}/health", headers=self._headers()
                )
                if resp.status_code != 200:
                    return False, None
                try:
                    data = resp.json()
                except Exception:
                    return True, None
                # v0.9.11 · 加 host (PerfHud 容器 CPU/RAM); gpu_info/cache/model_version 保留
                # v0.10.26 · 加 pool (cap / loaded_variants / per_variant_lru_ts), v0.14.14
                # 升级到协议 §4.3 PoolStatus (cap / current_size / loaded_keys / last_evict),
                # 这里整段透传; 模型市场变体面板按字段优先级展示 (backend 无 pool 时静默跳过).
                # v0.10.36 · 加 video_pool (cap / loaded_variants / active_sessions / idle_seconds),
                # 供视频追踪显存池观测 (backend 无该字段时静默跳过; video pool 协议化留下版).
                # v0.22.3 WS4 · 加 compute (configured_device/effective_device/effective_provider),
                # 暴露 backend 是否已静默退回 CPU; platform overview + PerfHud 两路均依赖此处放行.
                meta = {
                    k: data[k]
                    for k in (
                        "gpu_info",
                        "host",
                        "cache",
                        "model_version",
                        "loaded",
                        "idle_unload_seconds",
                        "last_request_age_seconds",
                        "pool",
                        "video_pool",
                        "compute",
                        # ADR-0049 · 全 pool/session 驻留真值，与 compute 配置意图分离。
                        "residency",
                    )
                    if k in data
                }
                return True, meta or None
        except (httpx.RequestError, httpx.TimeoutException):
            return False, None

    async def _acquire(self):
        """v0.9.12 · per-backend Semaphore 限速 context manager. 无 backend_id 时降级为 noop."""

        class _NullCtx:
            async def __aenter__(self):
                return self

            async def __aexit__(self, *exc):
                return False

        if self._semaphore is None:
            return _NullCtx()
        return self._semaphore

    async def predict(
        self, tasks: list[dict], context: dict | None = None
    ) -> list[PredictionResult]:
        start = time.monotonic()
        outcome = "success"
        payload: dict = {"tasks": tasks}
        if context:
            # v0.9.5 · 批量预标透传 context（含 type=text + prompt + output 三模式 + DINO 阈值）。
            payload["context"] = context
        try:
            async with await self._acquire():
                async with httpx.AsyncClient(
                    timeout=settings.ml_predict_timeout
                ) as client:
                    resp = await client.post(
                        f"{self.base_url}/predict",
                        json=payload,
                        headers=self._headers(),
                    )
                    resp.raise_for_status()
                    data = resp.json()
        except Exception:
            outcome = "error"
            observe_ml_backend(self.backend_id, outcome, time.monotonic() - start)
            raise

        wall_ms = int((time.monotonic() - start) * 1000)
        observe_ml_backend(self.backend_id, outcome, wall_ms / 1000)

        results = []
        for item in data.get("results", []):
            # 优先用 backend 自报的 inference_time_ms（去 IO 开销更准），缺失则回退 wall clock。
            results.append(
                PredictionResult(
                    task_id=item.get("task"),
                    result=item.get("result", []),
                    score=item.get("score"),
                    model_version=item.get("model_version"),
                    inference_time_ms=item.get("inference_time_ms") or wall_ms,
                    meta=item.get(
                        "meta"
                    ),  # v0.9.11 · LLM cost/token (grounded-sam2 不返回)
                )
            )
        return results

    async def predict_interactive(
        self, task_data: dict, context: dict
    ) -> PredictionResult:
        start = time.monotonic()
        outcome = "success"
        try:
            async with await self._acquire():
                async with httpx.AsyncClient(
                    timeout=settings.ml_predict_timeout
                ) as client:
                    try:
                        resp = await client.post(
                            f"{self.base_url}/predict",
                            json={"task": task_data, "context": context},
                            headers=self._headers(),
                        )
                    except (httpx.ConnectError, httpx.TimeoutException) as exc:
                        # backend 不可达 / 超时 → 502 (而非含糊的 500)
                        raise HTTPException(
                            status_code=502,
                            detail=f"ML backend unreachable: {exc}",
                        ) from exc
                    # 上游 4xx 原样透传, 5xx → 502 (见 _raise_for_backend_status)
                    _raise_for_backend_status(resp)
                    data = resp.json()
        except Exception:
            # 仍记 error 指标 (HTTPException 也走这里), 再原样抛出, 指标语义不变.
            outcome = "error"
            observe_ml_backend(self.backend_id, outcome, time.monotonic() - start)
            raise

        wall_ms = int((time.monotonic() - start) * 1000)
        observe_ml_backend(self.backend_id, outcome, wall_ms / 1000)

        return PredictionResult(
            task_id=task_data.get("id", ""),
            result=data.get("result", []),
            score=data.get("score"),
            model_version=data.get("model_version"),
            inference_time_ms=data.get("inference_time_ms") or wall_ms,
            cache_hit=data.get("cache_hit"),
            model_load_ms=data.get("model_load_ms"),
            meta=data.get("meta"),
            mask_input_next=data.get("mask_input_next"),
        )

    async def unload(self) -> dict:
        """B-28+ · 让 backend 卸载模型释放显存. backend 必须实现 POST /unload."""
        async with httpx.AsyncClient(timeout=settings.ml_health_timeout) as client:
            resp = await client.post(f"{self.base_url}/unload", headers=self._headers())
            resp.raise_for_status()
            return resp.json()

    async def reload(
        self,
        sam_variant: str | None = None,
        dino_variant: str | None = None,
        task_type: str | None = None,
    ) -> dict:
        """B-28+ · 让 backend 重新加载模型. 重载耗时可能远高于 health 探活, 用 predict 超时配额.

        v0.10.26 · 可选指定变体预热 (模型市场单变体预热); 缺省时 body 留空, backend 用默认变体.
        v0.10.36 · 可选 task_type="video" 预热独立 video tracker 池 (仅认 sam_variant, 无 dino).
        """
        body: dict[str, str] = {}
        if sam_variant:
            body["sam_variant"] = sam_variant
        if dino_variant:
            body["dino_variant"] = dino_variant
        if task_type:
            body["task_type"] = task_type
        async with httpx.AsyncClient(timeout=settings.ml_predict_timeout) as client:
            resp = await client.post(
                f"{self.base_url}/reload",
                json=body or None,
                headers=self._headers(),
            )
            resp.raise_for_status()
            return resp.json()

    async def setup(self) -> dict:
        async with httpx.AsyncClient(timeout=settings.ml_health_timeout) as client:
            resp = await client.get(f"{self.base_url}/setup", headers=self._headers())
            resp.raise_for_status()
            return resp.json()

    async def warmup(self, body: dict) -> dict:
        """v0.14.14 协议 §4.4 · 把指定 variant 权重加载到 pool, 不跑 forward.

        body 由前端原样传入 (各 backend schema 不同: yolo 要 task+variants{series,size},
        gsam2 要 variants{sam_variant,dino_variant}, sam3 可空或 variants{model_variant}).
        响应统一为 {ok, model_load_ms, cache_hit, evicted}. 用 predict 超时配额 (加载
        可能数秒).
        """
        async with httpx.AsyncClient(timeout=settings.ml_predict_timeout) as client:
            resp = await client.post(
                f"{self.base_url}/warmup",
                json=body or {},
                headers=self._headers(),
            )
            resp.raise_for_status()
            return resp.json()

    async def get_versions(self) -> list[str]:
        async with httpx.AsyncClient(timeout=settings.ml_health_timeout) as client:
            resp = await client.get(
                f"{self.base_url}/versions", headers=self._headers()
            )
            resp.raise_for_status()
            return resp.json().get("versions", [])
