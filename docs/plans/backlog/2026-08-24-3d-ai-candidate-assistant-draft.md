# 3D AI 候选助手计划草案

> Status: trigger-gated research-draft
>
> Implementation authorization: no
>
> Version: unassigned；本草案不占版本号
>
> Finalization: 实施前必须执行 [`backlog/README.md`](README.md) 的“转定稿门”

## 1. 推荐结论

推荐先把现有点选择、聚类、地面过滤、PCA yaw 和 autofit 包装成一个**本地算法候选助手**，验证“提示 → 候选 → 预览调整 → 接受 / 拒绝”的产品合同；只有该循环有效且存在真实 LiDAR / RGB-D backend 后，再扩展 ML backend capability。

协议按输入模态、提示类型和输出 geometry 描述能力，不写死 SAM3D、某个供应商或某个模型名。候选在接受前不是 Annotation，不进入正式导出。

## 2. 当前基线快照

- 3D 工作台已有屏幕框选点、相机视锥选点、`psrFromPoints`、`fitYaw`、`fitBottom` 和地面估计，能够生成算法型 cuboid 初值。
- 平台已有 Prediction、交互式 AI、候选接受 / 驳回、lineage、动态 capability 和 backend routing 基础；LiDAR 目前不在公开预标注支持范围。
- 现有 3D 创建路径多数直接 POST Annotation，缺少独立 preview candidate 与拒绝原因。
- ADR-0053 等已确立 mask AI 候选生命周期，3D 应复用生命周期原则，不复制 geometry 细节。

## 3. 候选状态机

```text
IDLE ─► ARMED(prompt mode) ─► COMPUTING
                                  │
                         ┌────────┴────────┐
                         ▼                 ▼
                    PREVIEW            ERROR
                 ┌───────┼───────┐       │ retry / exit
                 ▼       ▼       ▼       └────► ARMED / IDLE
               ADJUST  REJECT  ACCEPTING
                                  │ version check
                                  ▼
                             Annotation + lineage
```

候选至少携带 algorithm / model identity、版本、输入摘要、prompt、点数、置信或质量指标、geometry、坐标约定、生成耗时和 source frame revision。前端调整只改 candidate draft；接受时一次写入正式 annotation 和 history。

## 4. 第一阶段：本地算法助手

- 提示支持屏幕点、矩形 / polygon ROI 或相机矩形中的一个最小集合；转定稿按现有手势冲突选择，不一次全开。
- 从已加载点中做深度门控 / 连通或稳健聚类，排除高置信地面，再用现有 autofit 生成 1–3 个候选。
- preview 显示候选点集、cuboid、点数和拟合质量；用户可切候选和用现有 PSR 工具调整。
- reject 记录受控原因，如错目标、漏点、尺寸错误、方向错误、无有效候选；自由文本可选。
- 同一 source revision + prompt + algorithm config 可形成幂等缓存，但不能跨 annotation 修改复用陈旧候选。

## 5. 第二阶段：远程模型扩展条件

只有同时满足以下条件才扩协议：

- 有可调用且可运维的 LiDAR 或 RGB-D backend，明确支持 `box_3d` 或 `point_mask_3d`。
- 至少 500 帧人工确认验证集，按场景 / 类别 / 距离分层，能比较本地算法、模型和纯人工。
- 远程模型在接受率或任务耗时上稳定优于本地候选，并能在超时 / 无 GPU 时安全回退。
- capability 能表达输入资产、坐标 convention、prompt、输出 geometry、batch / interactive、版本与限制。

远程 response 进入同一 candidate 状态机；不因模型来源不同绕过 preview、version check 或 lineage。

## 6. 范围

- 3D candidate 的前端状态、可视预览、调整、接受、拒绝和错误恢复。
- 本地算法 provider，复用现有几何 helper 与 Worker / 主线程预算。
- candidate lineage、受控 reject reason、基础接受率和耗时评估。
- 条件满足后的 ML capability / request / response 扩展、routing 和安全回退。
- box_3d 第一版；point_mask_3d 只有在输出与点 ID 合同稳定后另切片。

## 7. 非范围

- 不把本地 autofit 包装成“AI”后直接保存，不跳过候选预览。
- 不在平台协议硬编码模型名、供应商 URL、权重路径或 GPU 型号。
- 不一次建设训练、主动学习、自动部署与模型市场。
- 不自动接受高分候选，不批量覆盖人工 annotation。
- 不让远程 backend 接收超出项目授权的相机 / 点云资产；资源签发与审计必须沿用现有安全边界。

## 8. 推荐实现切片（转定稿后执行）

1. **候选壳与本地单候选**：固定一个 prompt，preview / adjust / accept / reject，验证不直接写真值。
2. **本地多候选与评估**：有限候选排序、质量解释、500 帧前的内部基线和失败分类。
3. **候选持久 / 恢复边界**：刷新、切帧、source version conflict、history 和 lineage。
4. **远程 capability**：触发门通过后独立扩协议与 provider，不改变候选 UI 合同。
5. **point mask 候选**：只在全局点 ID 与性能预算稳定后另行开放。

## 9. 验收方向

- compute / preview / reject 不产生 Annotation POST；accept 只产生一次写入和一次 history entry。
- 切帧、源 annotation 变化或 calibration / point generation 变化会使旧 candidate stale，不能误接受。
- 本地算法失败、Worker crash、远程超时、backend 无能力均可恢复到 armed 或手工工具。
- 固定验证集报告 candidate recall、top-1 / top-k 接受率、人工调整量、中位耗时和拒绝原因，不只报告模型置信度。
- 远程 provider 不可用时，用户可继续本地助手或普通手工创建，工作台不被锁死。

## 10. 风险与回滚

- “候选看起来不错”不等于效率提高；接受率、调整量和总任务时间共同决定是否开放。
- 点云 / 相机大资产传给远程服务有权限与成本风险，必须复用受控签发、allowlist 和审计。
- 回滚远程 provider 不影响本地候选；回滚整个助手时隐藏入口并清理临时候选，已接受 annotation 仍是普通真值且保留 lineage。

## 11. 转定稿专项检查

- 重新审计 Prediction、interactive AI、candidate receipt / lineage、ML capability v2、routing 和 3D 创建链路，优先复用已稳定合同。
- 先选择一个最小 prompt 和 box_3d 输出，写固定评估集；没有评估数据不扩多模型 / point mask。
- 核对 pointcloud tiling 是否已实施，确定本地算法获得的是完整 ROI、抽样点还是 tile，并在质量指标中明示。
- 定稿分别列本地阶段和远程阶段的精确文件、协议 fixture、权限测试、性能预算、文档与回滚，不把两阶段绑成一次发布。
