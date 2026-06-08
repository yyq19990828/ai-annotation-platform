# aap-protocol-v2

ML backend 协议 v2 的共享 Pydantic schema 与受控词表常量。

被 `apps/sam3-backend` / `apps/grounded-sam2-backend` / `apps/yolo-backend` 等 backend 编辑安装复用，单一来源避免协议字段在各 backend 之间漂移。

## 边界

**包含**：
- `aap_protocol_v2.schemas` — 跨 backend 通用的请求 / 响应 Pydantic 模型
  - `TaskItem` (id + file_path)
  - `PredictionResult` (单 task 的预测结果壳)
  - `BatchPredictResponse` (`/predict` 顶层响应)
- `aap_protocol_v2.vocab` — 协议 v2 受控词表常量（与 `apps/api/app/services/capability_registry.py` SSOT 同源镜像）
  - `TASK_VALUES` / `INFRA_VALUES` / `GEOMETRY_VALUES` / `PROMPT_VALUES`

**不包含**：
- 每个 backend 的 `Context` —— prompt 字段集差异大（sam3 有 `exemplar`、yolo 走 `variants`），各 backend 自己定义。
- `/setup` 字典字面量 —— 各 backend 自己构造。
- 任何抽象基类、推理生命周期、模型池等业务实现。详见 [ADR-0038](../../../docs/adr/0038-defer-ml-backend-base-class.md)。

## 协议版本同步

`vocab.py` 的常量值与 `apps/api/app/services/capability_registry.py` 的 `TASK_VALUES` / `INFRA_VALUES` / `GEOMETRY_VALUES` 手工同源。协议 v2 词表稳定后改动概率低；若 capability_registry 扩展，需要镜像更新此处并 bump 本包 minor 版本。

## 引用方式（backend Dockerfile）

```dockerfile
# build context = ./apps
COPY _shared/protocol_v2/ /app/protocol_v2/
RUN pip install --no-build-isolation -e /app/protocol_v2
```

backend 代码：

```python
from aap_protocol_v2.schemas import TaskItem, PredictionResult, BatchPredictResponse
from aap_protocol_v2.vocab import TASK_VALUES, INFRA_VALUES
```
