# 0013 — mask→polygon 转换在 ML backend 端做（不在前端 / 平台 api 端）

- **Status:** Accepted (v0.9.4 phase 3 落地, v0.9.14 多连通域升级)
- **Date:** 2026-05-08; updated 2026-05-09 (v0.9.14)
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
  - ~~多连通域 / 空洞编码~~ **v0.9.14 已落**（见下章节）。
  - morphological closing（mask 边界像素噪声预处理）：当前 v0.9.14 默认 off, 触发条件 = 客户反馈「polygon 边界锯齿严重」或长尾 IoU<0.95 占比仍 > 5%。
  - 前端 Konva sceneFunc + evenodd 镂空可视化：v0.9.14 后端协议 + transforms 类型已就位, ImageStage 渲染层降级取主外环（旧路径不破）；v0.10.x sam3-backend 接入时一并升级 sceneFunc 路径（避免二次破窗）。

---

## v0.9.14 update — mask 多连通域 / 空洞升级

**触发**：v0.9.4 phase 3 长尾分析（< 15% 样本 IoU 落 [0.5, 0.95)）已稳定指向两个根因 — `RETR_EXTERNAL` 丢内部空洞 + max area 取主连通域丢碎块。原本要等「客户抱怨」/「长尾 > 20%」触发, v0.9.14 把它提到收尾版主菜（与 v0.10.x sam3 接入解耦, 提前把协议 + 算法升级落地, 避免双任务并行破窗）。

**算法**：新增 `mask_to_multi_polygon` 函数（保留 `mask_to_polygon` 不动, 单连通无 hole 路径仍走旧函数, 字面零差异）。

- `cv2.findContours(binary, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE)` 抓两层环树（顶层 = 各连通域外环；二层 = hole）。`hierarchy[i][3] == -1` 区分外环 vs hole, 内层 hole 通过 parent 索引归属对应外环。
- 每个外环 + 每个 hole 各自走 `shapely.simplify(tolerance, preserve_topology=True)`, 共用同一 tolerance（用户单次 override 仍走 `Context.simplify_tolerance`）。
- `min_area=4.0` 像素阈值过滤 1-2 像素噪点 hole（防 mask 边界像素抖动产生伪 hole）。
- 形态学 closing 默认 off：`cv2.morphologyEx(..., MORPH_CLOSE)` 会吞掉小真实 hole（甜甜圈中心半径 < 5 像素时被填实）, 与「准确还原 mask」目标冲突。预留 `Context.morph_close=true` body 覆盖, 客户抱怨锯齿时再开。

**协议**：`PolygonGeometry` 加可选 `holes: list[list[list[float]]]` 字段（默认 `[]`, 老存量 / 老前端 / 老 fixture 反序列化默认 `[]` 不破）。新增 `MultiPolygonGeometry { type: "multi_polygon", polygons: list[PolygonGeometry] }` discriminator 分支。Predictor 智能选择三种 LS shape 字面：

| 输入 mask | 输出 LS value | 老前端兼容 |
|---|---|---|
| 单连通域无 hole | `{points, polygonlabels}` | 字面与 v0.9.13 之前 100% 一致 |
| 单连通域带 hole | `{points, holes, polygonlabels}` | 老前端忽略未知 `holes` 字段, 仍渲染外环 |
| 多连通域 | `{polygons:[{points, holes?}], polygonlabels}` | 老前端无 `points` 顶层字段时 fallback 到空, 需新前端识别 `polygons` |

`apps/api/app/services/prediction.py:to_internal_shape` 同步加 `polygons` / `holes` 路径解析；老 fixture / 老 DB JSONB 字面不变。`apps/api/tests/test_prediction_schema_adapter.py` 加 8 个 v0.9.14 用例（含 `Pydantic.PolygonGeometry.holes` 默认 [] 锁定）。

**评测脚本升级**：`scripts/eval_simplify.py` 同时跑 `mask_to_polygon` + `mask_to_multi_polygon`, 输出表加 `iou_multi@{tol}` / `verts_multi@{tol}` / `rings@{tol}` / `iou_diff@{tol}` 列, 汇总段加「`multi_only_helps %`」（升级使 IoU 提升 ≥ 0.02 的样本占比）。本地 90 张合成 fixture 跑 tol=1.0：单 polygon IoU≥0.95 占比 92.2% → multi 100%, multi_only_helps 8.9%（这 8.9% 即多连通 / 带空洞的长尾根因）。GPU 真实 SAM 50 张验收待补（ROADMAP P3 "真实 SAM mask 50 张 simplify tolerance 验收"）。

**前端落点**（v0.9.14 阶段 1 = 协议 + 类型 + 黄金样本; 阶段 2 = ImageStage Konva 镂空渲染留 v0.10.x）：

- `apps/web/src/types/index.ts` 加 `MultiPolygonGeometry` + `PolygonGeometry.holes`, `AIBox` 加可选 `holes` / `multiPolygon` 字段透传。
- `apps/web/src/pages/Workbench/state/transforms.ts` `geometryToShape` 处理 `multi_polygon` 分支：取顶点数最多的主外环作为 `polygon` 字段（编辑路径兼容）, 完整 polygons 数组挂在 `multiPolygon` 透传给 v0.10.x 镂空渲染。
- ImageStage Konva `<Line>` 渲染暂不变（仅外环 polygon, holes 字段忽略）。客户场景里 8.9% 多连通 / 带空洞样本目前显示主外环 + 无镂空, 与 v0.9.13 之前可视一致, 不破回归。
- 用户 accept multi_polygon prediction 转 annotation 时取主外环（编辑路径单环假设）, 丢 hole / 其余 ring。

**triggers for v0.10.x 升级 sceneFunc evenodd 镂空渲染**（任一）：
- 客户反馈「donut 类型对象（甜甜圈 / 玻璃环 / 框形物体）渲染少了内圈」
- v0.10.x sam3-backend 接入时, sam3 多连通域占比 > 30%（与 grounded-sam2 8.9% 数据点对比量化）
- ProjectSettingsPage IA 重构同窗口, 顺带升级 PolygonTool 编辑器支持画 hole（沉余成本）

**v0.9.14 实施代码位置**：

- `apps/_shared/mask_utils/src/mask_utils/polygon.py` (`mask_to_multi_polygon` + `_simplify_contour` + `_polygon_signed_area`)
- `apps/_shared/mask_utils/tests/test_multi_polygon.py` (10 测试 — donut / 两圆 / 噪声 hole / 排序)
- `apps/api/app/schemas/_jsonb_types.py` (`PolygonGeometry.holes` + `MultiPolygonGeometry`)
- `apps/api/app/services/prediction.py:to_internal_shape` (LS 三 shape 解析)
- `apps/grounded-sam2-backend/predictor.py` (`_rings_to_polygon_label` + `_maybe_warn_vertex_count`)
- `apps/grounded-sam2-backend/tests/test_multi_polygon_output.py` (6 测试 — 三种 shape 字面 + score 透传)
- `apps/web/src/types/index.ts` + `apps/web/src/pages/Workbench/state/transforms.ts` (类型 + geometryToShape 多连通分支)
- `scripts/eval_simplify.py` (双跑 + 升级评测列)
