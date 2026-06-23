# Changelog

本文件记录 AI 标注平台的所有重要变更。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

历史版本详情见 [`docs/changelogs/`](docs/changelogs/)：

| 版本组 | 文件 |
|--------|------|
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

<!-- 0.18.x 版本变更按版本段追加到本区；进入 0.19.x 后整体移到 docs/changelogs/0.18.x.md -->

## [0.18.0] - 2026-06-23

二阶段预标注落地：新增**自维护的第四个 ML backend `onnxtools-backend`**——「检测 → 拿到框 → 对机动车做车型/颜色分类 → 写入框属性」一条流水线打通，并扩展协议让 backend 自报输出属性 schema、前端一键导入。Path B（平台层跨 backend 可视化编排）作为后续 Epic 单列 [`ROADMAP`](ROADMAP/2026-06-23-staged-preannotation-pipeline-roadmap.md)。本版方案见 [`docs/plans/2026-06-23-v0.18.0-onnxtools-vehicle-attribute-backend.md`](docs/plans/2026-06-23-v0.18.0-onnxtools-vehicle-attribute-backend.md)。

### Added

- **onnxtools 第四 backend（二阶段车辆属性）**：独立 FastAPI 微服务（端口 8004、compose profile `gpu-onnxtools`），与 gsam2 / sam3 / yolo 同构（HTTP 协议 v2.1）但单一固定 pipeline。基于 onnxtools 的 `VehicleAttributePipeline`：rtdetr 检测 → 对机动车框裁 ROI → va 模型出**车型（13 类）+ 颜色（11 类）**→ 写入框 `attributes`。`class_name` 为 rtdetr 粗检测类，`attributes.vehicle_type` / `attributes.color` 为细分类（value 与 onnxtools 枚举严格对齐）；车牌作独立检测类，本轮不做父子。
- **协议扩展 · backend 自报输出属性 schema**：`/setup` 的 model 目录新增 `output_attribute_schema`（含每个 select 字段的 `options`，value+中文 label）与 `output_attribute_types`，沿 `ml_capabilities`（protocol → capability_instances）透传到前端。
- **「从 ML Backend 导入属性」**：项目设置「类别与属性」区新增按钮，列出所有自报输出属性的在线 backend / model，预览并勾选字段后一键合并进当前工具单位的 `attribute_schema`（同 key 覆盖、新 key 追加），免去手抄选项 + key 对齐。
- **采纳前候选属性预览**：工作台选中尚未落库的 AI 候选时，标注详情底部以只读 `AttributeForm` 预览其 `attributes`（经项目 schema 的 options 解析为中文）；候选列表行补属性摘要 chip。

### Notes

- onnxtools 经 `git+https://github.com/yyq19990828/onnxtools.git@main` 安装（`VehicleAttributePipeline` 已合入 main）；两个 onnx 模型经 volume 挂载注入、不打进镜像。镜像复用本机已缓存的 `pytorch/pytorch:2.7.1-cuda12.8-cudnn9-devel`（cuda12.8 + cudnn9 满足 onnxruntime-gpu 1.22）。
- entrypoint 把 torch 自带的 `nvidia/*/lib` 加进 `LD_LIBRARY_PATH`，否则 onnxruntime CUDAExecutionProvider 找不到 cudnn 静默退回 CPU；实测 GPU ~35ms/图 vs CPU ~940ms。缺 GPU 时自动 fallback CPU，功能不受影响。
- `accept_prediction` 复制候选 attributes 时对项目 select 字段做软校验：值不在 options 内只告警、不阻断（保留原值），避免 backend 枚举与项目配置漂移时丢数据。
