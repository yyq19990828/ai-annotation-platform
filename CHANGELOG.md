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

## [Unreleased]

<!--
日常变更（含普通 bug 修复）按 Keep a Changelog 类型分组追加到本段：
Added / Changed / Deprecated / Removed / Fixed / Security（按此顺序，空组省略）。
发版时把「## [Unreleased]」重命名为「## [x.y.z] - 日期」，再在其上方留一个空的
「## [Unreleased]」。0.19.x 版本段累积在本区；进入 0.20.x 后整体移到 docs/changelogs/0.19.x.md。
-->

### Added

- **rapidocr-backend**（平台首个真实 OCR backend，第五个 ML backend）：基于 RapidOCR（ONNX）v3.9.0，把 `det → cls → rec` 三段拆为「原子能力 + 端到端编排」，对外自报三个 model —— `ocr-det`（detection 原子，full_image → polygon 文本框）、`ocr-rec`（ocr 原子，crop → 文本 + 方向 + 语言，内部跑 cls 方向校正）、`ocr-e2e`（ocr composite，full_image → polygon + 文本 + 方向 + 语言）。cls（文本行方向 0/180）语言/版本无关、内化进 rec 与 e2e 不单独暴露。支持 PP-OCRv5/v6 × 尺寸档 × 通用(中英)/英文 变体（`context.model_variants` 选档）。激活了协议早已留好的 `ocr` 任务族，并成为 `attributes.text`/`orientation`/`language` 落点校验的首个真实 producer。端口 8005，base 与 onnxtools 共享 nvidia/cuda runtime，GPU 可选。

### Changed

- onnxtools-backend 镜像基座从 `pytorch/pytorch:2.7.1-cuda12.8-cudnn9-devel` 换成 `nvidia/cuda:12.8.1-cudnn-runtime-ubuntu22.04`，删除从未被使用的 torch/torchvision/torchaudio（onnxtools 链路只需 onnxruntime-gpu + opencv），镜像体积从 18.3GB 降到 6.11GB（约 -12GB）。系统 cuDNN/CUDA 走标准路径，onnxruntime 的 CUDAExecutionProvider 无需再靠 ENTRYPOINT 的 `LD_LIBRARY_PATH` 拼接 torch 自带 nvidia 库即可启用。

## [0.19.5] - 2026-06-29

### Added

- AI 预标注编排「能力校验」补齐配置期一层，与派发期 422 对称：源模型选择器、下游阶段卡在**配置期**就对 `batchable=false`（交互 / 有状态模型）与「写属性却不产 `class`」的误配标红预警；保存编排（`PATCH /projects/{id}`）的响应回带 `capability_warnings[]` 软提示。把「存得下不一定跑得了」前移到配置 / 保存时暴露，而非跑到派发才报错；保存只软提示不硬挡（保留「先存草稿、之后换 backend」的合法流，派发期 422 仍是最终闸）。
- 模型市场「能力目录」卡片新增**批量 / 设备徽标**：模型自报 `resource_profile.batchable` 时显示「可批量」/「交互·有状态」，`device` 显示「GPU/CPU」，让用户一眼看出某模型能否进批量预标、跑在什么设备上，无需进项目编排才发现。`/instances` 视图此前丢弃了 `resource_profile`（仅 `/capabilities` 富数据视图可见），现已透传到协议卡视图与平台内置（env-only）模型卡。缺省字段不显示，向后兼容。
- **设备感知预标队列路由**：按模型自报的 `resource_profile.device` 把批量预标任务路由到不同 Celery 队列——整条 pipeline 全部 `device=cpu` 进 `ml.cpu` 队列（CPU worker 高并发），任一阶段 `device=gpu` 或未自报则进 `ml` 队列（GPU worker 低并发护显存）。GPU 模型与 CPU 模型不再抢同一并发池：多个 GPU 预标并发不再争显存致 OOM，CPU 模型也不再被 GPU 任务拖慢。docker-compose 拆出 `celery-worker-gpu` / `celery-worker-cpu` 两组 worker（并发经 `CELERY_GPU_CONCURRENCY` / `CELERY_CPU_CONCURRENCY` 配置）。老 backend / 未自报 device / 混合 device 的 pipeline 一律保守落 GPU 队列，与拆分前行为等价、零退化。

### Changed

