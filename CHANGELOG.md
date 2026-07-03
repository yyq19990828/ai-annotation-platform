# Changelog

本文件记录 AI 标注平台的所有重要变更。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

历史版本详情见 [`docs/changelogs/`](docs/changelogs/)：

| 版本组 | 文件 |
|--------|------|
| 0.20.x | [docs/changelogs/0.20.x.md](docs/changelogs/0.20.x.md) |
| 0.19.x | [docs/changelogs/0.19.x.md](docs/changelogs/0.19.x.md) |
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
「## [Unreleased]」。0.21.x 版本段累积在本区；进入 0.22.x 后整体移到 docs/changelogs/0.21.x.md。
-->

## [0.21.0] - 2026-07-02

### Added

- **项目预标注编排升级为可命名模板库**：新增 `project_pipelines` 表与 `/project-pipelines`、`/projects/{project_id}/pipelines/apply` 接口，支持 private / organization / public 作用域、copy-on-write 套用、项目默认编排切换和未启用 backend 提前拦截，原有项目内保存的 `preannotate_pipeline` 会回填为项目默认编排。
- **AI 预标面板接入命名编排库**：项目详情里可以把当前 DAG 保存为命名编排、从可见编排库套用为项目默认，并在套用失败时直接提示缺少启用的 backend；工作台「按项目编排运行当前题」优先读取项目默认命名编排，旧项目列只作为兼容兜底。
- **智能编排库新增全局 backend/model 池**：`/ai-pre/pipelines` 可直接从 `/ml-capabilities/instances` 的全局模型池选择源模型和下游模型，右侧复用 DAG 画布预览后保存为公共命名编排；项目预标注入口只负责把编排库里的模板套用为当前项目默认，探测失败的 backend 会保留展示但禁用选择。
- **全局编排页对齐项目编排能力**：`/ai-pre/pipelines` 现在支持多层 DAG（受限 `MAX_DEPTH=3`，可加子/改父/级联删）、右列常挂参数 Inspector 可以配 `roi.pad` / `write.keys` / `label`、模型变体（version/size/lang 轴），以及类别相关字段——源阶段类别白名单从 model 自报 `classes` 勾选、下游父框类别从上游 model 类名勾选、写回属性键从 model `output_attribute_schema` 勾选（均与项目侧同源、均支持自由文本兜底），而 `roi.mode` / `input.mode` / `write.target` 与项目侧一样由所选模型的任务内生派生、只读展示不可手选，保存前预警属性键冲突；可见范围支持公共 / 组织；页面下方新增「命名编排库」列表，展示 `scope in {public, organization}` 编排的 `usage_count`，支持「加载编辑」把 stages 回填画布或删除；项目页可见范围新增「组织」选项。推理阈值 `params` 因不在全局能力池下发，留待编排套用到项目后由项目侧配置。共用画布状态机通过 `usePipelineComposer(context)` 提取、通用 chip 多选提取为 `ChipMultiSelect`，两页保持行为一致。
- **能力协议新增统一输入类型词表**：`supported_inputs` 现在有后端、共享协议和前端生成物共用的受控词表，并新增 `video` 预留输入类型与 `default_input_type` 字段，后续全局编排选择器和视频检测追踪可以用同一套输入判据。

### Changed

- **多阶段预标注的源阶段成为执行字段来源**：触发预标注时不再让顶层兼容字段覆盖流水线源阶段，源阶段的 backend、模型、任务类型、参数、variant 和类别过滤会一并派生到执行 payload，避免项目主 backend 或旧调用参数成为第二真值。
- **全局能力实例响应补齐编排所需定位字段**：`/ml-capabilities/instances` 现在返回 `backend_id` 与 `state`，全局编排选择器可以用 registry id 落 `pipeline_stages.ml_backend_id`，并把 `state=error` 的 backend 展示为不可选择而不是静默消失。
