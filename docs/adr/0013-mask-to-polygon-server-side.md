# 0013 — mask→polygon 转换在 ML backend 端做（不在前端 / 平台 api 端）

- **Status:** Accepted
- **Date:** 2026-05-08
- **Deciders:** core team
- **Supersedes:** —

## Context

SAM / SAM-2 的输出是像素级 binary mask（H×W bool 数组）。前端 `<ImageStage>` 用 Konva 绘制 polygon 而非 raster mask（避免一帧渲染上百个 mask 性能崩溃）。需要决定 mask → polygon 的转换在哪一层做。

候选方案对比：

| 选项 | 主要卖点 | 主要劣势 |
|---|---|---|
| **方案 A**（已选）ML backend 端 cv2.findContours + shapely.simplify | 图像数据不离 GPU 节点；带宽小（polygon JSON ~5KB vs mask PNG ~50KB） | 后端依赖 cv2 / shapely |
| 方案 B 平台 api 端转 | 后端代码薄；前端零变化 | 需把 mask base64 跨网传两次（backend→api→web） |
| 方案 C 前端 cv2.wasm 转 | 服务端零依赖 | mask PNG / Float32Array 跨网传到浏览器，~50KB×N 严重压垮带宽；wasm 加载 1MB |

关键约束：

1. **网络带宽**：单图 1024×1024 mask（uint8 二值）压成 PNG 约 30-80KB，polygon JSON 5-10KB；批量预标 100 张时差 5-7MB。
2. **依赖位置**：`cv2 + shapely` 已在 `apps/grounded-sam2-backend/` 容器内（GroundingDINO 自带依赖），加在那里零额外安装；放前端要求 cv2.wasm；放 platform api 要求 cv2-headless + shapely。
3. **代码复用**：v0.10.x SAM 3 backend 也要做 mask→polygon，应抽到共享包。
4. **simplify tolerance 调参**：Douglas-Peucker tolerance 影响顶点数，需要可观测 + 可调，最好放 backend 内统一控制。

## Decision

**mask→polygon 转换在 ML backend 端进行**，使用 `cv2.findContours + shapely.simplify(tolerance, preserve_topology=True)`。共享代码放 `apps/_shared/mask_utils/`，由各 SAM 系列 backend 通过 `pip install -e ../_shared/mask_utils` 引入。

具体落地约束：

- 算法：`cv2.findContours(RETR_EXTERNAL, CHAIN_APPROX_SIMPLE)` 取最大连通域 + `shapely.geometry.Polygon.simplify(tol, preserve_topology=True)`（v0.9.4 phase 3 落地，`apps/_shared/mask_utils/src/mask_utils/polygon.py:15`）。
- 默认 `DEFAULT_SIMPLIFY_TOLERANCE = 1.0` 像素（v0.9.4 phase 3 评测：90 张 mask × IoU 0.98 / 顶点中位 102；`docs/research/13-simplify-tolerance-eval.md`）。
- `Context.simplify_tolerance` body 字段允许单次请求级覆盖（运维 / dev 调参），无 query string 入口（避免 URL 长度问题）。
- 顶点数 > 200 时打 `logger.warning("polygon vertex count %d > 200")` 作为运维信号。
- 协议返回：`AnnotationResult.value.points: list[list[float]]`（v0.9.4 phase 2 起兼容 polygonlabels + rectanglelabels 混存）。

## Consequences

正向：

- 平台 api / 前端零依赖 cv2 / shapely，体积控制（前端 bundle 不需要 cv2.wasm）。
- 单图带宽减少 ~80%（polygon JSON vs mask PNG）。
- v0.10.x SAM 3 backend 直接 reuse `apps/_shared/mask_utils/`，避免双份实现。
- 调参集中在 backend，前端切 simplify tolerance 测试时无需改前端代码（POST `context.simplify_tolerance`）。

负向：

- 当前 `RETR_EXTERNAL + max area` 策略丢内部空洞 + 多片段 mask（v0.9.4 phase 3 长尾分析：< 15% 样本 IoU 落 [0.5, 0.95)）。**触发条件**：客户首次抱怨 polygon 与 mask 形状差异 / 长尾 IoU<0.95 占比 > 20% 时升级为 multi-polygon + RETR_CCOMP（ROADMAP.md §A AI/模型 已记录）。
- shapely 不能完美保拓扑（极端凹凸可能产生自相交），preserve_topology=True 是最佳近似。
- backend 单测覆盖 mask 边界 case（`apps/grounded-sam2-backend/tests/test_simplify_tolerance_injection.py`）。

## Notes

- 实现代码位置：
  - `apps/_shared/mask_utils/src/mask_utils/polygon.py`（共享算法）
  - `apps/_shared/mask_utils/src/mask_utils/normalize.py`（坐标归一化 + round(6)）
  - `apps/grounded-sam2-backend/predictor.py`（调用 mask_utils）
  - `apps/grounded-sam2-backend/Dockerfile`（`COPY _shared/mask_utils + pip install -e`）
- 评测报告：`docs/research/13-simplify-tolerance-eval.md`
- 相关 ADR：ADR-0012（SAM backend 独立 GPU 服务）
- 触发条件 / 后续 TODO：
  - 多连通域 / 空洞编码（multi_polygon + RETR_CCOMP + morphological closing）：当客户抱怨形状差异或长尾 IoU<0.95 占比 > 20% 时升级，预估和 v0.10.x sam3-backend 同窗口做。
