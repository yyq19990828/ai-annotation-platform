# 部署与运维

面向将本平台部署到生产环境的工程师和 SRE。

## 快速入口

### 部署

- [部署总览](/ops/deploy/) — 开发 / 生产分流入口，两态差异速览
- [开发部署（本地）](/ops/deploy/development) — 基础设施进容器、API/Web 跑宿主机热更新
- [生产部署](/ops/deploy/docker-compose) — Docker Compose 生产部署、环境变量、反向代理
- [端口暴露与网络安全](/ops/deploy/network-security) — 端口该不该对外、Docker 绕 ufw、远程 SDK 安全访问
- [升级指南](/ops/upgrade-guide) — 镜像 rebuild / restart、数据库迁移与版本升级检查

### 可观测性

- [监控与告警](/ops/observability/) — Prometheus / Grafana 集成、Celery 任务监控、性能 HUD
- [Celery Worker 卡死](/ops/runbooks/celery-worker-stuck) — worker 卡住、队列堆积、任务无法消费
- [ML Backend 不可用](/ops/runbooks/ml-backend-down) — 模型服务不可达、健康检查失败或 GPU 加载异常
- [视频帧服务排障](/ops/runbooks/video-frame-service) — frame cache、chunk smart-copy、视频 tracker job

### 安全

- [安全模型](/ops/security/) — JWT 认证、CSP 策略、权限边界
