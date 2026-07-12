---
pageClass: docs-hub-page
audience: [ops]
type: explanation
status: stable
last_reviewed: 2026-07-12
---

# 部署与运维

面向将本平台部署到生产环境的工程师和 SRE。

## 主入口

<div class="doc-card-grid cols-3">
  <DocLinkCard icon="🚀" title="部署" desc="开发 / 生产分流、Docker Compose、网络安全" href="/ops/deploy/" />
  <DocLinkCard icon="⬆️" title="升级" desc="镜像 rebuild / restart、数据库迁移、版本检查" href="/ops/upgrade-guide" />
  <DocLinkCard icon="📈" title="可观测性" desc="Prometheus / Grafana、Celery 监控、性能 HUD" href="/ops/observability/" />
  <DocLinkCard icon="🔒" title="安全" desc="JWT 认证、CSP 策略、权限边界" href="/ops/security/" />
  <DocLinkCard icon="🧯" title="Runbooks" desc="Worker 卡死、ML Backend 不可用等应急手册" href="/ops/runbooks/celery-worker-stuck" />
</div>

## 部署

- [部署总览](/ops/deploy/) — 开发 / 生产分流入口，两态差异速览
- [开发部署（本地）](/ops/deploy/development) — 基础设施进容器、API/Web 跑宿主机热更新
- [生产部署](/ops/deploy/docker-compose) — Docker Compose 生产部署、环境变量、反向代理
- [端口暴露与网络安全](/ops/deploy/network-security) — 端口该不该对外、Docker 绕 ufw、远程 SDK 安全访问
- [升级指南](/ops/upgrade-guide) — 镜像 rebuild / restart、数据库迁移与版本升级检查

## 可观测性

- [监控与告警](/ops/observability/) — Prometheus / Grafana 集成、Celery 任务监控、性能 HUD

## 安全

- [安全模型](/ops/security/) — JWT 认证、CSP 策略、权限边界

## Runbooks（应急手册）

- [Celery Worker 卡死](/ops/runbooks/celery-worker-stuck) — worker 卡住、队列堆积、任务无法消费
- [ML Backend 不可用](/ops/runbooks/ml-backend-down) — 模型服务不可达、健康检查失败或 GPU 加载异常
- [视频帧服务排障](/ops/runbooks/video-frame-service) — frame cache、chunk smart-copy、视频 tracker job
- [PG 连接池耗尽](/ops/runbooks/postgres-connection-pool-exhausted) — 连接池打满、请求排队或超时
