from datetime import datetime
from urllib.parse import urlparse
from uuid import UUID

from pydantic import BaseModel, Field, field_validator


_LOOPBACK_HOSTS = {"localhost", "127.0.0.1", "0.0.0.0", "::1"}


def _validate_ml_backend_url(v: str) -> str:
    """v0.9.8 · 拒绝 loopback host. 容器内无法访问宿主机 localhost,
    跑预标会直接 connection refused. 提示用 docker bridge IP / service DNS.

    与 v0.9.6 前端 placeholder (runtime-hints.ml_backend_default_url) 配套.
    """
    parsed = urlparse(v)
    host = (parsed.hostname or "").lower()
    if host in _LOOPBACK_HOSTS:
        raise ValueError(
            "URL 不能用 loopback host (localhost / 127.0.0.1); "
            "容器内访问宿主机请用 docker bridge IP (如 172.17.0.1) 或 service DNS. "
            "默认值参考 GET /runtime-hints.ml_backend_default_url"
        )
    return v


class MLBackendCreate(BaseModel):
    name: str
    url: str
    is_interactive: bool = False
    auth_method: str = "none"
    auth_token: str | None = None
    extra_params: dict = {}

    @field_validator("url")
    @classmethod
    def _no_loopback(cls, v: str) -> str:
        return _validate_ml_backend_url(v)


class MLBackendUpdate(BaseModel):
    name: str | None = None
    url: str | None = None
    is_interactive: bool | None = None
    auth_method: str | None = None
    auth_token: str | None = None
    extra_params: dict | None = None

    @field_validator("url")
    @classmethod
    def _no_loopback(cls, v: str | None) -> str | None:
        if v is None:
            return v
        return _validate_ml_backend_url(v)


# v0.9.11 PerfHud · health_meta 子结构 (Pydantic 模型 → 前端 codegen 派生类型)
class GpuInfo(BaseModel):
    device_name: str | None = None
    memory_used_mb: int | None = None
    memory_total_mb: int | None = None
    memory_free_mb: int | None = None
    gpu_utilization_percent: int | None = None
    gpu_temperature_celsius: int | None = None
    gpu_power_watts: float | None = None


class HostInfo(BaseModel):
    container_cpu_percent: float | None = None
    container_memory_percent: float | None = None


class CacheStats(BaseModel):
    hits: int | None = None
    misses: int | None = None
    size: int | None = None
    capacity: int | None = None
    hit_rate: float | None = None

    class Config:
        extra = "allow"  # backend 可能扩展指标, 不强约束


class ModelCapability(BaseModel):
    """v0.14.9 · 能力声明协议 v2 — 单个 model 条目 (一个 backend 暴露 N 个).

    由 services/ml_capabilities._normalize_model 规范化后存入
    BackendCapabilities.models; `task` 是条目边界 (决定输出几何与项目兼容性),
    `infra` 缺省继承 backend 默认, `modality` 为派生视图。"""

    id: str
    display_name: str | None = None
    task: str = "unknown"
    model_family: str | None = None
    infra: str = "unknown"
    is_interactive: bool = False
    supported_prompts: list[str] = []
    # v0.21.0 · 一等输入契约 (full_image/crop/bbox_prompt/point_prompt/video)。
    supported_inputs: list[str] = []
    default_input_type: str | None = None
    supported_geometric_outputs: list[str] = []
    output_attribute_types: list[str] = []
    # 协议③ · 属性 schema 自描述 ([{key,label,type,options}]), 供平台导入项目 attribute_schema.
    output_attribute_schema: list[dict] = []
    supported_text_outputs: list[str] = []
    supported_trackers: list[str] = []
    # v0.21.19 · text-driven tracker (sam3_video) 子集; propagate 需 text/exemplars。
    text_driven_trackers: list[str] = []
    supported_variants: list[dict] = []
    # v0.14.12 · 多轴 variants 非笛卡尔积时显式列举合法组合 (前端目录展开用).
    variant_combinations: list[list[str]] = []
    # v0.14.12 · 同 backend 多 task 是否共享物理权重 (SAM 类共享, yolo 分 task).
    variants_shared_across_tasks: bool = False
    # v0.14.13 · backend 自报的默认 variant 组合 (dict[axis_key, value]).
    default_variants: dict[str, str] = {}
    default_thresholds: dict = {}
    resource_profile: dict = {}
    # 协议 v2.2 · 原子 vs 内部编排维度：atom=单次推理原子；composite=一个 model 内部编排多原子。
    # 缺省 atom（老 backend 无字段即按原子处理）。编排下游 stage 据此过滤（只组合 atom）。
    composition: str = "atom"
    params: dict = {}
    modality: str | None = None
    # v0.14.17 · 闭集检测器原生类别表 ([{index,name}], 读自权重 model.names). 供前端类别白名单;
    # 仅该 task 模型已加载过 (warmup/predict) 时非空。
    classes: list[dict] = []

    class Config:
        extra = "allow"


