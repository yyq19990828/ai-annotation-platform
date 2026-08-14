"""内部传输层: URL 拼接 / auth 注入 / 错误映射 / 幂等 GET 重试 / 流式上传下载。

不属于公开 API; 外部代码只应使用 ai_annotation.Client。
"""

from __future__ import annotations

import time
from pathlib import Path
from typing import Any

import httpx

from ai_annotation.errors import (
    APIStatusError,
    AuthenticationError,
    ConflictError,
    NotFoundError,
    PermissionDeniedError,
    ValidationError,
)

API_PREFIX = "/api/v1"

_STATUS_ERROR_MAP: dict[int, type[APIStatusError]] = {
    401: AuthenticationError,
    403: PermissionDeniedError,
    404: NotFoundError,
    409: ConflictError,
    422: ValidationError,
}
_RETRYABLE_STATUS = frozenset({429, 502, 503, 504})


def map_status_error(resp: httpx.Response) -> APIStatusError:
    """后端错误体为 {"detail": str|dict}; 解析失败回落原始文本。"""
    try:
        detail = resp.json().get("detail")
    except Exception:
        detail = resp.text
    cls = _STATUS_ERROR_MAP.get(resp.status_code, APIStatusError)
    return cls(resp.status_code, detail)


class HttpTransport:
    """httpx.Client 薄封装; 幂等 GET 在 429/5xx 时做最多 3 次指数退避重试。"""

    def __init__(self, base_url: str, api_key: str | None, timeout: float = 30.0):
        self._origin = base_url.rstrip("/")
        self._timeout = timeout
        headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
        self._client = httpx.Client(
            base_url=self._origin + API_PREFIX, headers=headers, timeout=timeout
        )
        self._bare_client: httpx.Client | None = None
        # 重试退避基数, 测试可调小避免真实 sleep
        self.retry_backoff = 0.5

    @property
    def bare(self) -> httpx.Client:
        """无 auth 的裸 client: 预签名 PUT / 绝对预签名下载 URL 用。"""
        if self._bare_client is None:
            self._bare_client = httpx.Client(timeout=self._timeout)
        return self._bare_client

    def request(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, Any] | None = None,
        json: Any = None,
        data: dict[str, Any] | None = None,
        files: Any = None,
    ) -> httpx.Response:
        attempts = 3 if method.upper() == "GET" else 1
        for attempt in range(attempts):
            resp = self._client.request(
                method, path, params=params, json=json, data=data, files=files
            )
            if resp.status_code in _RETRYABLE_STATUS and attempt + 1 < attempts:
                time.sleep(self.retry_backoff * (2**attempt))
                continue
            break
        if resp.status_code >= 400:
            raise map_status_error(resp)
        return resp

    def put_presigned(self, url: str, file_path: Path, content_type: str) -> None:
        """向预签名 URL 流式 PUT 文件 (不带平台 auth header; 大文件不整读进内存)。"""
        with file_path.open("rb") as f:
            resp = self.bare.put(url, content=f, headers={"Content-Type": content_type})
        if resp.status_code >= 400:
            raise APIStatusError(resp.status_code, f"预签名上传失败: {resp.text[:200]}")

    def stream_download(self, url: str, dest: Path) -> Path:
        """流式下载到 dest。绝对 URL 视为预签名不带 auth; 相对路径拼回平台 origin 带 auth。"""
        if url.startswith(("http://", "https://")):
            client, target = self.bare, url
        else:
            client = self._client
            target = self._origin + (url if url.startswith("/") else "/" + url)
        with client.stream("GET", target) as resp:
            if resp.status_code >= 400:
                resp.read()
                raise map_status_error(resp)
            with dest.open("wb") as f:
                for chunk in resp.iter_bytes():
                    f.write(chunk)
        return dest

    def close(self) -> None:
        self._client.close()
        if self._bare_client is not None:
            self._bare_client.close()
