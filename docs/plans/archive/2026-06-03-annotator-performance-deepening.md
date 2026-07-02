# 绩效页深化 · 多版本路线(Annotator Performance Deepening)

> 调研输入:[`docs/research/15-annotator-performance.md`](../research/15-annotator-performance.md)(CVAT/LS 源码 + 6 商业产品对标)。
>
> 本档是**多版本切片计划**,不是单版本实施稿。每个切片落地前再单独写版本实施 plan。
>
> 现状基线:`/admin/people`(v0.8.4,super_admin 成员绩效)+ `/me/performance`(v0.12.3,自助页)。

## 0. 定位:两条轨道

调研结论:吞吐/工时/运营告警我们已达行业线;结构性盲区是**质量度量两支柱(GT/Honeypot + Consensus/IAA)** + 两个标配缺口(**project_admin 范围**、**导出**)。据此分两轨并行:

- **轨道 A · 快赢深化(数据现成,纯增量 / 轻改造)** —— 用户已选的四个方向。每条 1–2d,可逐版本穿插。
- **轨道 B · 结构性质量 epic(需 ADR + 数据建模)** —— Honeypot/GT + Consensus/IAA。把平台从"效率看板"升级为"质量平台",是差异化关键,但体量大、依赖底层。

> 排期建议:**A 轨逐版本滚动落地;B 轨只留设计、暂不排版本**。原因见下。版本号沿用 0.12.x patch 线滚动。

> ⚠️ **B 轨暂不排版本的根因(2026-06-03 拍板)**:当前 task 是 **1:1:1(单人单标)**,不存在"多人标同题(overlap)"。**B2 Consensus/IAA 的前提就是 overlap**,没有多人分发无从算一致性 —— 故 B2 阻塞,只留设计。B1 Honeypot 技术上单人即可(混入 GT 比对),但与 B 同属"质量平台"大方向,一并保持设计先行,等 overlap / 众包场景出现再排。

---

## 轨道 A · 快赢深化(四方向)

### A1. 质量归因包(P2,数据现成)
**目标**:让管理者/标注员看到"错在哪、标了啥",驱动针对性反馈。

- **Reject 原因细分 per-person**:`/admin/people` detail + `/me` 增加本人 reject 原因分布(漏标/多标/类别错/位置错占比)。后端复用 `task.reject_reason_type`(DuckDB 已带),按 user 聚合。
- **类别覆盖 / 分布**(§4.1 点名):按 `annotations.class_name` 出 per-person 类别占比 → 检测偏科/盲区。参考 LS `ProjectSummary.created_labels`。
- **首过率 first-pass yield**:一次通过(无 reopen)/ 提交总数 —— 比 reopen 率更标准的质量 KPI。数据走 `tasks.reopened_count`。
- 前端:recharts 横向条/饼 + 加到 detail 抽屉与 `/me`。
- **verify**:后端聚合单测(per-person reason / class / fpy);前端渲染测试;super_admin 与本人各自看到正确细分。

### A2. 导出 + 指标下钻(P2,快赢)
- **CSV 导出**:`/admin/people` 加导出端点(列选择器,对齐 Encord);最低 CSV,后续可加 Excel。**避坑**:不自造格式。
- **指标下钻**:点 detail 里的 reject 数 / 类别 → 跳到过滤好的任务列表(复用现有 tasks 查询 + query param)。
- **verify**:导出 CSV 列完整、编码正确(中文不乱码);下钻 URL 带正确 filter 落到任务列表。

### A3. project_admin 项目级范围(P2,标配 · 结构性中等)
**目标**:项目负责人看自己项目的绩效。**这是已知延后项**。

- **核心改造**:`/admin/people` 当前 `project` 参数**只过滤"返回哪些用户",不切聚合**(吞吐/质量仍是跨项目全局数字)—— 见研究档 §6 避坑。要给**每个聚合(annotation count / reopen / duration / sparkline)都加 project 过滤**。
- **RBAC**:放行 project_admin,强制 `project` 限其 owner/管理的项目(复用 `assert_project_visible`);super_admin 仍可全局/任意项目。
- **前端**:permissions 加 `admin-people` 到 project_admin;项目下拉锁定自有项目。
- **verify**:project_admin 仅见自有项目且数字按项目切分(非全局);越权 project 返回 403;super_admin 全局不变(回归测试)。
- **风险**:改的是已上线聚合,务必加聚合级单测对账"全局 vs 项目级"数字。

### A4. analytics 升级 + 工时热力图(P3,收尾)
- **`/admin/analytics` 升级 recharts**:3 个手搓 CSS 条 → 趋势线/直方图;可加"吞吐 trend over time"面板。
- **工时热力图**(小时×星期):`task_events.started_at` 聚合,复用 AnnotatorDashboard `hour_buckets` 雏形;放团队级 + 个人级。
- **Outlier N-sigma**(可选升级):把现有固定阈值 alerts 升级为按团队均值 ±Nσ 自动圈异常(参考 Labelbox Monitor)。
- **verify**:analytics 面板 recharts 渲染;热力图聚合正确;lint(css-tokens)+ vitest 绿。

---

## 轨道 B · 结构性质量 epic(只设计,暂不排版本)

