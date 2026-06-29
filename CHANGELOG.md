# Changelog

本文件记录 AI 标注平台的所有重要变更。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

历史版本详情见 [`docs/changelogs/`](docs/changelogs/)：

| 版本组 | 文件 |
|--------|------|
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
「## [Unreleased]」。0.20.x 版本段累积在本区；进入 0.21.x 后整体移到 docs/changelogs/0.20.x.md。
-->

### Fixed

- 能力目录端点（`GET /ml-capabilities/instances`）健壮性：某个 backend 自报格式不合规（如 variant 选项缺必填 `value`、`models` 非数组）时，现仅跳过该 backend 并记 warning，而非让一条坏数据的校验异常拖垮整个端点 —— 此前整列构造会因单个 backend 的 `ValidationError` 返回 500，导致所有 backend 的卡片一起从「模型市场 → 能力目录」消失。

## [0.20.0] - 2026-06-29

### Added

- **rapidocr-backend**（平台首个真实 OCR backend，第五个 ML backend）：基于 RapidOCR（ONNX）v3.9.0，把 `det → cls → rec` 三段拆为「原子能力 + 端到端编排」，对外自报三个 model —— `ocr-det`（detection 原子，full_image → polygon 文本框）、`ocr-rec`（ocr 原子，crop → 文本 + 方向 + 语言，内部跑 cls 方向校正）、`ocr-e2e`（ocr composite，full_image → polygon + 文本 + 方向 + 语言）。cls（文本行方向 0/180）语言/版本无关、内化进 rec 与 e2e 不单独暴露。支持 PP-OCRv5/v6 × 尺寸档 × 通用(中英)/英文 变体（`context.model_variants` 选档）。激活了协议早已留好的 `ocr` 任务族，并成为 `attributes.text`/`orientation`/`language` 落点校验的首个真实 producer。端口 8005，base 与 onnxtools 共享 nvidia/cuda runtime，GPU 可选。

### Changed

- onnxtools-backend 镜像基座从 `pytorch/pytorch:2.7.1-cuda12.8-cudnn9-devel` 换成 `nvidia/cuda:12.8.1-cudnn-runtime-ubuntu22.04`，删除从未被使用的 torch/torchvision/torchaudio（onnxtools 链路只需 onnxruntime-gpu + opencv），镜像体积从 18.3GB 降到 6.11GB（约 -12GB）。系统 cuDNN/CUDA 走标准路径，onnxruntime 的 CUDAExecutionProvider 无需再靠 ENTRYPOINT 的 `LD_LIBRARY_PATH` 拼接 torch 自带 nvidia 库即可启用。
