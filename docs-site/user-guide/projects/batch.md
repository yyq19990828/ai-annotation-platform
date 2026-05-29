---
audience: [project_admin]
type: how-to
since: v0.1.0
status: stable
last_reviewed: 2026-05-27
---

# 批次与分配

批次（Batch）是项目内一组任务的业务分组，也是分配、推进、审核和归档的基本单位。

常见用途：

- 按数据来源分批：不同供应商、采集批次、数据域
- 按运营节奏分批：周批、月批、活动批
- 按难度或人员分批：新手批、高优先级批、复审批

## 创建批次与分包

关联数据集后，尚未划分到批次的任务称为**未归类任务**，会在批次页顶部以横带提示。把未归类任务分到批次有两种入口，都走同一个「创建批次」对话框：

- 批次页右上角 **创建批次**
- 未归类任务横带上的 **去分包**

对话框参数：

- **批次数量**：把未归类任务切分到几个批次（1–100）。
  - 填 **1** 时，等于「把全部未归类任务注入一个新批次」，此时第二个输入是该批次的**完整名称**。
  - 填 **≥2** 时，按数量平均切分，第二个输入是各批次的**名称前缀**（生成 `前缀 1`、`前缀 2` …）。
- **顺序 / 打乱**：
  - **顺序切分**：按任务导入顺序分配，不打乱（结果稳定、可预期）。
  - **打乱切分**：随机打乱后再切分。
- **优先级**：新批次的优先级（0–100）。

切分只作用于**未归类任务**，不会动已经归属其它批次的任务。新建批次落在 `draft`，需再激活才进入工作流。

> 注意：批次创建后目前没有「往已有批次追加任务」的入口；要把未归类任务放进批次，请通过上面的切分流程（可一次只切 1 个批次）。

## 批次状态机

批次状态机如下：

```mermaid
stateDiagram-v2
    [*] --> draft
    draft --> active: owner 激活
    active --> pre_annotated: AI 预标完成
    active --> annotating: 有 task 进入 in_progress
    pre_annotated --> annotating: 标注员开始接管
    pre_annotated --> active: owner 丢弃预标结果
    annotating --> reviewing: 全部任务完成/提交送审
    reviewing --> approved: reviewer 通过
    reviewing --> rejected: reviewer 退回
    approved --> reviewing: owner 重开审核
    approved --> archived: owner 归档
    rejected --> active: owner 重新激活
    rejected --> reviewing: owner 跳过重标直接复审
    rejected --> archived: owner 归档
    archived --> active: owner 撤销归档
    active --> archived: owner 归档
    pre_annotated --> archived: owner 归档
    annotating --> archived: owner 归档
```

说明：

- `active → annotating`、`pre_annotated → annotating` 有自动路径，不需要管理员手工点状态
- `annotating → reviewing` 既可能由“全量完成”自动触发，也可能由标注员主动整批送审触发
- owner 可以对批次执行 admin lock / unlock。admin lock 是软暂停：阻止新派单并冻结自动状态推进，但不会把已有任务变成只读。

## 状态语义

| 状态 | 含义 | 典型进入方式 | 下一步 |
|---|---|---|---|
| `draft` | 批次已建好，但还未正式投入生产 | 新建批次、`reset → draft` | owner 激活 |
| `active` | 已准备好，可开始分派或开始标注，但尚未进入“进行中” | `draft → active`、`archived → active`、`rejected → active`、`pre_annotated → active` | 标注员开始后自动转 `annotating`，或 owner 归档，或 AI 预标完成后转 `pre_annotated` |
| `pre_annotated` | AI 预标已跑完，等待人工接管 | AI 文本批量预标完成 | 标注员接管后自动转 `annotating`，owner 也可丢弃预标结果退回 `active` |
| `annotating` | 批次处于标注进行中 | 任一 task 进入 `in_progress` | 全部任务完成后进 `reviewing`，或 owner 归档 |
| `reviewing` | 审核员开始整批复核 | 标注员送审或系统自动推进 | reviewer 通过到 `approved`，退回到 `rejected` |
| `approved` | 审核完成，业务上通过 | reviewer approve | owner 可归档，也可重开审核 |
| `rejected` | 审核退回，批次需要返工 | reviewer reject | 标注员重做，或 owner 直接重新激活 / 重开审核 / 归档 |
| `archived` | 批次结束，不再作为工作中的生产批次使用 | owner archive | owner 可撤销归档回 `active` |

## 自动迁移与手工迁移

### 自动迁移

以下状态变化由系统自动驱动：

- `active → annotating`
  触发条件：批次内有任务进入 `in_progress`
- `pre_annotated → annotating`
  触发条件：标注员开始接管 AI 预标任务
- `annotating → reviewing`
  触发条件：批次内不再存在 `pending / in_progress / rejected` 任务

### 手工迁移

以下状态变化依赖用户操作：

- owner：`draft → active`
- 标注员：`annotating → reviewing`
- reviewer：`reviewing → approved`、`reviewing → rejected`
- owner 兜底逆向迁移：
  `archived → active`、`approved → reviewing`、`rejected → reviewing`、`rejected → active`、`pre_annotated → active`
