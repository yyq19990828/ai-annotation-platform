"""协议级能力注册表 (SSOT, 与 ml backend 注册解耦).

v0.14.11 引入。本模块定义平台对外承诺支持的「能力清单」, 是「模型市场 / 能力目录」
的协议层数据源:

- task / infra / modality / geometry 四张受控词表;
- 每条 task 的人类可读元数据 (label / 简介 / 协议要求 / 推荐 backend);
- 由 `GET /v1/ml-capabilities/protocol` 直接对外暴露 (无 project 作用域);
- 也被 `services/ml_capabilities.py` 内部消费 (受控词表 + task 默认几何)。

约束:
- 与 v0.14.9 协议 v2 边界严格一致, 不在本版扩展;
- 元数据 (label / summary / protocol_notes) 是产品文案, 改动不算 breaking change;
- 受控词表本身是协议契约, 任何增删都要走 ADR (本版不动)。
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class SuggestedBackend:
    """协议卡的接入引导. 既可以是「外部推荐」也可以是「平台自带参考实现」(后者用
    `builtin=True` 标识, 前端会用不同视觉权重展示)。"""

    name: str
    repo_url: str
    summary: str
    research_link: str | None = None  # 指向 docs/research/ 内的本平台调研结论
    infra: str | None = None  # 推荐 backend 的默认 infra (与受控 INFRAS 对齐)
    builtin: bool = False  # True = 平台自带, 已在 docker-compose 提供; False = 外部推荐


@dataclass(frozen=True)
class TaskSpec:
    id: str
    label: str  # 中文短标签 (UI 主标题)
    summary: str  # 一句话简介 (协议层语义, 不写「平台支持 N 个模型」)
    default_geometry: tuple[str, ...]  # task 未声明几何时按此补全
    default_modalities: tuple[str, ...]  # UI 徽标用
    typical_models: tuple[str, ...]  # 协议示例, 仅文档用途
    protocol_notes: str  # 在协议 v2 下的输出约束 (引用 ml-backend-protocol §4.1)
    suggested_backends: tuple[SuggestedBackend, ...] = field(default_factory=tuple)


@dataclass(frozen=True)
class InfraSpec:
    id: str
    label: str
    summary: str


@dataclass(frozen=True)
class ModalitySpec:
    id: str
    label: str
    summary: str


@dataclass(frozen=True)
class GeometrySpec:
    id: str
    label: str
    summary: str


# ── 9 个 task (v0.14.9 协议 v2 受控词表, 顺序即 UI 展示顺序) ───────────────────
TASKS: tuple[TaskSpec, ...] = (
    TaskSpec(
        id="detection",
        label="目标检测",
        summary="在图像或视频帧中输出 bbox + 类别标签。",
        default_geometry=("bbox",),
        default_modalities=("image", "video"),
        typical_models=("YOLO 系", "DETR 系", "Grounding DINO", "SAM3"),
        protocol_notes=(
            "/predict 响应 result.type=rectanglelabels, "
            "value 含 x/y/width/height + rectanglelabels[]; 协议 v2 §4.1 范例 A。"
        ),
        suggested_backends=(
            SuggestedBackend(
                name="Grounded-SAM-2 (gsam2)",
                repo_url="https://github.com/IDEA-Research/Grounded-SAM-2",
                summary="平台自带参考实现, docker-compose 内置. 文本/框 prompt 驱动开放词汇检测。",
                infra="pytorch",
                builtin=True,
            ),
            SuggestedBackend(
                name="SAM3 (sam3)",
                repo_url="https://github.com/facebookresearch/segment-anything",
                summary="平台自带参考实现, docker-compose 内置. SAM 系列检测/分割/交互一体。",
                infra="pytorch",
                builtin=True,
            ),
            SuggestedBackend(
                name="Label Studio ML Backend (YOLO)",
                repo_url="https://github.com/HumanSignal/label-studio-ml-backend",
                summary="官方示例覆盖 YOLOv8 / DETR, 适合上手。",
                research_link="docs/research/01-label-studio.md",
                infra="pytorch",
            ),
            SuggestedBackend(
                name="X-AnyLabeling",
                repo_url="https://github.com/CVHub520/X-AnyLabeling",
                summary="本平台 v0.14.x 重点参考的开源端, 自带多种检测模型。",
                research_link="docs/research/04-x-anylabeling.md",
                infra="pytorch",
            ),
        ),
    ),
    TaskSpec(
        id="obb",
        label="旋转框",
        summary="在图像中输出带旋转角度的矩形 (Oriented Bounding Box)。",
        default_geometry=("rotated_bbox",),
        default_modalities=("image",),
        typical_models=("YOLOv8-OBB", "Rotated DETR", "Oriented R-CNN"),
        protocol_notes=(
            "/predict 响应 value 含 x/y/width/height/rotation; "
            "rotation 单位为度 (0-360)。"
        ),
        suggested_backends=(
            SuggestedBackend(
                name="X-AnyLabeling (YOLOv8-OBB)",
                repo_url="https://github.com/CVHub520/X-AnyLabeling",
                summary="自带 OBB 模型, 协议直连本平台。",
                research_link="docs/research/04-x-anylabeling.md",
            ),
        ),
    ),
    TaskSpec(
        id="segmentation",
        label="实例分割",
        summary="为每个对象输出 polygon / multi_polygon 几何 + 类别。",
        default_geometry=("polygon",),
        default_modalities=("image",),
        typical_models=("Mask R-CNN", "YOLO-Seg", "SegFormer", "SAM3"),
        protocol_notes=(
            "/predict 响应 result.type=polygonlabels, value.points 为闭合多边形; "
            "可由平台 mask→polygon 转换器从 mask 像素输出派生。"
        ),
        suggested_backends=(
            SuggestedBackend(
                name="Grounded-SAM-2 (gsam2)",
                repo_url="https://github.com/IDEA-Research/Grounded-SAM-2",
                summary="平台自带参考实现, docker-compose 内置. mask 输出经平台转 polygon 落库。",
                infra="pytorch",
                builtin=True,
            ),
            SuggestedBackend(
                name="SAM3 (sam3)",
                repo_url="https://github.com/facebookresearch/segment-anything",
                summary="平台自带参考实现, docker-compose 内置. 高质量 SAM 系分割。",
                infra="pytorch",
                builtin=True,
            ),
            SuggestedBackend(
                name="Label Studio ML Backend (Mask R-CNN)",
                repo_url="https://github.com/HumanSignal/label-studio-ml-backend",
                summary="官方示例含 Mask R-CNN。",
                research_link="docs/research/01-label-studio.md",
                infra="pytorch",
            ),
        ),
    ),
    TaskSpec(
        id="keypoint",
        label="关键点",
        summary="输出 2D 关键点集合 (含可见性), 如人体姿态、面部关键点。",
        default_geometry=("keypoint",),
        default_modalities=("image",),
        typical_models=("YOLOv8-Pose", "HRNet", "OpenPose"),
        protocol_notes=(
            "/predict 响应 result.type=keypointlabels; 每点含 x/y/visibility, "
            "建议同时声明 skeleton 边以便平台渲染连线。"
        ),
        suggested_backends=(
            SuggestedBackend(
                name="X-AnyLabeling (YOLOv8-Pose)",
                repo_url="https://github.com/CVHub520/X-AnyLabeling",
                summary="提供 YOLOv8-Pose 关键点模型。",
                research_link="docs/research/04-x-anylabeling.md",
            ),
        ),
    ),
    TaskSpec(
        id="classification",
        label="图像分类",
        summary="对整张图或裁片输出类别标签, 无几何输出。",
        default_geometry=("none",),
        default_modalities=("image",),
        typical_models=("ResNet", "ViT", "EfficientNet"),
        protocol_notes=(
            "/predict 响应 result.type=choices, value.choices 为类别名数组; "
            "supported_geometric_outputs=['none']。"
        ),
        suggested_backends=(
            SuggestedBackend(
                name="Label Studio ML Backend (HuggingFace classifier)",
                repo_url="https://github.com/HumanSignal/label-studio-ml-backend",
                summary="HuggingFace transformer 分类示例。",
                research_link="docs/research/01-label-studio.md",
            ),
        ),
    ),
    TaskSpec(
        id="ocr",
        label="OCR",
        summary="从图像中提取文本框与文本内容 (v0.14.9 首发模型族)。",
        default_geometry=("bbox",),
        default_modalities=("image",),
        typical_models=("PaddleOCR", "EasyOCR", "RapidOCR"),
        protocol_notes=(
            "/predict 响应 result.value 含 bbox + attributes.text (必填), "
            "可选 attributes.language / attributes.orientation; 协议 v2 §4.1 范例 C。"
        ),
        suggested_backends=(
            SuggestedBackend(
                name="PaddleOCR (via Label Studio ML)",
                repo_url="https://github.com/PaddlePaddle/PaddleOCR",
                summary="工业级 OCR, Paddle infra; 可包装为 ML backend。",
                research_link=None,
            ),
            SuggestedBackend(
                name="RapidOCR (ONNX)",
                repo_url="https://github.com/RapidAI/RapidOCR",
                summary="ONNX runtime, CPU 友好, 部署简单。",
                research_link=None,
            ),
        ),
    ),
    TaskSpec(
        id="doc_layout",
        label="版面分析",
        summary="对文档页面输出版面元素区块 (标题/段落/表格/插图等)。",
        default_geometry=("bbox",),
        default_modalities=("image",),
        typical_models=("LayoutLMv3", "PP-StructureV2", "DiT"),
        protocol_notes=(
            "/predict 响应 result.value 含 bbox + class_name "
            "(受控: title/paragraph/table/figure/formula/list/header/footer); "
            "协议 v2 §4.1 范例 C。"
        ),
        suggested_backends=(
            SuggestedBackend(
                name="PP-StructureV2",
                repo_url="https://github.com/PaddlePaddle/PaddleOCR/tree/main/ppstructure",
                summary="Paddle 版面分析, 含 table / formula 识别。",
                research_link=None,
            ),
        ),
    ),
    TaskSpec(
        id="tracker",
        label="视频追踪",
        summary="跨帧追踪同一对象, 输出对象 id + 每帧 bbox。",
        default_geometry=(),
        default_modalities=("video",),
        typical_models=("ByteTrack", "OC-SORT", "SAM2 Video"),
        protocol_notes=(
            "/setup.supported_trackers 声明可用 tracker; /predict 在视频帧上"
            "返回带 instance_id 的 bbox 序列。"
        ),
        suggested_backends=(
            SuggestedBackend(
                name="Grounded-SAM-2 (gsam2)",
                repo_url="https://github.com/IDEA-Research/Grounded-SAM-2",
                summary="平台自带参考实现, docker-compose 内置. 含 SAM2 Video 视频追踪能力。",
                infra="pytorch",
                builtin=True,
            ),
        ),
    ),
    TaskSpec(
        id="interactive_seg",
        label="交互分割",
        summary="基于用户 prompt (点/框/文本) 对图像做交互式实例分割。",
        default_geometry=("polygon",),
        default_modalities=("image",),
        typical_models=("SAM", "SAM2", "SAM3", "Grounded-SAM"),
        protocol_notes=(
            "/setup.supported_prompts 含 point/bbox/text/exemplar; "
            "/predict 响应 mask 或 polygon, 平台按 v0.10.x 转换为 polygon 落库。"
        ),
        suggested_backends=(
            SuggestedBackend(
                name="Grounded-SAM-2 (gsam2)",
                repo_url="https://github.com/IDEA-Research/Grounded-SAM-2",
                summary="平台自带参考实现, docker-compose 内置. 文本+框 prompt 开放词汇交互分割。",
                infra="pytorch",
                builtin=True,
            ),
            SuggestedBackend(
                name="SAM3 (sam3)",
                repo_url="https://github.com/facebookresearch/segment-anything",
                summary="平台自带参考实现, docker-compose 内置. Meta 官方 SAM 高质量分割。",
                infra="pytorch",
                builtin=True,
            ),
        ),
    ),
)


# ── 6 个 infra (v0.14.9 协议 v2 受控词表) ──────────────────────────────────────
INFRAS: tuple[InfraSpec, ...] = (
    InfraSpec(id="pytorch", label="PyTorch", summary="原生 .pt / TorchScript 部署。"),
    InfraSpec(id="onnx", label="ONNX", summary="跨框架推理, 与硬件解耦。"),
    InfraSpec(
        id="paddle",
        label="Paddle",
        summary="PaddlePaddle / PaddleOCR / PP-Detection 系。",
    ),
    InfraSpec(id="tensorrt", label="TensorRT", summary="NVIDIA GPU 高性能推理。"),
    InfraSpec(id="openvino", label="OpenVINO", summary="Intel CPU / iGPU / NPU 优化。"),
    InfraSpec(id="other", label="其他", summary="协议允许的自定义运行时声明。"),
)


# ── 3 个 modality (与 services/ml_capabilities.derive_modalities 实际输出对齐) ──
# 注: text / point_cloud 是预留语义, 暂未由 derive_modalities 产出, 不进受控表。
MODALITIES: tuple[ModalitySpec, ...] = (
    ModalitySpec(id="image", label="图像", summary="2D 图片 (含视频单帧)。"),
    ModalitySpec(id="video", label="视频", summary="多帧视频序列。"),
    ModalitySpec(
        id="lidar",
        label="点云",
        summary="3D LiDAR 点云 (含 6 相机融合场景帧)。",
    ),
)


# ── 8 个 geometry (复用 supported_geometric_outputs 字段值) ───────────────────
GEOMETRIES: tuple[GeometrySpec, ...] = (
    GeometrySpec(id="bbox", label="bbox", summary="2D 轴对齐矩形。"),
    GeometrySpec(
        id="rotated_bbox", label="rotated bbox", summary="带旋转角度的 2D 矩形 (OBB)。"
    ),
    GeometrySpec(
        id="polygon", label="polygon", summary="2D 多边形 (单环或 multi_polygon)。"
    ),
    GeometrySpec(id="polyline", label="polyline", summary="2D 折线。"),
    GeometrySpec(id="keypoint", label="keypoint", summary="2D 关键点集合 (含可见性)。"),
    GeometrySpec(
        id="lidar_box_3d", label="3D box", summary="3D 立体框, 用于点云标注。"
    ),
    GeometrySpec(id="point_mask_3d", label="point mask 3D", summary="点云逐点 mask。"),
    GeometrySpec(id="none", label="none", summary="纯分类等无几何输出。"),
)


# ── 派生表 (供 ml_capabilities.py 消费, 避免双份维护) ───────────────────────────
INFRA_VALUES: tuple[str, ...] = tuple(s.id for s in INFRAS)
TASK_VALUES: tuple[str, ...] = tuple(s.id for s in TASKS)
GEOMETRY_VALUES: tuple[str, ...] = tuple(s.id for s in GEOMETRIES)
MODALITY_VALUES: tuple[str, ...] = tuple(s.id for s in MODALITIES)

TASK_DEFAULT_GEOMETRY: dict[str, list[str]] = {
    s.id: list(s.default_geometry) for s in TASKS
}