- 预标注能力判据（batchable / 分类阶段产 class）抽成 `app/services/pipeline_validation.py` 纯函数，保存路径、派发路径与前端 `stageWarning` 共用同一份 SSOT，并以跨端 fixture 双端断言（vitest + pytest）防判据漂移。

## [0.19.2] - 2026-06-29

### Added

- **AI 预标注派发期硬校验「跑完必然空结果」的误配**：编排流水线提交时，若所选模型自报 `batchable=false`（交互 / 有状态视频追踪模型）却被放进批量预标，或某分类阶段（`write.target=attributes`）所选模型自报的 `output_attribute_types` 不含 `class`（跑完属性恒空），后端直接返回 422 带可读原因，不再静默跑完一批拿到空结果。模型未自报对应字段（老 backend）时跳过，保持向后兼容。
- **画布能力校验覆盖更多属性类型**：原先只在模型输出 `text` 属性而项目缺文本字段时提示，现统一覆盖 `text` / `language` / `orientation` 三类——模型声明产出某属性但项目无承接位（语言字段 / 旋转框工具或方向字段）时，给非阻断警告「采纳后该属性将丢失」。`class` 类别刻意不校验（taxonomy 几乎恒在）。
- **编排卡片属性键对账提示**：分类下游阶段所选「写回属性键」若不在该模型自报的 `output_attribute_schema` 内，卡片给非阻断提示「该模型可能不产出此键」。

### Changed

- **`GET /ml-capabilities/instances` 补透传 `supported_inputs` + `resource_profile`**：原 `/instances` 裁掉了这两个字段，导致走该端点的消费方（模型市场实例视图 / 全局编排选择器）拿不到投递契约与批量画像；现与项目级 `/capabilities` 字段集对齐。

## [0.19.1] - 2026-06-29

### Changed

- **Python SDK 与全局 ML Backend 注册表对齐**（ADR-0044）：`MLBackend.project_id` 从必填放宽为可选（全局 / admin 场景 backend 无项目归属，项目作用域端点仍回填本项目 id）；`ml-backends list` 现只返回**本项目已启用**的全局 backend，`MLBackend.id` 为全局 registry id（同一物理 backend 跨项目返回同一 id），docstring / README 同步说明。脚本里硬编码的旧 per-project backend id 在 0.19.0 迁移后已失效，需改用 registry id。SDK 包版本 → 0.15.17。

### Fixed

- **仪表盘「近期审计活动」恒显示「暂无业务事件」**：原实现只取最新 8 条审计日志后在前端过滤掉 `http.*` 请求日志，而审计表被海量 `http.*` 淹没，业务事件早被挤出这 8 条窗口 → 永远过滤为空。改为向服务端传 `business_only=true`（`WHERE action NOT LIKE 'http.%'`）直接取 8 条业务事件。同步修复空状态卡片里活动图标因 `svg{display:block}` 而左对齐、与居中文案错位的问题。
- **Python SDK TUI 在多项目共享同一 backend 时崩溃**：`aap tui` 的 ML Backend 列表逐项目聚合，0.19.0 全局注册表下同一物理 backend 被多个项目启用会返回同一 registry id，旧逻辑用相同 key 重复 `add_row` 触发 Textual DataTable `DuplicateKey` 异常。改为按 id 去重合并为一行（项目列显示「N 个项目」）。

## [0.19.0] - 2026-06-29

ML Backend 从「项目子资源」上提为**全局注册表**（ADR-0044）：一个物理 backend 全局只注册一次、所有项目共享其能力快照与并发限速闸，项目侧只做「启用」。

### Added

- **超管全局注册表 CRUD**：`POST/PUT/DELETE /admin/ml-integrations/registry` + `POST /admin/ml-integrations/registry/{id}/health`，配套模型市场「注册管理」tab 的注册 / 编辑 / 删除 / 健康检查入口。
- **项目启用勾选清单 API**：`GET /projects/{id}/ml-backends/available`（列全部全局项 + 本项目启用态）、`PUT /projects/{id}/ml-backends/{rid}/enablement`（切换启用 + 写变体覆盖）。
- **项目设置「ML 模型」「管理 backend」悬浮面板**：集中勾选启用 / 停用全部全局 backend，主表只展示本项目已启用项。
- **「注册管理」tab 项目启用概览**：超管只读视图，列出每个项目已启用了哪些 backend，附「打开项目设置」入口。
- 全局注册表列表行展示 `≤N 并发` chip（来源 `max_concurrency`，缺省不显示）。

