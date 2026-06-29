# Changelog

本文件记录 AI 标注平台的所有重要变更。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

历史版本详情见 [`docs/changelogs/`](docs/changelogs/)：

| 版本组 | 文件 |
|--------|------|
| 0.18.x | [docs/changelogs/0.18.x.md](docs/changelogs/0.18.x.md) |
| 0.17.x | [docs/changelogs/0.17.x.md](docs/changelogs/0.17.x.md) |
| 0.16.x | [docs/changelogs/0.16.x.md](docs/changelogs/0.16.x.md) |
| 0.15.x | [docs/changelogs/0.15.x.md](docs/changelogs/0.15.x.md) |
| 0.14.x | [docs/changelogs/0.14.x.md](docs/changelogs/0.14.x.md) |
| 0.13.x | [docs/changelogs/0.13.x.md](docs/changelogs/0.13.x.md) |
| 0.12.x | [docs/changelogs/0.12.x.md](docs/changelogs/0.12.x.md) |
| 0.11.x | [docs/changelogs/0.11.x.md](docs/changelogs/0.11.x.md) |
| 0.10.x | [docs/changelogs/0.10.x.md](docs/changelogs/0.10.x.md) |
| 0.9.x | [docs/changelogs/0.9.x.md](docs/changelogs/0.9.x.md) |
| 0.8.x | [docs/changelogs/0.8.x.md](docs/changelogs/0.8.x.md) |
| 0.7.x | [docs/changelogs/0.7.x.md](docs/changelogs/0.7.x.md) |
| 0.6.x | [docs/changelogs/0.6.x.md](docs/changelogs/0.6.x.md) |
| 0.5.x | [docs/changelogs/0.5.x.md](docs/changelogs/0.5.x.md) |
| 0.4.x | [docs/changelogs/0.4.x.md](docs/changelogs/0.4.x.md) |
| 0.3.x | [docs/changelogs/0.3.x.md](docs/changelogs/0.3.x.md) |
| 0.2.x | [docs/changelogs/0.2.x.md](docs/changelogs/0.2.x.md) |
| 0.1.x | [docs/changelogs/0.1.x.md](docs/changelogs/0.1.x.md) |


---

## 最新版本

<!-- 0.19.x 版本变更按版本段追加到本区；进入 0.20.x 后整体移到 docs/changelogs/0.19.x.md -->

## [0.19.0] - 2026-06-29

### Changed

- **ML backend 上提为全局注册表（ADR-0044）**：backend 实例从「项目子资源」（每项目 `ml_backends` 一行、能力快照逐项目复制）重构为「全局注册表 `ml_backend_registry`（一物理 backend = 一行 = 一份能力快照 = 一个并发限速闸）+ 项目启用关联 `project_ml_backend`（启用开关 + 项目级阈值/变体覆盖）」。env 配置的 backend 启动即自动 upsert 为 `source=env` 注册项，取代旧 `_load_env_only_instances` 临时探测分支；env 删项时对应行置 `disconnected` 而非删除，保留历史 prediction 溯源。`auth_method`/`auth_token`/`extra_params`（含 `max_concurrency` 限速闸）作为端点固有属性随 URL 进全局行——顺带修复旧实现下「同一物理 backend 在 N 个项目各持一个独立 semaphore、限速形同虚设」的隐性 bug，限速首次真正 per-物理-backend 生效。
  - **API**：新增 superadmin 全局注册表 CRUD（`POST/PUT/DELETE /admin/ml-integrations/registry` + `/{id}/health`）；新增项目启用勾选清单（`GET /projects/{id}/ml-backends/available` 列全部全局项 + 本项目启用态/覆盖，`PUT /projects/{id}/ml-backends/{rid}/enablement` 切换启用 + 写覆盖）。项目作用域旧端点保持向后兼容（注册=按 URL 复用/新建全局项 + 启用，删除=停用）。预标归属、DAG 下游、`backends>=2` 门控统一改读「项目已启用」集合。
  - **前端**：ModelMarket 增 superadmin 全局 backend 注册/编辑/删除入口；项目设置「ML 模型」从「注册 backend」改为「启用全局 backend + 项目级阈值/变体覆盖」勾选列表；AIPreAnnotate 多阶段编排门控改读已启用集合（勾选启用第二个 backend 即可加分类阶段，无需重复注册）。
  - **迁移**：alembic `0108` 按 URL 去重回填全局表 + 生成启用关联，建全量 `old_id → registry_id` 映射统一重写外键三处（`projects.ml_backend_id`、分区表 `predictions.ml_backend_id` 两处）+ 用户偏好三子键（`params_by_backend`/`model_by_backend`/`interactive_backend_by_project`），历史 prediction backend 溯源零丢失。回滚为 forward-only 姿态（去重发生即有损）。
  - 移除每项目 backend 注册上限 `max_ml_backends_per_project`（与多阶段 DAG 需 ≥2 backend 直接冲突）；显存保护改由全局行 `max_concurrency` 兜底。
