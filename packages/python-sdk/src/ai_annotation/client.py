"""同步 Client 与资源命名空间 (公开 API 面)。

只覆盖 8 个稳定工作流; 完整 API 面以平台 OpenAPI 文档为准。
"""

from __future__ import annotations

import mimetypes
import time
from pathlib import Path
from typing import Any, Callable, Sequence
from uuid import UUID

from ai_annotation._http import HttpTransport
from ai_annotation.config import load_config
from ai_annotation.errors import AAPError, JobFailedError, JobTimeoutError
from ai_annotation.models import (
    Annotation,
    ApiKey,
    ApiKeyCreated,
    Dataset,
    ImportResult,
    Job,
    JobPage,
    LinkResult,
    Page,
    Project,
    Task,
    TaskPage,
    UploadedItem,
    ZipUploadResult,
)

IdLike = str | UUID

_JOB_TERMINAL = frozenset({"completed", "failed", "cancelled"})


def _drop_none(d: dict[str, Any]) -> dict[str, Any]:
    return {k: v for k, v in d.items() if v is not None}


class Projects:
    def __init__(self, http: HttpTransport):
        self._http = http

    def list(self, status: str | None = None, search: str | None = None) -> list[Project]:
        resp = self._http.request(
            "GET", "/projects", params=_drop_none({"status": status, "search": search})
        )
        return [Project.model_validate(x) for x in resp.json()]

    def create(
        self,
        name: str,
        type_key: str | None = None,
        data_type: str | None = None,
        **kwargs: Any,
    ) -> Project:
        body: dict[str, Any] = {
            "name": name,
            "type_key": type_key,
            "data_type": data_type,
            **kwargs,
        }
        # 后端 ProjectCreate.type_label 必填; 未显式给出时按 type_key/data_type/name 兜底
        body.setdefault("type_label", type_key or data_type or name)
        resp = self._http.request("POST", "/projects", json=_drop_none(body))
        return Project.model_validate(resp.json())

    def get(self, project_id: IdLike) -> Project:
        resp = self._http.request("GET", f"/projects/{project_id}")
        return Project.model_validate(resp.json())