### Changed

- **backend 数据模型重构**：从「每项目 `ml_backends` 一行、能力快照逐项目复制」改为「全局注册表 `ml_backend_registry`（一物理 backend = 一行 = 一份能力快照 = 一个并发限速闸）+ 项目启用关联 `project_ml_backend`（启用开关 + 项目级变体覆盖）」。env 配置的 backend 启动即自动 upsert 为 `source=env` 注册项（取代旧 `_load_env_only_instances` 临时探测分支）；env 删项时对应行置 `disconnected` 而非删除，保留历史 prediction 溯源。预标归属、DAG 下游、`backends>=2` 门控统一改读「项目已启用」集合。项目作用域旧端点保持向后兼容（注册 = 按 URL 复用 / 新建全局项 + 启用，删除 = 停用）。
- **数据迁移 `0108`**：按 URL 去重回填全局表 + 生成启用关联，建全量 `old_id → registry_id` 映射统一重写外键三处（`projects.ml_backend_id`、分区表 `predictions.ml_backend_id` 两处）+ 用户偏好三子键（`params_by_backend` / `model_by_backend` / `interactive_backend_by_project`），历史 prediction backend 溯源零丢失。回滚为 forward-only 姿态（去重发生即有损）。
- **项目设置「ML 模型」UX 精简**：主表只展示本项目已启用的 backend；`ai_enabled` 改为**自动派生**（设了项目主后端即视为启用），不再需要手动开关。
- **模型市场「注册管理」tab 重设计**：从「按项目分组 + per-project 注册 / 编辑 / 删除」的旧卡片，改为「全局注册表（扁平 · 跨项目共享）+ 只读项目启用概览」两块，并加角色门控——超管做全局增删改查 + 健康检查，项目管理员看到的全局表为**只读**（隐藏 CRUD）。
- **AIPreAnnotate 多阶段编排门控改读已启用集合**：勾选启用第二个 backend 即可加分类阶段，无需重复注册。

### Removed

- **每项目 backend 注册上限 `max_ml_backends_per_project`**：与多阶段 DAG 需 ≥2 backend 直接冲突；显存保护改由全局行 `max_concurrency` 兜底。
- **「启用 AI 预标注」手动开关**：冗余，改由 `ai_enabled` 自动派生。
- **项目级「SAM 文本预标默认输出」选项 `text_output_default`**：已被交互工具栏 + 用户级偏好架空（工作台首次激活 exemplar 后即被用户偏好永久覆盖，批量预标不读此字段）。删 `projects` / `project_templates` 两表列（迁移 `0109`）；工作台文本输出初始值回落用户偏好 → `type_key` 智能默认。
- **per-backend 项目级阈值覆盖 `box_threshold` / `text_threshold`**：从未被推理路径消费（批量预标只读项目级单值 `project.box_threshold`），且属错误抽象——backend 可调参数本由协议 `/setup.params` 自描述、运行时通用渲染（工作台「当前题 AI」+ `/ai-pre` 跑批配置）。删前端「项目级覆盖」列 + `OverrideCell`、schema / service / API 读写、`project_ml_backend` 两列（迁移 `0110`）；保留 `enabled` / `default_variants`（后者留作未来变体覆盖落点）与项目级 `project.box_threshold` 兜底。
- **项目作用域注册前端链**（后端兼容端点仍保留）：`MlBackendFormModal` 组件 + `useCreateMLBackend` / `useUpdateMLBackend` / `useDeleteMLBackend` hook + `mlBackendsApi.create` / `update` / `delete` 封装。

### Fixed

- **并发限速首次真正 per-物理-backend 生效**：旧实现下同一物理 backend 在 N 个项目各持一个独立 semaphore，限速形同虚设；`auth_method` / `auth_token` / `extra_params`（含 `max_concurrency`）现作为端点固有属性随 URL 进全局行，单 backend 一个限速闸。
- **项目管理员进「模型市场 → 注册管理」tab 不再 403 坏页**：旧卡片调用超管专属 `/admin/ml-integrations/overview`，项目管理员触发 403 致整个 tab 加载失败；重设计后项目管理员走只读全局表，不再触达该端点。