- owner：多数工作态都可以直接归档

## 角色分工

| 角色 | 主要动作 |
|---|---|
| 项目 owner / super_admin | 创建批次、分配人、激活、归档、逆向迁移、终极重置 |
| 标注员 | 在自己负责的批次上开始标注，把批次送审 |
| 审核员 | 审核 `reviewing` 批次，决定通过或退回 |

补充：

- owner 是批次状态机的最终兜底角色
- 标注员不能直接把批次改成 `approved` / `archived`
- reviewer 不负责激活、归档或终极重置

## 分配人员

当前批次采用“一批次一标注员 + 一审核员”的单值语义：

- `annotator_id`：该批次的主标注员
- `reviewer_id`：该批次的主审核员

批次创建后通常先做两件事：

1. 指定标注员 / 审核员
2. 从 `draft` 激活到 `active`

如果只创建批次、不激活，它不会进入正常工作流。

## 批量操作

已实现的多选批量操作是：

- 激活
- 归档
- 重新分配
- 删除

说明：

- 批量激活只适用于 `draft` 批次
- 批量归档、删除、改派都受当前状态和权限约束，部分批次可能成功，部分批次会被跳过或失败

## 删除批次

删除批次会先把批次内**所有非 `pending` 的 task 重置回 `pending`**，再解绑（task 变为「未归类」，可重新分包）：

- **人工标注保留**：`source=manual` 的标注不丢，task 回到待标注入口可继续。
- **AI 预标清除**：该批次 task 上的 AI 预测结果与已采纳的 AI 标注（`source=prediction_based`）会被清掉，`total_predictions` 归零。这样重新分包并再次预标时不会与旧预测叠加出重复标注。
- **审核结论丢失**：`review` / `completed`（已通过）/ `rejected` 的 task 一并回到 `pending`——删除批次意味着这批工作要重新走流程，但已标注的几何不丢。

> 因此删除一个「进行中 / 审核中 / 预标过」的批次不会留下看不见的孤儿任务，也不会污染后续新批次的计数。`B-DEFAULT` 默认批次不可删除。

## Admin lock / unlock

<!-- history: ADR-0008 implemented the current soft-hold semantics. -->

owner 可以在批次行上点击锁定，为批次写入锁定原因。锁定后：

- scheduler 不会再从该批次派出新任务；
- 自动状态推进会跳过该批次；
- 批次卡片显示锁定状态与原因；
- 已经可见的任务与已有 task lock 不会被强制撤销；
- 解锁后恢复正常派题与自动推进。

这不是严格只读冻结。需要彻底重来时，用「重置到草稿」；需要结束生产时，用「归档」。

## 批次导出

项目管理员可以按批次导出当前批次内的任务标注。图片项目沿用 COCO / YOLO / AAP JSON；视频轨迹项目可导出 Video JSON / YOLO 逐帧 / AAP JSON / MOT / KITTI。

视频轨迹批次支持两种帧模式：

- **关键帧**：默认模式，只导出人工 / 预测关键帧。
- **所有帧**：按关键帧插值展开逐帧 bbox。

如果要把视频标注导成传统检测训练集，选择 **YOLO 逐帧**：系统会按项目采样网格生成 label，并附 `fetch_frames.py` 用本地 ffmpeg 抽出对应帧图。

如果关闭“包含属性”，导出文件不会包含项目属性 schema，也不会包含标注属性。

## 退回与重做

`reviewing → rejected` 不是简单改一个批次状态，它还会同步影响任务：

- 仅 `review` / `completed` 任务会被回退为 `pending`
- 现有 annotation 历史会保留，不会被硬删除
- `review_feedback` 会保留在批次上，供标注员查看退回原因

这意味着“批次被退回”更接近“软重开”，而不是“整批清空重做”。

## 终极重置到 Draft

owner 可以把任意状态批次 `reset → draft`。这是一个比普通逆向迁移更重的兜底动作。

它会做这些事：

- 批次状态回到 `draft`
- 批次下 task 状态统一回到 `pending`
- 删除 task locks，释放现场锁
- 清理批次 review 元数据
- 对 AI 预标相关数据做级联清理

适用场景：

- 批次切错了，想彻底重新来一遍
- AI 预标结果要整批作废
- 运营流程需要把批次回滚到“未启动”阶段

## 项目管理员日常操作建议

推荐节奏：

1. 先按业务维度切出批次
2. 再做标注员 / 审核员分派
3. 确认有任务后再激活
4. 标注完成进入审核
5. 通过后归档

不推荐的做法：

- 把所有任务都塞进一个超大批次再靠任务列表硬筛
- 在 `annotating` 中频繁手工做状态折返
- 把“归档”当成“临时暂停”使用

## 当前未实现能力

以下能力在 ADR / Roadmap 中有规划，但尚未上线：

- 批量锁定 / 批量解锁
- 锁定后严格禁止已持锁用户继续编辑
- 批次级共识 / IAA 与智能切批
