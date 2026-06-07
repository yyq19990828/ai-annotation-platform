"""Mock 协议 v2 ML backend — 多模型目录 + infra + OCR / doc_layout 演示 (无真实推理).

用途: 平台「能力声明协议 v2」端到端冒烟与接入参考。
- `/setup` 暴露 YOLO 风格多任务 models[] (detection / segmentation / keypoint / obb /
  classification) + PaddleOCR / DocLayout 条目, 每条带 task / infra / 几何 / variants。
- `/predict` 按 `context.type` (task_type) 返回固定 demo 结果; OCR 条目在 result shape
  顶层带 `attributes.text`, 供平台 OCR adapter 提取 → annotation.attributes。

启动:
    pip install -r requirements.txt
    uvicorn main:app --host 0.0.0.0 --port 9100
"""

from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI()


# series × size 两轴变体 (复用平台 supported_variants 多轴结构)。
_YOLO_VARIANTS = [
    {
        "key": "series",
        "title": "版本系列",
        "variants": [
            {"value": "yolov8", "label": "YOLOv8"},
            {"value": "yolo11", "label": "YOLO11", "recommended": True},
            {"value": "yolo12", "label": "YOLO12"},
        ],
    },
    {
        "key": "size",
        "title": "尺寸 / 精度档",
        "variants": [
            {"value": "n", "label": "nano", "vram_gb": 1, "tier": "fast"},
            {"value": "s", "label": "small", "vram_gb": 2, "tier": "balanced", "recommended": True},
            {"value": "m", "label": "medium", "vram_gb": 4},
            {"value": "l", "label": "large", "vram_gb": 6},
            {"value": "x", "label": "xlarge", "vram_gb": 8, "tier": "accurate"},
        ],
    },
]


def _yolo_params() -> dict:
    return {
        "type": "object",
        "properties": {
            "conf": {"type": "number", "minimum": 0, "maximum": 1, "default": 0.25, "title": "置信度阈值"},
            "iou": {"type": "number", "minimum": 0, "maximum": 1, "default": 0.7, "title": "NMS IoU"},
            "series": {"type": "string", "enum": ["yolov8", "yolo11", "yolo12"], "default": "yolo11", "title": "版本系列"},
            "size": {"type": "string", "enum": ["n", "s", "m", "l", "x"], "default": "s", "title": "尺寸"},
        },
    }


MODELS = [
    {
        "id": "yolo-detect", "display_name": "YOLO 目标检测", "task": "detection",
        "model_family": "yolo", "infra": "pytorch", "supported_prompts": ["none"],
        "supported_geometric_outputs": ["bbox"], "supported_variants": _YOLO_VARIANTS,
        "default_thresholds": {"conf": 0.25, "iou": 0.7},
        "resource_profile": {"device": "gpu", "batchable": True}, "params": _yolo_params(),
    },
    {
        "id": "yolo-segment", "display_name": "YOLO 实例分割", "task": "segmentation",
        "model_family": "yolo", "infra": "pytorch", "supported_prompts": ["none"],
        "supported_geometric_outputs": ["polygon"], "supported_variants": _YOLO_VARIANTS,
        "resource_profile": {"device": "gpu", "batchable": True}, "params": _yolo_params(),
    },
    {
        "id": "yolo-pose", "display_name": "YOLO 姿态 / 关键点", "task": "keypoint",
        "model_family": "yolo", "infra": "pytorch", "supported_prompts": ["none"],
        "supported_geometric_outputs": ["keypoint"], "supported_variants": _YOLO_VARIANTS,
        "resource_profile": {"device": "gpu", "batchable": True}, "params": _yolo_params(),
    },
    {
        "id": "yolo-obb", "display_name": "YOLO 旋转框", "task": "obb",
        "model_family": "yolo", "infra": "pytorch", "supported_prompts": ["none"],
        "supported_geometric_outputs": ["rotated_bbox"], "supported_variants": _YOLO_VARIANTS,
        "resource_profile": {"device": "gpu", "batchable": True}, "params": _yolo_params(),
    },
    {
        "id": "yolo-classify", "display_name": "YOLO 图像分类", "task": "classification",
        "model_family": "yolo", "infra": "pytorch", "supported_prompts": ["none"],
        "supported_geometric_outputs": ["none"], "output_attribute_types": ["class"],
        "supported_variants": _YOLO_VARIANTS,
        "resource_profile": {"device": "gpu", "batchable": True}, "params": _yolo_params(),
    },
    {
        "id": "ppocr", "display_name": "PaddleOCR (mock)", "task": "ocr",
        "model_family": "paddleocr", "infra": "paddle", "supported_prompts": ["none"],
        "supported_geometric_outputs": ["polygon"], "output_attribute_types": ["text", "language"],
        "resource_profile": {"device": "cpu", "batchable": True},
        "params": {
            "type": "object",
            "properties": {
                "det_db_thresh": {"type": "number", "minimum": 0, "maximum": 1, "default": 0.3, "title": "文本检测阈值"},
            },
        },
    },
    {
        "id": "doclayout", "display_name": "DocLayout-YOLO (mock)", "task": "doc_layout",
        "model_family": "doclayout-yolo", "infra": "onnx", "supported_prompts": ["none"],
        "supported_geometric_outputs": ["bbox"],
        "resource_profile": {"device": "cpu", "batchable": True},
        "params": {
            "type": "object",
            "properties": {
                "conf": {"type": "number", "minimum": 0, "maximum": 1, "default": 0.25, "title": "置信度阈值"},
            },
        },
    },
]