class CapabilityWarning(BaseModel):
    """v0.18.29 · backend `/setup` 上报值的受控词表校验诊断 (越界即记, 不阻断解析)。

    由 services/ml_capabilities._collect_warnings 产出; 前端模型市场据此显示 ⚠ +
    可读原因, 把「字段拼错 / 值越界致工具静默不亮」变成可见信号。"""

    level: str = "warning"  # warning | info
    model_id: str | None = None
    field: str
    value: str
    message: str


class BackendCapabilities(BaseModel):
    """v0.10.37 · backend `/setup` 能力快照 (epic 阶段 1).

    由 services/ml_backend.check_health 探 `/setup` 后落进 health_meta["capabilities"];
    `modalities` 为派生视图 (image / video / lidar), 见 services/ml_capabilities.derive_modalities.

    v0.14.9 · 能力声明协议 v2: 新增 `infra` (backend 默认基础设施) + `models` (多模型目录);
    其余顶层字段为各 model 的「扁平并集」, 供未迁移消费方继续读 (向后兼容)。"""

    # v0.14.12 · backend 自报名 (如 "grounded-sam2-backend"), 用于前端能力目录展示
    # 源 backend 名 (而非用户在项目里取的别名)。
    name: str | None = None
    # v0.14.9 · 协议 v2 新增
    infra: str = "unknown"
    # v0.14.14 · backend 是否支持 POST /warmup (协议 §4.4). 老 backend 缺字段 = False.
    warmup_endpoint: bool = False
    models: list[ModelCapability] = []
    # 扁平并集 (向后兼容)
    is_interactive: bool = False
    supported_prompts: list[str] = []
    supported_inputs: list[str] = []
    supported_trackers: list[str] = []
    # v0.21.19 · text-driven tracker (sam3_video) 子集; propagate 需 text/exemplars。
    text_driven_trackers: list[str] = []
    supported_text_outputs: list[str] = []
    supported_geometric_outputs: list[str] = []
    modalities: list[str] = []
    # v0.18.29 · 受控词表校验诊断 (越界 task/infra/prompt/geometry); 空 = 全合法。
    warnings: list[CapabilityWarning] = []


class ComputeInfo(BaseModel):
    """Backend 有效计算设备观测 (五镜像统一)。

    v0.22.3 WS4 · torch 系 (yolo/gsam2/sam3) 填 ``effective_device`` ("cuda"/"cpu"/None),
    ORT 系 (rapidocr/onnxtools) 填 ``effective_provider`` (如 "CPUExecutionProvider"/
    "CUDAExecutionProvider")。``configured_device`` 为配置意图; 当其非 "cpu" 而有效设备
    已退回 CPU 时, 前端显示「⚠ CPU 回退」告警角标。
    """

    configured_device: str | None = None
    effective_device: str | None = None
    effective_provider: str | None = None

    class Config:
        extra = "allow"


class HealthMeta(BaseModel):
    """v0.9.11 · backend `/health` 深度指标缓存. 由 services/ml_backend.check_health 写入,
    `/admin/ml-integrations/overview` + PerfHud WS 消费."""

    gpu_info: GpuInfo | None = None
    host: HostInfo | None = None
    cache: CacheStats | None = None
    model_version: str | None = None
    # v0.10.37 · /setup 能力快照 (epic 阶段 1)
    capabilities: BackendCapabilities | None = None
    # v0.22.3 WS4 · 有效计算设备观测 (GPU 静默退回 CPU 告警用)。
    compute: ComputeInfo | None = None

    class Config:
        extra = "allow"


