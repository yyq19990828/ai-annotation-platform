from __future__ import annotations

import time
import httpx
from dataclasses import dataclass

from app.config import settings
from app.db.models.ml_backend import MLBackend
from app.observability.metrics import observe_ml_backend


@dataclass
class PredictionResult:
    task_id: str
    result: list[dict]
    score: float | None = None
    model_version: str | None = None
    inference_time_ms: int | None = None
    # v0.9.11 · token / cost 透传 (LLM-backed backend 才有, grounded-sam2 当前留 None).
    # worker 累加到 prediction_jobs.total_cost, prediction_meta 单条留档.
    meta: dict | None = None


class MLBackendClient:
    def __init__(self, backend: MLBackend) -> None:
        self.base_url = backend.url.rstrip("/")
        self.auth_method = backend.auth_method
        self.auth_token = backend.auth_token
        self.backend_id = str(getattr(backend, "id", "")) or None

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
                meta = {
                    k: data[k]
                    for k in ("gpu_info", "host", "cache", "model_version")
                    if k in data
                }
                return True, meta or None
        except (httpx.RequestError, httpx.TimeoutException):
            return False, None

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
            async with httpx.AsyncClient(timeout=settings.ml_predict_timeout) as client:
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
                    meta=item.get("meta"),  # v0.9.11 · LLM cost/token (grounded-sam2 不返回)
                )
            )
        return results

    async def predict_interactive(
        self, task_data: dict, context: dict
    ) -> PredictionResult:
        start = time.monotonic()
        outcome = "success"
        try:
            async with httpx.AsyncClient(timeout=settings.ml_predict_timeout) as client:
                resp = await client.post(
                    f"{self.base_url}/predict",
                    json={"task": task_data, "context": context},
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

        return PredictionResult(
            task_id=task_data.get("id", ""),
            result=data.get("result", []),
            score=data.get("score"),
            model_version=data.get("model_version"),
            inference_time_ms=data.get("inference_time_ms") or wall_ms,
            meta=data.get("meta"),
        )

    async def setup(self) -> dict:
        async with httpx.AsyncClient(timeout=settings.ml_health_timeout) as client:
            resp = await client.get(f"{self.base_url}/setup", headers=self._headers())
            resp.raise_for_status()
            return resp.json()

    async def get_versions(self) -> list[str]:
        async with httpx.AsyncClient(timeout=settings.ml_health_timeout) as client:
            resp = await client.get(
                f"{self.base_url}/versions", headers=self._headers()
            )
            resp.raise_for_status()
            return resp.json().get("versions", [])
