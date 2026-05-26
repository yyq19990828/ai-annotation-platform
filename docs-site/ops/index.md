# 部署与运维

面向将本平台部署到生产环境的工程师和 SRE。

## 快速入口

### 部署

- [部署指南](/ops/deploy/docker-compose) — Docker Compose 生产部署、环境变量、反向代理
- [升级指南](/ops/upgrade-guide) — 镜像 rebuild / restart、数据库迁移与版本升级检查

### 可观测性

- [监控与告警](/ops/observability/) — Prometheus / Grafana 集成、Celery 任务监控、性能 HUD
- [Celery Worker 卡死](/ops/runbooks/celery-worker-stuck) — worker 卡住、队列堆积、任务无法消费
- [视频帧服务排障](/ops/runbooks/video-frame-service) — frame cache、chunk smart-copy、视频 tracker job

### 安全

- [安全模型](/ops/security/) — JWT 认证、CSP 策略、权限边界
