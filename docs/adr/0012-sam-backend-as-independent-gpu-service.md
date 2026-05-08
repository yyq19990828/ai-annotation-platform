# 0012 — SAM 系列 backend 独立 GPU 服务化（不与 platform api 共进程）

- **Status:** Accepted
- **Date:** 2026-05-08（v0.9.5 落地时定型；实际决策发生于 v0.9.0 容器化拆分时，本次回填正式化）
- **Deciders:** core team
- **Supersedes:** —

## Context

v0.9.x 引入 Grounded-SAM-2 后，需要决定模型推理代码如何与平台 api（FastAPI 3.11 + asyncpg + redis）一起部署。v0.10.x 即将引入 SAM 3，后续可能还会引入 Florence-2 / DINO-X 等模型。

候选方案对比：

| 选项 | 主要卖点 | 主要劣势 |
|---|---|---|
| **方案 A**（已选）独立 docker service，HTTP 协议解耦 | 版本隔离 / 故障域独立 / 可单独水平扩 | 需要 HTTP 序列化开销（图像 URL 而非二进制） |
| 方案 B 平台 api 进程内直接 import torch + 模型 | 零网络开销 | torch + cuda 加载到 platform 进程，OOM 直接拖崩 api；版本不兼容 |
| 方案 C celery worker 进程内加载模型 | 无网络层 | celery worker 重启 = 模型重新加载（~30s）；无法独立扩缩 |

关键约束：

1. **Python / PyTorch / CUDA 版本不兼容**：v0.9.x Grounded-SAM-2 需要 Python 3.10 + PyTorch 2.3 + CUDA 12.1（GroundingDINO Deformable Attention 算子要 nvcc 现场编译），v0.10.x SAM 3 需要 Python 3.12 + PyTorch 2.7 + CUDA 12.6。两者**不能共存**于同一 Python 环境。
2. **故障域隔离**：模型 OOM / cuda OOM / 模型加载失败不应拖崩平台 api。
3. **GPU 资源调度**：生产部署时 GPU 节点单独打 taint，平台 api 跑 CPU 节点；docker-compose `profiles: ["gpu"]` 让本地 dev 也能按需启动。
4. **运维粒度**：「重启 SAM 模型」不应等于「重启平台」。

## Decision

**SAM 系列 backend 一律部署成独立 docker service，通过 HTTP 协议（`/predict` 等 4 端点）与平台 api 通信。**

具体落地约束：

- 镜像：基于 `pytorch/pytorch:2.3.1-cuda12.1-cudnn8-devel`（v0.9.x）/ `pytorch/pytorch:2.7.0-cuda12.6-cudnn-devel`（v0.10.x，待落）。**devel 必需**，因 GroundingDINO 算子要 nvcc 现场编译。
- TORCH_CUDA_ARCH_LIST=`7.0;7.5;8.0;8.6;8.9;9.0`（V100/T4/A100/RTX30/RTX40/H100 全覆盖）
- docker-compose service 配 `profiles: ["gpu"]` + nvidia device reservation + healthcheck `start_period=120s`（首次冷启动加载模型 ~80-100s）。
- 协议契约：`docs-site/dev/ml-backend-protocol.md` §2，4 端点 `GET /health` `GET /setup` `GET /versions` `POST /predict` + 观测端点 `GET /metrics` `GET /cache/stats`。
- 平台 api 通过 `apps/api/app/services/ml_client.py:MLBackendClient` 调用，所有 backend 共享同一抽象。
- `Settings.ml_backend_storage_host` env 处理 dev 场景下 SAM 容器无法访问 host `localhost:9000` MinIO 的问题（v0.9.4 phase 1 引入）。

## Consequences

正向：

- v0.10.x 引入 SAM 3 时只需新增 `apps/sam3-backend/` 镜像，**无需触碰** v0.9.x grounded-sam2-backend，`apps/api/app/db/models/ml_backend.py:MLBackend.url` 字段就是切换开关（项目设置选 backend 即可路由）。
- `apps/grounded-sam2-backend/` 出现 OOM / 加载失败时 platform api `/health` 仍 200，仅 `MLBackendClient.health()` 返回 disconnected，前端工作台「项目未绑定」提示明确。
- GPU 节点 / CPU 节点可分别 scale，`apps/api` 不依赖 GPU。

负向：

- 多一次 HTTP RTT（同 docker network 内 ~1-2ms 可忽略；跨节点 K8s 时需走 ClusterIP）。
- 镜像体积大（PyTorch 2.3 cuda12.1 devel ~5GB），首次 `docker pull` 慢。
- dev 场景下 SAM 容器跑在 host 进程外，访问 host MinIO 需 `ML_BACKEND_STORAGE_HOST` 重写（已在 v0.9.4 phase 1 处理）。

## Notes

- 实现代码位置：
  - `apps/grounded-sam2-backend/main.py`（FastAPI 入口 + 4 端点 + v0.9.5 `/health` 显存指标）
  - `apps/api/app/services/ml_client.py:21`（`MLBackendClient`）
  - `apps/api/app/api/v1/ml_backends.py:28`（`_resolve_task_url` 解决 dev 跨容器 URL 重写）
  - `docker-compose.yml` `grounded-sam2-backend` service `profiles: ["gpu"]`
- 协议契约：`docs-site/dev/ml-backend-protocol.md`
- 相关 ADR：ADR-0013（mask→polygon 后端化）
- 触发条件 / 后续 TODO：
  - 第一个生产 K8s 部署遇到跨 namespace / 跨集群时，可能需要扩 ADR 总结 `ML_BACKEND_STORAGE_HOST` 策略（目前仅 dev 单机用）。
