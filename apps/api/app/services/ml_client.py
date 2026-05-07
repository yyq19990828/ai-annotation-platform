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

    async def predict(self, tasks: list[dict]) -> list[PredictionResult]:
        start = time.monotonic()
        outcome = "success"
        try:
            async with httpx.AsyncClient(timeout=settings.ml_predict_timeout) as client:
                resp = await client.post(
                    f"{self.base_url}/predict",
                    json={"tasks": tasks},
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