@app.get("/health")
def health() -> dict:
    return {"ok": True}


@app.get("/setup")
def setup() -> dict:
    # 协议 v2: backend 默认 infra=onnx, 各 model 条目可覆盖 (yolo→pytorch, ppocr→paddle)。
    return {
        "name": "mock-v2-backend",
        "version": "0.1.0",
        "model_version": "mock-v2",
        "is_interactive": False,
        "infra": "onnx",
        "models": MODELS,
    }


@app.get("/versions")
def versions() -> dict:
    return {"versions": ["mock-v2"]}


class TaskItem(BaseModel):
    id: str
    file_path: str | None = None


class PredictRequest(BaseModel):
    tasks: list[TaskItem] = []
    task: TaskItem | None = None
    context: dict = {}


def _demo_shapes(task_type: str | None) -> list[dict]:
    """按 task_type 返回固定 demo result (LabelStudio 风格 + OCR attributes)。"""
    if task_type == "ocr":
        return [
            {
                "type": "rectanglelabels",
                "value": {"x": 10, "y": 8, "width": 34, "height": 6, "rectanglelabels": ["text"]},
                "score": 0.96,
                "attributes": {"text": "发票号码 0012345", "language": "zh"},
            },
            {
                "type": "rectanglelabels",
                "value": {"x": 10, "y": 20, "width": 42, "height": 6, "rectanglelabels": ["text"]},
                "score": 0.93,
                "attributes": {"text": "金额 ¥ 1,280.00", "language": "zh"},
            },
        ]
    if task_type == "doc_layout":
        return [
            {"type": "rectanglelabels", "value": {"x": 8, "y": 6, "width": 60, "height": 10, "rectanglelabels": ["title"]}, "score": 0.90},
            {"type": "rectanglelabels", "value": {"x": 8, "y": 20, "width": 80, "height": 40, "rectanglelabels": ["paragraph"]}, "score": 0.88},
        ]
    # detection 等几何任务默认: 单个 demo bbox。
    return [
        {"type": "rectanglelabels", "value": {"x": 12, "y": 15, "width": 25, "height": 30, "rectanglelabels": ["object"]}, "score": 0.91},
    ]


@app.post("/predict")
def predict(req: PredictRequest) -> dict:
    task_type = (req.context or {}).get("type")
    shapes = _demo_shapes(task_type)
    # 交互式单条 (无外层 results 数组)。
    if req.task is not None and not req.tasks:
        return {"result": shapes, "score": 0.9, "model_version": "mock-v2", "inference_time_ms": 5}
    # 批量。
    results = [
        {"task": t.id, "result": shapes, "score": 0.9, "model_version": "mock-v2", "inference_time_ms": 5}
        for t in req.tasks
    ]
    return {"results": results}