> 这两块是研究档判定的 **P1 结构性盲区**。各需独立 ADR + 数据建模。
>
> **暂不排版本**:当前 task **1:1:1 单人单标,无 overlap**。B2 一致性的前提是多人标同题 → 阻塞。B1 honeypot 单人可行但与 B 同方向,一并设计先行。等出现 overlap / 众包 / 高质量场景需求再排版本。**本计划只立框架。**

### B1. GT / Honeypot 抽检(绝对准确率)
**价值**:reopen 率只是相对审核信号;honeypot 是衡量**绝对准确率**的唯一客观手段,也是后续 calibration/资格门禁的前提。

- **机制**:从已完成任务抽 N% 标为 GT;新任务队列**混入**已知答案任务,比对标注员答案。
- **指标**:per-labeler + per-class accuracy;分类 0/100%、检测用 IoU(参考 CVAT `target_metric_threshold`)。
- **可借鉴**:CVAT `quality_control` 的 GT job + 8 类冲突 + confusion_matrix(比我们 4 类 reject 细);CVAT 可配阈值(iou/oks/target_metric)。
- **数据**:`annotations.ground_truth` 列已存在;需新 honeypot 调度 + 评分回灌表。
- **决策点(ADR)**:GT 抽样策略、honeypot 对标注员是否隐藏(CVAT 隐藏)、评分如何不污染正常吞吐统计、与现有 `precomputed_agreement` 列关系。
- **底线**:质量三档(reopen 相对 / honeypot 绝对 / consensus 分歧)**分开存不混算**。

### B2. Consensus / IAA(多人一致性)
**价值**:测"题目歧义 / 多人分歧",低预算高质量场景(医疗/法务)常用 consensus 换 ground truth。

- **机制**:可配覆盖率%(如 5–10%)抽样**多人标同一资产**(LS `overlap`),算相互一致度。
- **算法(可插拔,学 LS `GET_TASKS_AGREEMENT_QUERYSET`)**:按任务类型分派 —— 分类=一致率、检测=IoU、转写=Dice、NER/OCR=Levenshtein(Kili 公式);control-tag 加权聚合。
- **数据**:`tasks.precomputed_agreement` 列**已存在但完全没接** —— 天然落点;需 overlap 分发逻辑 + 一致性计算 worker。
- **决策点(ADR)**:overlap 分发与调度、一致性算法接口形态、agreement_threshold 是否参与 task 完成判定(LS 用其判完成)、与 ROADMAP §2.3「Consensus replicas I19a」的关系(已在主 ROADMAP 跟踪,本档与之合并)。
- **关联**:主 ROADMAP §C.7 I19 / 取经合集 §2.3 已规划 Consensus replicas,B2 是其绩效侧落点,应同 epic。

---

## 1. 版本切片建议(滚动,可调)

| 切片 | 内容 | 体量 | 依赖 | 状态 |
|---|---|---|---|---|
| **v0.12.4** | **A1 质量归因包(reject 细分 + 类别覆盖 + 首过率)** | 1–2d | 无 | **本次实现**,见 [v0.12.4 plan](2026-06-03-v0.12.4-quality-attribution.md) |
| v0.12.5 | A2 导出 + **项目维度**下钻(reject/类别下钻并入 A3) | 1–2d | 无 | **已实现**,见 [v0.12.5 plan](2026-06-03-v0.12.5-export-drilldown.md) |
| v0.12.6 | A3 project_admin 项目级范围(**风险:改已上线聚合**)+ **reject/类别维度下钻**(从 A2 顺延) | 2–3d | 聚合改造 + 回归测试 | **已实现**,见 [v0.12.6 plan](2026-06-03-v0.12.6-project-scope-drilldown.md) |
| v0.12.7 | A4 analytics 升级 + 热力图 | 1–2d | recharts(已进) | **已实现**,见 [v0.12.7 plan](2026-06-03-v0.12.7-analytics-heatmap.md) |
| — | B1 Honeypot/GT · B2 Consensus/IAA | 大 | overlap / 众包场景触发 | **只设计,不排版本(1:1:1 阻塞)** |

> A1–A4 顺序可按反馈调整;A3 因改动已上线聚合,**单独切一版隔离回归风险**,不与快赢混版。B 轨等 overlap 前提出现再排。

## 2. 非目标 / 暂不做
- **Calibration 资格门禁路由**(Scale 独有,P4 差异化):依赖 B1 honeypot 先落,众包场景驱动再做。
- **AHT / rework 分模式工时**:需给 `task_events` 加 mode 维度,P4。
- **ClickHouse 升级**:触发条件未到(研究档 §4.3),DuckDB 顶着。
- **薪酬/计件**:只出指标可视化,不做业务规则。

## 3. 文档 / 治理
- 每个切片落地配套:CHANGELOG 版本段 + `docs-site/user-guide` 同步 + 收尾删 ROADMAP 已落项。
- B1/B2 各写 ADR(`docs/adr/`),并回填主 ROADMAP §2.3 / I19 引用。
- 研究档 §6 避坑表是 PR review 底线(质量三档分开、一致性算法可插拔、聚合级 project 过滤、不自造导出格式)。