class Datasets:
    def __init__(self, http: HttpTransport):
        self._http = http

    def list(
        self,
        search: str | None = None,
        data_type: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> Page[Dataset]:
        resp = self._http.request(
            "GET",
            "/datasets",
            params=_drop_none(
                {"search": search, "data_type": data_type, "limit": limit, "offset": offset}
            ),
        )
        return Page[Dataset].model_validate(resp.json())

    def create(self, name: str, data_type: str = "image", **kwargs: Any) -> Dataset:
        resp = self._http.request(
            "POST", "/datasets", json={"name": name, "data_type": data_type, **kwargs}
        )
        return Dataset.model_validate(resp.json())

    def get(self, dataset_id: IdLike) -> Dataset:
        resp = self._http.request("GET", f"/datasets/{dataset_id}")
        return Dataset.model_validate(resp.json())

    def upload_files(
        self,
        dataset_id: IdLike,
        paths: Sequence[str | Path],
        on_progress: Callable[[int, int, str], None] | None = None,
    ) -> list[UploadedItem]:
        """逐文件三步流: upload-init → PUT 预签名 URL → upload-complete。

        on_progress(done, total, file_name) 在每个文件完成后回调。
        """
        files = [Path(p) for p in paths]
        items: list[UploadedItem] = []
        for i, path in enumerate(files):
            content_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
            init = self._http.request(
                "POST",
                f"/datasets/{dataset_id}/items/upload-init",
                json={"file_name": path.name, "content_type": content_type},
            ).json()
            self._http.put_presigned(init["upload_url"], path, content_type)
            done = self._http.request(
                "POST",
                f"/datasets/{dataset_id}/items/upload-complete/{init['item_id']}",
            ).json()
            items.append(UploadedItem(file_name=path.name, **done))
            if on_progress is not None:
                on_progress(i + 1, len(files), path.name)
        return items

    def upload_zip(self, dataset_id: IdLike, zip_path: str | Path) -> ZipUploadResult:
        """multipart 上传单个 ZIP 包, 后端解压入库 (≤200MB / ≤5000 文件)。"""
        path = Path(zip_path)
        with path.open("rb") as f:
            resp = self._http.request(
                "POST",
                f"/datasets/{dataset_id}/items/upload-zip",
                files={"file": (path.name, f, "application/zip")},
            )
        return ZipUploadResult.model_validate(resp.json())

    def link_project(self, dataset_id: IdLike, project_id: IdLike) -> LinkResult:
        resp = self._http.request(
            "POST", f"/datasets/{dataset_id}/link", json={"project_id": str(project_id)}
        )
        return LinkResult.model_validate(resp.json())


class Tasks:
    def __init__(self, http: HttpTransport):
        self._http = http

    def list(
        self,
        project_id: IdLike,
        status: str | None = None,
        limit: int = 50,
        offset: int = 0,
        cursor: str | None = None,
    ) -> TaskPage:
        resp = self._http.request(
            "GET",
            "/tasks",
            params=_drop_none(
                {
                    "project_id": str(project_id),
                    "status": status,
                    "limit": limit,
                    "offset": offset,
                    "cursor": cursor,
                }
            ),
        )
        return TaskPage.model_validate(resp.json())

    def get(self, task_id: IdLike) -> Task:
        resp = self._http.request("GET", f"/tasks/{task_id}")
        return Task.model_validate(resp.json())

    def next(self, project_id: IdLike, batch_id: IdLike | None = None) -> Task | None:
        """领取下一个可标注 task; 无可领任务时返回 None。"""
        params = {"project_id": str(project_id)}
        if batch_id is not None:
            params["batch_id"] = str(batch_id)
        resp = self._http.request("GET", "/tasks/next", params=params)
        # 无可领任务时后端返回 null; 空 body 同样按 None 处理
        data = resp.json() if resp.content else None
        return Task.model_validate(data) if data is not None else None


class Annotations:
    def __init__(self, http: HttpTransport):
        self._http = http

    def list(self, task_id: IdLike) -> list[Annotation]:
        resp = self._http.request("GET", f"/tasks/{task_id}/annotations")
        return [Annotation.model_validate(x) for x in resp.json()]

    def create(
        self,
        task_id: IdLike,
        annotation_type: str,
        geometry: dict[str, Any],
        class_name: str | None = None,
        **kwargs: Any,
    ) -> Annotation:
        body = _drop_none(
            {
                "annotation_type": annotation_type,
                "geometry": geometry,
                "class_name": class_name,
                **kwargs,
            }
        )
        resp = self._http.request("POST", f"/tasks/{task_id}/annotations", json=body)
        return Annotation.model_validate(resp.json())

    def update(self, task_id: IdLike, annotation_id: IdLike, **fields: Any) -> Annotation:
        resp = self._http.request(
            "PATCH", f"/tasks/{task_id}/annotations/{annotation_id}", json=fields
        )
        return Annotation.model_validate(resp.json())

    def delete(self, task_id: IdLike, annotation_id: IdLike) -> None:
        self._http.request("DELETE", f"/tasks/{task_id}/annotations/{annotation_id}")


class Predictions:
    def __init__(self, http: HttpTransport):
        self._http = http

    def import_file(
        self,
        project_id: IdLike,
        file_path: str | Path,
        format: str = "aap_json",
        yolo_variant: str | None = None,
        model_version: str | None = None,
        dry_run: bool = False,
        overwrite_existing: bool = False,
    ) -> ImportResult:
        """导入外部预测结果 (aap_json / coco / yolo)。

        注意: 后端 overwrite_existing 缺省为 True, SDK 显式发送、缺省 False (更保守)。
        """
        path = Path(file_path)
        params: dict[str, Any] = {"format": format, "dry_run": dry_run}
        if yolo_variant is not None:
            params["yolo_variant"] = yolo_variant
        data: dict[str, Any] = {
            "overwrite_existing": "true" if overwrite_existing else "false"
        }
        if model_version is not None:
            data["model_version"] = model_version
        with path.open("rb") as f:
            resp = self._http.request(
                "POST",
                f"/projects/{project_id}/predictions/import",
                params=params,
                data=data,
                files={"file": (path.name, f)},
            )
        return ImportResult.model_validate(resp.json())


class Jobs:
    def __init__(self, http: HttpTransport):
        self._http = http

    def list(
        self,
        status: str | Sequence[str] | None = None,
        kind: str | Sequence[str] | None = None,
        project_id: IdLike | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> JobPage:
        params: dict[str, Any] = {"limit": limit, "offset": offset}
        if status is not None:
            params["status"] = [status] if isinstance(status, str) else list(status)
        if kind is not None:
            params["kind"] = [kind] if isinstance(kind, str) else list(kind)
        if project_id is not None:
            params["project_id"] = str(project_id)
        resp = self._http.request("GET", "/async-jobs", params=params)
        return JobPage.model_validate(resp.json())

    def get(self, job_id: IdLike) -> Job:
        resp = self._http.request("GET", f"/async-jobs/{job_id}")
        return Job.model_validate(resp.json())

    def wait(
        self,
        job_id: IdLike,
        timeout: float = 600.0,
        poll_interval: float = 2.0,
        on_progress: Callable[[Job], None] | None = None,
    ) -> Job:
        """轮询直到终态。failed/cancelled 抛 JobFailedError; 超时抛 JobTimeoutError。"""
        deadline = time.monotonic() + timeout
        while True:
            job = self.get(job_id)
            if on_progress is not None:
                on_progress(job)
            if job.status == "completed":
                return job
            if job.status in _JOB_TERMINAL:
                raise JobFailedError(job)
            if time.monotonic() >= deadline:
                raise JobTimeoutError(f"async job {job_id} 等待超过 {timeout}s 仍未到终态")
            time.sleep(poll_interval)


class Exports:
    def __init__(self, http: HttpTransport, jobs: Jobs):
        self._http = http
        self._jobs = jobs

    def create(
        self,
        project_id: IdLike,
        targets: list[str],
        include_attributes: bool | None = None,
        **kwargs: Any,
    ) -> str:
        """发起异步导出 (202), 返回 job_id; 参数走 query (与后端端点一致)。"""
        params: dict[str, Any] = {"targets": targets}
        if include_attributes is not None:
            params["include_attributes"] = include_attributes
        params.update(_drop_none(kwargs))
        resp = self._http.request("POST", f"/projects/{project_id}/export", params=params)
        return resp.json()["job_id"]

    def wait(
        self,
        job_id: IdLike,
        timeout: float = 600.0,
        poll_interval: float = 2.0,
        on_progress: Callable[[Job], None] | None = None,
    ) -> Job:
        return self._jobs.wait(
            job_id, timeout=timeout, poll_interval=poll_interval, on_progress=on_progress
        )

    def download(self, job_or_id: Job | IdLike, dest_path: str | Path) -> Path:
        """从 job.result["download_url"] 流式下载导出包到 dest_path。"""
        job = job_or_id if isinstance(job_or_id, Job) else self._jobs.get(job_or_id)
        url = (job.result or {}).get("download_url")
        if not url:
            raise AAPError(
                f"async job {job.id} (status={job.status}) 无 result.download_url, 无法下载"
            )
        return self._http.stream_download(url, Path(dest_path))


class ApiKeys:
    def __init__(self, http: HttpTransport):
        self._http = http

    def list(self) -> list[ApiKey]:
        resp = self._http.request("GET", "/me/api-keys")
        return [ApiKey.model_validate(x) for x in resp.json()]

    def create(self, name: str, scopes: Sequence[str] | None = None) -> ApiKeyCreated:
        resp = self._http.request(
            "POST", "/me/api-keys", json={"name": name, "scopes": list(scopes or [])}
        )
        return ApiKeyCreated.model_validate(resp.json())

    def revoke(self, key_id: IdLike) -> None:
        self._http.request("DELETE", f"/me/api-keys/{key_id}")


class Client:
    """AI 标注平台同步客户端。

    认证: Authorization: Bearer <api_key> (ak_ 开头的 API key 或 JWT, SDK 不区分)。
    base_url / api_key 缺省时依次回落环境变量 AAP_BASE_URL / AAP_API_KEY
    与 ~/.config/ai-annotation/config.toml (见 ai_annotation.config)。
    """

    def __init__(
        self,
        base_url: str | None = None,
        api_key: str | None = None,
        timeout: float = 30.0,
    ):
        base_url, api_key = load_config(base_url=base_url, api_key=api_key)
        if not base_url:
            raise AAPError(
                "缺少 base_url: 请传参或设置 AAP_BASE_URL / ~/.config/ai-annotation/config.toml"
            )
        self._http = HttpTransport(base_url, api_key, timeout=timeout)
        self.projects = Projects(self._http)
        self.datasets = Datasets(self._http)
        self.tasks = Tasks(self._http)
        self.annotations = Annotations(self._http)
        self.predictions = Predictions(self._http)
        self.jobs = Jobs(self._http)
        self.exports = Exports(self._http, self.jobs)
        self.api_keys = ApiKeys(self._http)

    def close(self) -> None:
        self._http.close()

    def __enter__(self) -> "Client":
        return self

    def __exit__(self, *exc: Any) -> None:
        self.close()
