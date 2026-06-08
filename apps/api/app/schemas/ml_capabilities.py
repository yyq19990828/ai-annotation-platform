"""v0.14.11 · 协议级能力目录响应 schema.

承载 `GET /v1/ml-capabilities/protocol` 的 pydantic 模型。与
`services/capability_registry.py` 的 dataclass 一一对应; 前端 codegen 派生类型。
"""

from __future__ import annotations

from pydantic import BaseModel


class SuggestedBackendItem(BaseModel):
    name: str
    repo_url: str
    summary: str
    research_link: str | None = None
    infra: str | None = None  # 与受控 INFRAS 对齐 (pytorch / onnx / ...)
    builtin: bool = False  # True = 平台 docker-compose 自带; False = 外部推荐


class ProtocolTaskItem(BaseModel):
    id: str
    label: str
    summary: str
    default_geometry: list[str]
    default_modalities: list[str]
    typical_models: list[str]
    protocol_notes: str
    suggested_backends: list[SuggestedBackendItem] = []


class ProtocolInfraItem(BaseModel):
    id: str
    label: str
    summary: str


class ProtocolModalityItem(BaseModel):
    id: str
    label: str
    summary: str


class ProtocolGeometryItem(BaseModel):
    id: str
    label: str
    summary: str


class InstanceModelItem(BaseModel):
    """实例级 model 视图 (字段裁剪自协议 v2 ModelCapability, 不暴露 variants /
    resource_profile / params 等运维信息)。"""

    id: str
    display_name: str
    task: str = "unknown"
    infra: str | None = None
    is_interactive: bool = False
    supported_prompts: list[str] = []
    supported_geometric_outputs: list[str] = []
    supported_trackers: list[str] = []
    modality: str | None = None


class CapabilityInstanceItem(BaseModel):
    """平台已知 backend 的实例视图 (env-only 容器 + 项目级注册合并)。

    `source` = "env_only" 表示 docker-compose 自带或运维 env 配的容器,
              "registered" 表示项目级 ml_backends 表里有记录。
    `name` 是 backend 显示名 (env-only 取 /setup.name, registered 取 ml_backend.name)。
    不暴露 url / project_id / health 指标, 让普通登录用户安全消费。
    """

    source: str
    name: str
    infra: str = "unknown"
    models: list[InstanceModelItem] = []


class CapabilityInstancesResponse(BaseModel):
    instances: list[CapabilityInstanceItem]


class ProtocolCapabilitiesResponse(BaseModel):
    """协议能力目录响应顶层结构。

    `version` 与 ml-backend-protocol 协议版本对齐 (当前 v2); 受控词表的不兼容
    变更才 bump (新增 task 不算)。
    """

    version: str
    tasks: list[ProtocolTaskItem]
    infras: list[ProtocolInfraItem]
    modalities: list[ProtocolModalityItem]
    geometries: list[ProtocolGeometryItem]
