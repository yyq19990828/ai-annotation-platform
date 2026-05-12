# 部署与运维

面向将本平台部署到生产环境的工程师和 SRE。

> **注意**：本板块目前处于 M1 轻量整理阶段，页面链接至 `dev/` 下的对应文档。M2 将完成物理迁移并新增 Runbook、K8s 指南等内容。

## 快速入口

### 部署

- [部署指南](/dev/deploy) — Docker Compose 生产部署、环境变量、反向代理

### 可观测性

- [监控与告警](/dev/monitoring) — Prometheus / Grafana 集成、Celery 任务监控、性能 HUD

### 安全

- [安全模型](/dev/security) — JWT 认证、CSP 策略、权限边界

## 即将上线（M2）

| 页面 | 说明 |
|---|---|
| `ops/deploy/k8s.md` | Kubernetes 部署指南 |
| `ops/observability/` | 日志 / 指标 / 链路追踪分章节 |
| `ops/security/` | 威胁模型 / CSP / 鉴权授权 |
| `ops/runbooks/celery-worker-stuck.md` | Celery Worker 卡死处理手册 |
| `ops/runbooks/ml-backend-down.md` | ML Backend 不可用处理手册 |
| `ops/runbooks/video-frame-service.md` | 视频帧服务 chunk / frame cache 排障手册 |
| `ops/runbooks/postgres-connection-pool-exhausted.md` | PG 连接池耗尽处理手册 |
| `ops/upgrade-guide.md` | 版本升级指南 |
