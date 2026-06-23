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


class InstanceVariantOption(BaseModel):
    """variants axis 内一条选项 (透传自 backend /setup; 用于前端列表按 axis 拆行)."""

    value: str
    label: str | None = None
    vram_gb: float | None = None
    tier: str | None = None
    recommended: bool = False
    note: str | None = None


class InstanceVariantGroup(BaseModel):
    """variants 多轴的单根轴 (序列保持与 backend /setup 顺序一致)."""

    key: str
    title: str | None = None
    description: str | None = None
    variants: list[InstanceVariantOption] = []


class InstanceModelItem(BaseModel):
    """实例级 model 视图 (字段裁剪自协议 v2 ModelCapability, 不暴露 resource_profile /
    params 等运维信息; v0.14.12 起补 supported_variants + variant_combinations 让
    前端能按主轴展开「具体模型」行)."""

    id: str
    display_name: str
    task: str = "unknown"
    model_family: str | None = None
    infra: str | None = None
    is_interactive: bool = False
    supported_prompts: list[str] = []
    supported_geometric_outputs: list[str] = []
    supported_trackers: list[str] = []
    # 协议③ · 属性输出类型 + schema 自描述 (含 select options), 供「从 backend 导入属性」.
    output_attribute_types: list[str] = []
    output_attribute_schema: list[dict] = []
    modality: str | None = None
    supported_variants: list[InstanceVariantGroup] = []
    variant_combinations: list[list[str]] = []
    # v0.14.12 · True 表示同 backend 内多个 task 共享同一份物理权重 (如 gsam2 的 SAM2
    # 权重同时被 segmentation / interactive_seg / tracker 用). 前端列表据此把跨 task
    # 的同 variant 合并到一行, 而不是为每个 task 重复显示。yolo 每 task 独立权重
    # (yolov8n-det.pt vs yolov8n-obb.pt), 缺省 False 保持「每 task 一行 + 任务后缀」。
    variants_shared_across_tasks: bool = False
    # v0.14.13 · backend 自报的默认 variant 组合 (dict[axis_key, value]).
    # 前端 VariantSelector 在用户未选时取此作初值; 优先级链:
    # 项目级 project.default_variants[backend_id] > 本字段 > backend 启动 env 默认.
    default_variants: dict[str, str] = {}


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
    # v0.14.14 · backend 是否支持 POST /warmup (协议 §4.4); 前端模型市场"⚡ 预热"
    # 按钮据此置灰. 老 backend 缺字段 = False.
    warmup_endpoint: bool = False
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