class MLBackendOut(BaseModel):
    id: UUID
    # v0.19.0 ADR-0044 · backend 上提为全局注册项, 无项目归属; 项目作用域端点从路径注入
    # 本项目 id (表「该项目启用了此全局 backend」), 全局/admin 端点留 None。
    project_id: UUID | None = None
    name: str
    url: str
    state: str
    is_interactive: bool
    auth_method: str
    extra_params: dict
    # v0.9.6 · 缓存的 backend `/health` 深度指标 (gpu_info / cache / model_version);
    # 由 services/ml_backend.check_health 写入, /admin/ml-integrations/overview 直接消费.
    # v0.9.11 · 类型从 dict 收紧到 HealthMeta (含 host PerfHud 字段), 前端 codegen 派生.
    health_meta: HealthMeta | None = None
    error_message: str | None
    last_checked_at: datetime | None = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


# v0.9.11 PerfHud · WS /ws/ml-backend-stats 推送的单次快照
class MLBackendStatsBinding(BaseModel):
    backend_id: UUID
    backend_name: str
    project_id: UUID | None = None
    project_display_id: str | None = None
    project_name: str | None = None


class MLBackendStatsSnapshot(BaseModel):
    physical_key: str | None = None
    url_host: str | None = None
    backend_id: UUID
    backend_name: str | None = None
    bindings: list[MLBackendStatsBinding] = Field(default_factory=list)
    state: str
    gpu_info: GpuInfo | None = None
    host: HostInfo | None = None
    cache: CacheStats | None = None
    model_version: str | None = None
    loaded: bool | None = None
    idle_unload_seconds: float | None = None
    last_request_age_seconds: float | None = None
    pool: dict | None = None
    video_pool: dict | None = None
    # v0.22.3 WS4 · 有效计算设备观测 (GPU 静默退回 CPU 告警用)。
    compute: ComputeInfo | None = None
    timestamp: datetime


class MLBackendHealthResponse(BaseModel):
    status: str
    backend_id: UUID
    backend_name: str


# v0.19.0 ADR-0044 · 项目「启用勾选清单」: 列出全部全局 backend + 本项目启用态/覆盖。
class ProjectMLBackendItem(BaseModel):
    """一行 = 一个全局 backend 在本项目的启用态 + 项目级覆盖。

    `backend` 是全局注册项快照 (project_id=None); `enabled`/`default_variants` 来自
    project_ml_backend 关联 (无关联则 enabled=False、覆盖 None)。"""

    backend: MLBackendOut
    enabled: bool = False
    default_variants: dict | None = None


class ProjectMLBackendList(BaseModel):
    items: list[ProjectMLBackendItem]


class ProjectMLBackendEnablement(BaseModel):
    """切换项目启用 + 写项目级变体覆盖。覆盖项缺省 = 不改动。"""

    enabled: bool
    default_variants: dict | None = None


# v0.10.26 · 模型市场单变体预热. 缺省时 backend 用默认变体 (保持旧 /reload 行为).
class MLBackendReloadRequest(BaseModel):
    sam_variant: str | None = None
    dino_variant: str | None = None
    # v0.10.36 · "image" 预热图片池 (默认), "video" 预热独立 video tracker 池 (仅认 sam_variant)
    task_type: str | None = None


class InteractiveRequest(BaseModel):
    """工作台「AI 助手」单次推理请求。`context` 透传至 backend，平台不做 schema 校验。

    `context.type` 协商枚举（详见 `docs-site/dev/ml-backend-protocol.md` §2.2）：
    - ``point``：``{"type":"point","points":[[x,y],...],"labels":[1,0,...],"multimask_output":false}``
      （v0.18.17 · SAM-style 单实例点交互, 正/负点累加由前端重发全量点; multimask 出 3 候选）
    - ``interactive_box``：``{"type":"interactive_box","bbox":[x1,y1,x2,y2],"multimask_output":false}``
      （v0.18.17 · SAM-style 单框单 mask; 双 backend 统一名, 旧 ``bbox`` prompt 已退役）
    - ``polygon``：``{"type":"polygon","points":[[x,y],...]}``
    - ``text``：``{"type":"text","text":"ripe apples"}``（Grounded-SAM-2 DINO / SAM 3 PCS）
    - ``exemplar``：``{"type":"exemplar","bbox":[x1,y1,x2,y2]}`` 或多正负框
      ``{"type":"exemplar","exemplars":[{"bbox":[...],"label":true},...],"text":"car","score_threshold":0.5}``
      （SAM 3 PCS 全图相似实例; v0.18.19 起支持多正负框累加 + text 概念组合 + 阈值重过滤的迭代 refinement）。
    """

    task_id: UUID
    context: dict = Field(
        default_factory=dict,
        description="开放 dict；type 字段见 schema docstring 与协议文档 §2.2。",
    )
