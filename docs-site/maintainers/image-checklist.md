# 媒体清单（用户手册）

> 这个文件位于 `docs-site/maintainers/image-checklist.md`，不参与文档站发布，仅作为 maintainer 的工作清单。
>
> 标 `[auto]` 的图由 `pnpm --filter @anno/web screenshots` 自动生成（脚本：`apps/web/e2e/screenshots/`），输出到 `docs-site/user-guide/images/`。
>
> 简短动图由 `screenshots:flows` 生成 GIF；较长、强调 AI 链路、视频或 3D 平滑度的流程由 4K60 母版运行 `pnpm docs:media:derive`，派生为 `docs-site/public/media/**/*.mp4` 与 WebP 封面，并同步生成首页 VP9 WebM、H.264 MP4 fallback 与 WebP 封面。
> 更新流程：
>
> 1. 启动 docker / api / dev 三件套（同 `pnpm test:e2e`）
> 2. 修复截图 seed 并按能力绑定 live backend；无 GPU 时显式使用协议 stub
> 3. `pnpm --filter @anno/web screenshots:matrix`、`pnpm --filter @anno/web screenshots:flows` 和 `pnpm docs:media:derive`；首页 Hero 源图有变化时再运行 `pnpm --filter @anno/docs-site media:home-hero`
> 4. 人眼审阅全部 PNG，并检查 MP4/GIF 的起点、核心动作、结果落地和终点
> 5. 运行 `pnpm docs:media:audit -- --release`、manifest release gate 和 orphan strict gate 后再提交

## 拍摄约定

- **分辨率**：desktop 1440×900、mobile 390×664；高清母版 3840×2160 / 60fps；文档 MP4 1280×720 / 30fps
- **格式**：截图 PNG；不超过约 6 秒的简单动作可用 GIF；AI、视频、3D 和长链路使用 H.264 MP4 + WebP 封面
- **浏览器**：Playwright 固定版本 Chromium；时区、语言、DPR、时钟和动画由 driver 统一固定
- **数据来源**：只使用 `screenshots` seed catalog 的固定逻辑键；不从开发库随机选择项目或任务
- **动态信息**：账号、时间和通知数等不稳定区域由统一 mask 规则处理
- **标注红框**：引导读者注意的位置用红框（#FF3333，2px）
- **主题**：普通页面默认浅色；图片、视频、点云工作台统一以暗色作为无后缀主产物，其他主题按 scene 声明生成后缀变体
- **保存路径**：`docs-site/user-guide/images/<page>/<name>.png`

矩阵数量以 manifest、scene、磁盘文件和文档引用四方一致为准；每次重录后重新核对各 project 数量，避免在清单中保留会漂移的手工统计。

### 暗色工作台重录

- [x] 图片工作台静态图：`workbench/layout-overview.png`、`mask-brush/toolbar-overview.png`、`sam/{smart-point-toolbar,interactive-toolbar,magic-box-toolbar,exemplar-output-mode,ai-inspector-panel}.png`、`workbench/ocr-real-scene.png`、`review/{workbench,reject-form}.png`
- [x] 图片工作台流程：短交互保留 GIF；Magic Box、OCR、AI 预标与候选审阅已迁移到 `public/media/**/*.mp4`
- [x] 首页图片工作台媒体：`public/home/ai-assisted-annotation.*`、`public/home/sam-tools/{smart-point,smart-box,exemplar}.*` 与 `public/home/ocr-real-scene.*`，均由对应 4K60 母版派生 VP9 WebM、H.264 MP4 fallback 和 WebP 封面；OCR 母版中的 AI 面板停靠在主图右侧
- [x] 首页 Hero 派生图：`theme/assets/home/hero/*.webp`，由对应用户手册截图生成
- [x] 视频工作台：静态总览保留 PNG；工作台播放、AI 面板、多目标种子和 Mask 轨迹编辑已迁移到 `public/media/video/*.mp4`
- [x] 点云工作台：`workbench/pointcloud-real-scene.png`（nuScenes 六相机环视）+ `public/media/pointcloud/{controls,orbit}.mp4`
- [x] 删除过期图：旧 `sam/text-three-modes.png` 与未展示命名状态、带权限告警的 `polygon/{vertex-edit,close-hint}.png`

## Batch 1 · 数据集 / 导入导出（新增于 2026-06-10 · IA 重构）

> 文档侧已在对应位置打 `<!-- TODO(v0.14.18) IMAGE_CHECKLIST: ... -->` 注释占位（未嵌 `![]()`，不破图）；下面是配套拍摄清单。新增图片目录 `images/datasets/`。

### 数据集 · 导入

- [x] `images/datasets/import-images-wizard.png` — 导入数据集向导基本信息步选「图像」+ 来源选「ZIP 上传」；红框：数据类型选择、文件拖放区 `[auto]`
- [ ] `images/datasets/import-wizard-3d-type.png` — 导入向导基本信息步选「3D 点云」+ 勾「声明为时序数据集」；红框：数据类型、时序开关、axis_convention 选择器 **[Tier B]** 向导第 1 步须先上传文件「下一步」才可点，需文件上传 fixture 才能进到基本信息步
- [ ] `images/datasets/pointcloud-dir-layout.png` — 单 scene vs 多 scene 目录树并排对比（建议矢量示意图而非真截图）

### 数据集 · 存储连接器

- [ ] `images/datasets/connector-create-form.png` — 新建数据源对话框（S3/OSS 模式）；红框：Endpoint / Bucket / Access key + HTTPS 复选框
- [ ] `images/datasets/connector-test-result.png` — 连接器列表行测试成功状态；红框：绿色「连接成功」+ 样本计数
- [ ] `images/datasets/connector-import-step.png` — 导入向导「连接器导入」子面板；红框：source_path / 递归开关 / include_globs
- [ ] `images/datasets/connector-allowlist.png` — 超管连接器主机白名单配置面板 ⚠️ **前端 UI 尚未实现（仅超管 API），待 UI 就绪再拍**

### 预测导入 / 导出

- [x] `images/projects/prediction-import-wizard.png` — 导入预测弹窗（AAP JSON / COCO / YOLO 格式选择 + 文件上传 + 替换开关）；红框：格式下拉、YOLO 变体下拉、替换开关 `[auto]`
- [x] `images/projects/prediction-purge-modal.png` — 清理预测弹窗三种来源范围 + ML Backend 风险确认复选框 `[auto]`

### 导出格式

- [ ] `images/export/yolo-dir-tree.png` — 解压后 YOLO 单目标导出包目录树（terminal 截图）；红框：labels/ 镜像层级

### 项目 · 工具单位

- [x] `images/projects/tool-units-panel.png` — 项目设置「类别与属性」面板，按工具单位 tab 切换；红框：工具单位切换 tab、某工具下的类别列表、属性 schema 区 `[auto]`

## Batch 2 · 视频/点云 AI 审阅 + 时间轴交互（新增于 2026-07-06） <!-- PR #50 · v0.21.9–17 -->

> 配套视频/点云工作台 AI 审阅体验与时间轴交互。可重现的缩放、刷选、续写与键盘流转已逐步收录到 `[auto-gif]`；需要特殊审阅状态的画面仍保留为手工清单。

### 时间轴交互（对应 `workbench/video-playback.md`）

- [x] `images/video-timeline/horizontal-zoom.gif` — `Ctrl`/`⌘` 滚动以指针帧为锚点放大时间轴 → 普通滚轮平移 → 双击复位全过程 `[auto-gif]`（flows/video-timeline-zoom）
- [ ] `images/video-timeline/prediction-density-track.png` — 时间轴 AI 预测密度轨（violet 柱）+「跳到上/下一个有预测的帧」导航按钮；红框：密度轨、跳转按钮 [manual]
- [x] `images/video-timeline/brush-create-chapter.gif` — 时间轴圈选一段 → 填写章节表单 → 创建章节全过程 `[auto-gif]`（flows/video-chapter）
- [x] `images/video-timeline/chapter-resize-hover.gif` — 章节条 ↔ 侧栏行双向 hover 高亮，并拖边界改起止 `[auto-gif]`（flows/video-chapter 的拖柄裁切版）

### 视频 AI 审阅（对应 `workbench/video-track.md`）

- [ ] `images/workbench/video-track-candidate-render.png` — 画布渲染检测式轨迹候选 `video_track_bbox`（violet，采纳前逐帧核对态）；红框：候选框 + 单条采纳/拒绝入口 [manual]
- [ ] `images/video-propagate/tracker-review-bar.png` — 固定一条含至少 2 个目标的 `pending_review` 作业，当前帧同时露出 violet 候选与顶部「接受 / 丢弃」审阅条；红框：候选目标数、覆盖帧数、整批决策按钮 **[Tier A]** [manual]（需独立场景；现有工作台场景会主动丢弃待审作业）
- [x] `public/media/video/tracker-cross-frame-points.mp4` — 两个公交车目标分别设置 F0/F4 正点 → 同时追踪 → 时间轴复核 → 接受 `[derived-mp4]`
- [x] `public/media/video/tracker-positive-negative.mp4` — 两个公交车目标分别设置跨帧正负点 → 同时追踪 → 时间轴复核 → 接受 `[derived-mp4]`
- [x] `public/media/video/tracker-box-seed.mp4` — 两个公交车目标分别绘制完整车身框 → 同时追踪 → 时间轴复核 → 接受 `[derived-mp4]`
- [ ] `images/workbench/video-track-keyframe-source-bar.png` — 右栏「关键帧来源迷你条」近景（紫=AI / 灰=人工）+ 画布 AI 关键帧角标；红框：迷你条色段、画布角标 [manual]
- [x] `images/workbench/video-track-carryover-ghost.gif` — 多轨迹跨网格帧续写：上一网格帧有框、当前帧未画的轨迹显示淡色 ghost 参考框 → `Tab` 循环 → 拖动续写 →「续写后自动前进」自动跳下一条 `[auto-gif]`（flows/video-track-carryover）
- [ ] `images/workbench/video-track-sticky-hint.png` — 「粘轨迹」态画布顶部常驻提示条；红框：提示条 [manual]
- [ ] `images/workbench/video-track-multiselect-batch-card.png` — 当前帧同时显示至少 2 条轨迹，`Shift` / `Ctrl` 多选后同时露出画布浮动批量卡、右栏批量工具条和高亮轨迹框；红框：「已选 2 条轨迹」与「批量延展」 **[Tier A]** [manual]（自动化前需补可清理的双轨迹 fixture）

### 审阅键盘化（对应 `workbench/index.md` 或 `review/index.md`「视频任务审核」）

- [ ] `images/workbench/review-two-level-cycle.png` — 两级键盘循环示意（建议矢量示意图）：`Tab`/`Shift+Tab` 同类流转，`` ` ``/``Shift+` `` 跨类跳转（AI 待审 → 人工 → 轨迹）[manual]
- [x] `images/workbench/review-auto-advance.gif` — 决策后自动前进：`A`/`D` 采纳/拒绝 AI 候选后选中自动推进到下一待决对象 `[auto-gif]`（flows/candidate-keyboard-review 的聚焦裁切版）

### 两类传播术语（对应 `workbench/video-propagate.md`）

- [ ] `images/video-propagate/track-vs-copy-buttons.png` — 选中卡两类传播按钮对比：「AI 追踪」（bot 图标 · 调 tracker 模型）vs「复制后续」（copy 图标 · 纯几何铺帧）；红框：两按钮 + tooltip [manual]
- [x] `images/video-propagate/shift-brush-range.gif` — `Shift` 刷选时间轴圈定 AI 追踪范围 → 画布右上追踪面板同步回填 + 影响范围高亮可见 `[auto-gif]`（flows/video-tracker-range）

### 点云文字标签（对应 `workbench/3d-box.md` / `workbench/settings.md`）

- [ ] `images/3d-box/billboard-label.png` — 3D 框顶部 billboard 文字标签（始终朝向相机，随视角旋转保持正对）；红框：标签、「标签内容」设置入口 [manual]

### 全局 Pipeline 库（对应新建 `projects/pipeline-library.md` 或 `projects/ai-preannotate.md`）

- [x] `public/media/pipeline/template-create.mp4` — `/ai-pre/pipelines` 命名公共模板 → YOLO 车辆检测 → 车辆属性分类 → 车型/颜色写回 → 保存后进入编排库 **[Tier A]** `[derived-mp4]`
- [x] `public/media/pipeline/apply-project.mp4` — 选择公共两阶段模板 → copy-on-write 套用为项目默认 → 工作台按项目编排运行 → 查看车型与颜色候选 **[Tier A]** `[derived-mp4]`

## Batch 3 · AI 任务入口 / 候选生命周期 / 运营恢复（新增于 2026-07-11）

> 对应本轮 AI 文档分层和实现对齐后的新增缺口。优先表现“从哪里进入、结果落到哪里、失败后去哪里恢复”，避免再补只有静态全页、没有任务上下文的截图。建议先拍 **Tier A**，再补状态型或需要特殊种子数据的 **Tier B**。

### AI 入口与当前题执行

- [ ] `images/ai/task-entry-map.png` — AI 五类入口关系图：图片交互式 AI / 当前题 AI / 二次推理 / 批量预标 / 视频 AI 追踪；用箭头标出工作台、`/ai-pre`、模型市场三类页面边界，建议矢量图而非真截图 **[Tier A]** [manual]
- [ ] `images/ai/current-task-image-panel.png` — 图片工作台顶部「当前题 AI」面板展开态；红框：模型选择、参数区、「运行当前题」、候选结果入口 **[Tier A]** [manual]
- [ ] `images/ai/current-task-video-frame.png` — 视频工作台当前帧 AI：顶部 AI 面板 + 画布 violet `video_bbox` 候选 + 时间轴当前帧；强调“只处理当前帧” **[Tier A]** [manual]
- [ ] `images/ai/secondary-inference-panel.png` — 已确认父 bbox / polygon 选中后打开「✦ 二次推理」；红框：父对象、可用模型、阈值 / 文本参数、运行按钮 **[Tier A]** [manual]
- [ ] `images/ai/secondary-inference-result.png` — 二次推理完成后的父属性补写 + 子框结果；红框：属性旁 `✦ AI` 溯源徽标、父子关系、人工修改后徽标消失前后对比 **[Tier B]** [manual]
- [ ] `images/ai/current-task-model-availability.png` — 当前题模型选择器的可用 / 置灰项对照；红框：能力不匹配原因、项目未启用提示、跳转 ML 模型设置入口 **[Tier B]** [manual]

### 图片候选审阅与数据边界

- [ ] `images/ai/candidate-review-overview.png` — 图片工作台 AI 待审候选总览；同时露出画布 violet 候选、右侧候选列表、接受 / 拒绝按钮与来源信息 **[Tier A]** [manual]
- [x] `public/media/ai/candidate-keyboard-review.mp4` — `Tab` 选中候选 → `A` 接受 / `D` 拒绝 → “决策后自动前进”切到下一项的完整键盘流 **[Tier A]** `[derived-mp4]`
- [ ] `images/ai/prediction-to-annotation.png` — 同一对象“候选 Prediction → 接受后 Annotation”的前后对比；红框：颜色 / 来源标记变化、接受后仍可编辑 **[Tier A]** [manual]
- [ ] `images/ai/candidate-source-badges.png` — 候选列表按来源展示 ML Backend / 外部导入 / 交互式结果；红框：来源徽标、模型版本与置信度 **[Tier B]** [manual]

### 后台任务与失败恢复

- [ ] `images/jobs/jobs-bell-active.png` — 顶栏「后台任务」展开态：进行中预标、导出、导入任务混排；红框：进度、取消、完成后下载入口 **[Tier A]** [manual]
- [ ] `images/jobs/video-tab-pending-review.png` — `/ai-pre/jobs?tab=video` 视频标签：`running / pending_review / accepted / discarded` 状态对比；红框：项目筛选、状态徽标、返回视频工作台入口 **[Tier A]** [manual]
- [x] `public/media/workflows/jobs-retry-recovery.mp4` — 失败任务详情、错误摘要、真实重试、新 retry 作业完成与进入工作台审阅 OCR 候选的完整闭环 **[Tier A]** `[derived-mp4]`
- [ ] `images/jobs/notifications-vs-jobs.png` — 「通知中心」与「后台任务」双面板对照图；标注前者负责业务提醒，后者负责长任务进度 / 取消 / 下载，建议拼图 **[Tier B]** [manual]

### 项目、数据与审核入口

- [ ] `images/projects/project-actions-menu.png` — 项目行 / 卡片 `⋮` 菜单展开态；红框：「导入预测」「导出标注数据」「复制项目配置」三个高频入口 **[Tier A]** `[auto]`
- [ ] `images/projects/wizard-data-members-steps.png` — 创建项目向导 Step 5「关联已有数据集」与 Step 6「选择已有成员」并排拼图；强调这两步可跳过、不是现场上传 / 邀请 **[Tier A]** [manual]
- [ ] `images/datasets/list-filters-and-repair.png` — 数据集页类型筛选 + 数据集卡操作；红框：图像 / 视频 / 3D / 多模态筛选、缺失视频元数据补生成入口 **[Tier B]** [manual]
- [ ] `images/datasets/prediction-match-preview.png` — 导入预测预览校验：匹配成功、未匹配、同名歧义三类结果；红框：实际匹配键与确认导入按钮 **[Tier B]** [manual]
- [ ] `images/projects/ml-backends/project-routing.png` — 项目设置「ML 模型」中的 backend 启用 / 停用与能力路由；红框：主 backend、交互式 AI 开关、置灰原因 **[Tier A]** [manual]
- [ ] `images/review/batch-card-grid.png` — 质检审核 landing 的批次卡片网格新布局；替换旧批次树截图，红框：待审数、进度条、进入批次按钮 **[Tier A]** `[auto]`
- [ ] `images/review/bulk-review-toolbar.png` — 选中多条待审任务后的批量操作栏；红框：已选数量、批量通过 / 退回、跨页选择边界 **[Tier B]** [manual]
- [ ] `images/superadmin/platform-overview.png` — 超级管理员「平台概览」全屏；红框：系统健康、近期活动、平台统计，并与「项目管理」入口区分 **[Tier A]** `[auto]`

## 综合截图清单（按区域维护）

> 新截图统一在这里按区域维护；已废弃截图保留删除原因，避免后续重复补拍。

### 入口

- [x] `images/getting-started/login.png` — 登录页全屏 [auto]
- [x] `images/getting-started/forgot-password.png` — 忘记密码页 + 成功 toast [auto]
- [x] `images/getting-started/e2e.gif` — 登录 → Dashboard → 打开项目 → 标 bbox → 提交并看到下一题 `[auto-gif]`（flows/e2e-quickstart）
- [ ] `images/getting-started/annotator-dashboard.png` — 标注员仪表盘全屏，标注红框：产能/质量分区 + 「打开」按钮 **[Tier B]** 截图 driver 把所有角色 token 收敛为 super_admin，role=annotator 仍渲染 AdminDashboard，需真实标注员 seed token
- [x] `images/getting-started/role-dashboard-overview.png` — 四种角色 Dashboard 拼图 [auto]
- [x] `images/getting-started/platform-nav-overview.png` — 平台主界面侧边栏各分区 [auto]

### 数据集

- [ ] `images/datasets/lidar-axis-wizard-step2.png` — 向导第 2 步选「3D 点云」后出现 AxisConventionPicker + 自动检测按钮 [manual]
- [ ] `images/datasets/lidar-axis-mismatch-banner.png` — 3D 工作台顶部坐标系不一致 banner + 重投影按钮 [manual]

### 项目

- [x] `images/projects/create-entry.png` — 「新建项目」按钮高亮 [auto]
- [x] `images/projects/wizard-steps.png` — 6 步 wizard 关键截图 [auto]
- [x] `images/projects/wizard-step4-backend.png` — wizard 第 4 步 ML Backend 配置 [auto]
- [x] `images/projects/empty-state.png` — 项目列表空状态 [auto]
- [x] `images/projects/error-state.png` — 项目列表错误状态 [auto]
- [x] `images/projects/ai-pre-stepper.png` — AI 预标注步骤条 [auto]
- [x] `images/projects/ai-pre-history-search.png` — 预标注历史搜索 [auto]
- [~] ~~`images/projects/ai-pre-empty-alias.png` — 预标注 alias 为空提示~~ — **已废弃**：PromptComposer（alias 警告所在）在 ai-pre 重构中删除，无对应 UI
- [x] `images/projects/ai-pre-config-panel.png` — 项目详情面板（批次列表 + 配置区 + 跑预标按钮 + 导入预测按钮）`[auto]`
- [x] `public/media/ai/preannotate.mp4` — 选择项目与批次 → 运行 AI 预标 → 查看任务历史 → 返回工作台核对候选 `[derived-mp4]`
- [ ] `images/projects/ai-pre-pipeline-dag-canvas.png` — AI 预标项目详情「批跑预标设置」两列 DAG 编排画布 + 右侧节点参数；红框：节点 +/删除/改父级、兼容性警告、运行计数 [manual]
- [ ] `images/projects/ai-pre-project-pipeline-save.png` — 「保存为项目编排」成功态；红框：保存按钮、已保存编排阶段数 badge、清除按钮 [manual]
- [x] `images/projects/ai-pre-variant-selector.gif` — VariantSelector 两轴选项 + 推荐 badge `[auto-gif]`（flows/ai-pre-variant-selector，切 select 看 显存/精度/推荐 pill 联动）
- [x] `images/projects/batch-status-list.png` — 批次列表各状态彩色徽标 `[auto]`（指向 P-0001，有 BT-260/261/262 多批次）
- [x] `images/projects/batch-bulk-actions.gif` — 多选后批量操作工具栏（含批量通过/驳回）`[auto-gif]`（flows/batch-bulk-actions，勾选批次→工具栏浮现，P-0001）
- [ ] `images/projects/batch-export-dialog.png` — 导出格式选择面板 [manual]
- [x] `images/projects/data-manager-overview.png` — 整体布局（视图列表 + 过滤条件栏 + 任务表格）`[auto]`
- [x] `images/projects/data-manager-filter-rules.png` — 过滤条件行编辑器字段选择器展开 `[auto]`
- [ ] `images/projects/copy-config-banner.png` — 向导顶部预填 banner + 复制指引 checkbox [manual]
- [x] `images/projects/ml-backends/register-form.png` — 注册表单（URL 示例 + 最大并发 + 测试连接）`[auto]`
- [ ] `images/projects/ml-backends/limit-modal.png` — 多后端共存限制弹窗 [manual]
- [x] `images/projects/template-library-overview.png` — 模板库页（管理组入口 + 新建/导出按钮 + 四 tab）`[auto]`（本地无种子模板，呈空态）
- [ ] `images/projects/template-apply-banner.png` — 从模板创建 Wizard 顶部 banner [manual]

### 参考

- [x] `images/export/format-select.png` — 导出对话框 + 格式选项 [auto]
- [~] ~~`images/export/progress.png` — 进度条 + 下载链接 toast~~ — **已废弃**：导出异步化，进度移至右上角任务铃 JobsBell，无独立进度条页（待补 JobsBell 截图）
- [x] `images/notifications/panel-overview.png` — 通知面板展开态（筛选 tab + 分组 + 加载更多）
- [x] `images/settings/profile.png` — 设置 / 个人资料 区
- [x] `images/settings/workbench-prefs.png` — 标注偏好（自动保存周期 + 颜色策略）
- [x] `images/settings/notification-prefs.png` — 通知偏好的 in-app / email 开关矩阵
- [x] `images/settings/system-smtp.png` — 系统设置 / SMTP 配置 + 发送测试邮件按钮（仅 super_admin）
- [x] `images/settings/my-feedback.png` — 我的反馈：用户视角看自己提交的 BUG 工单与状态

### 审核

- [x] `images/review/workbench.png` — 审核三栏全图 + 操作面板 [auto]
- [x] `images/review/reject-form.png` — 退回备注表单 [auto]
- [x] `images/review/reject-flow.gif` — 定位待审任务 → 选择结构化原因 → 填写补充说明并确认退回 `[auto-gif]`（flows/review-reject）
- [x] `images/review/review-list-page.png` — ReviewPage 左侧批次树 + 任务列表（缩略图 + 批量操作按钮）`[auto]`

### 平台管理

- [x] `images/superadmin/bugs/list.png` — `/bugs` 列表全图，含状态/严重度筛选 + 重开徽标 `↻N`
- [x] `images/superadmin/bugs/detail-panel.png` — 详情面板：元信息行、Markdown 描述、截图附件、状态切换按钮
- [x] `images/superadmin/bugs/status-transitions.png` — 状态切换按钮高亮 + 关闭后再重开的 reopen 徽标 `[auto]`
- [x] `images/superadmin/users/list.png` — `/users` 卡片列表 + 顶部 4 张统计卡 + 角色徽标颜色
- [x] `images/superadmin/users/invite-modal.png` — 邀请用户对话框
- [x] `images/superadmin/users/edit-modal.png` — 编辑用户对话框（角色选择 + 停用按钮）`[auto]`
- [x] `images/superadmin/users/permission-matrix.png` — 权限矩阵预览（PERMISSION_GROUPS × ROLE_PERMISSIONS）`[auto]`
- [x] `images/superadmin/users/groups-tab.png` — 用户组 tab，演示组创建与成员添加 `[auto]`（数据组 tab，本地无组呈空态）
- [ ] `images/superadmin/users/api-keys.png` — API Keys 对话框（明文一次显示）
- [x] `images/superadmin/analytics/overview.png` — 分析页全屏（时间范围下拉 + 4 面板）
- [x] `images/superadmin/analytics/heatmap.png` — 7×24 工时热力图网格
- [x] `images/superadmin/audit-logs/detail-modal.png` — 详情 Modal detail_json + 时间线追溯按钮 `[auto]`
- [x] `images/superadmin/audit-logs/filter-bar.png` — 筛选栏（scope 切换 + detail 键名/键值输入框）
- [ ] `images/superadmin/failed-predictions/list.png` — /ai-pre/jobs?status=failed 列表（状态筛选 + 重试/放弃/显示已放弃 toggle） **[Tier B]** 带 status 时客户端筛选清空 mock，不带又混入真实成功 job，需真实 failed 种子数据；失败列表已由 `images/workflows/failed-prediction-recovery-jobs-list.png` 覆盖
- [ ] `images/superadmin/failed-predictions/dismiss-restore.png` — 显示已放弃后含「已放弃」badge + 恢复按钮 [manual]
- [x] `images/superadmin/ml-backend/register-form.png` — 注册表单全貌含 GPU 物理资源、显存预算、驱逐优先级、当前预算、desired → effective、max_concurrency 与 extra_params **[Tier A]** `[auto]`
- [ ] `images/superadmin/ml-backend/gpu-resource-overview.png` — 注册管理 tab 的 GPU 资源总览；红框：runtime ready、全局期望模式、资源 ID、节点 / 物理设备、可分配显存、backend 数、configured / desired / effective 与 blocker **[Tier A]** `[auto]`（需固定 `GPU_ARBITER_RESOURCES_JSON` 或接口 fixture，不能拍空配置）
- [ ] `images/superadmin/ml-backend/health-card.png` — 实时 `/health` 卡片（GPU / video_pool meta）
- [ ] `images/superadmin/ml-backend/health-state-badges.png` — connected/error/disconnected 三状态徽章对比 [manual]
- [x] `images/superadmin/model-market/list.png` — 模型市场 3 个 tab 全图
- [ ] `images/superadmin/model-market/protocol-card-details.png` — 能力目录协议卡复用 ModelCard 的详情态；红框：可接受输入、输出属性/几何、资源/变体、`⚠ 协议` 诊断 badge [manual]
- [~] ~~`images/superadmin/model-market-runtime-card.png` — backend 运行时大卡~~ — **已废弃**：运行时观测已改为服务池摘要卡 → 实例面板 → 详情 Sheet，不再按单 backend 展示大卡
- [x] `public/media/superadmin/model-market/runtime-pools.mp4` — 运行时摘要、完整数据来源、两列服务池、双实例展开与详情 Sheet；使用固定脱敏快照，并保留“暂无路由指标”的真实未知语义 **[Tier A]** `[derived-mp4]`
- [ ] `images/superadmin/model-market/runtime-data-sources.png` — 展开「数据来源」后的部分失败态；至少包含一个 stale/error 来源及更新时间，说明单源失败不抹掉其它可信数据 **[Tier A]** [manual]
- [ ] `images/superadmin/model-market/runtime-instance-detail.png` — 打开实例详情 Sheet；红框：路由状态、并发/延迟未知语义、health/compute、GPU claim、驻留与原始诊断 **[Tier B]** [manual]
- [ ] `images/superadmin/model-market/registry-service-pools.png` — 注册管理「服务池」主视图；展开一个池显示成员、权重、接流状态和维护操作，并保留五个结构化视图的 tab **[Tier A]** `[auto]`
- [ ] `images/superadmin/model-market/registry-issue-center.png` — 注册管理「问题中心」；展示按稳定键去重后的主问题、严重度、受影响对象计数与筛选 **[Tier B]** [manual]
- [ ] `images/superadmin/model-market/video-pool.png` — `_video_pool` 视频模态独立池 UI
- [ ] `images/superadmin/public-templates/scope-selector.png` — 可见范围下拉「公共」选项 disabled（非超管视角） [manual]
- [x] `images/superadmin/public-templates/templates-list.png` — 模板库四 tab + scope chip + usage_count `[auto]`（本地无模板呈空态）
- [x] `images/superadmin/system-monitoring/health-panel.png` — 4 组件卡 + Celery 队列表 + Workers 心跳表
- [x] `images/superadmin/system-monitoring/workers-table.png` — Workers 表（名称/Heartbeat/Pool/状态） `[auto]`

### 工作台

- [x] `images/bbox/draw-in-progress.gif` — 选矩形工具 → 画布拖出轴对齐矩形 `[auto-gif]`（flows/bbox-draw，P-COCO8）
- [ ] `images/polygon/vertex-edit.png` — 多边形选中态 + 边悬停 + 图标；旧图未展示命名状态且带权限告警，已删除，待建立可验证场景后暗色重拍
- [ ] `images/polygon/close-hint.png` — 三顶点后下一点贴近首点的闭合提示；旧图未展示命名状态且带权限告警，已删除，待建立可验证场景后暗色重拍
- [ ] `images/keypoint/human-pose.png` — COCO 17 点人体姿态 + 骨架连线；旧 1×1 占位图已删除，待重拍
- [ ] `images/keypoint/hand.png` — 21 点手部骨架；旧 1×1 占位图已删除，待重拍
- [x] `images/sam/text-three-modes.png` — 已删除；输出选项现按模型任务和后端能力动态裁剪，不再保留误导性的固定三选参考图
- [ ] `images/3d-box/workbench-overview.png` — 3D 工作台全局（主视图 + 相机面板 + PSR 面板 + 自动贴合按钮组） [manual]
- [ ] `images/3d-box/psr-panel.png` — PSR 面板近景，标注红框：l/w/h 尺寸字段 [manual]
- [ ] `images/3d-box/autofit-buttons.png` — 贴合/收尺寸/贴地/朝向按钮组 [manual]
- [x] `images/workbench/layout-overview.png` — 四区布局全图（顶栏/左工具栏/画布/右抽屉） [auto]
- [x] `public/media/ai/ocr-current-task.mp4` — 真实 RapidOCR 当前题从派发、推理中到生成文本多边形候选 `[derived-mp4]`（P-OCR）
- [x] `images/workbench/ocr-real-scene.png` — OCR 面板无脚本静态备用图 `[auto]`（scene: `workbench/ocr-real-scene`，P-OCR）
- [ ] `images/workbench/task-status-labels.png` — 六种状态标签竖列

#### 超大图片

> 固定项目/数据集为 `P-LARGE-IMG` / `DS-LARGE-IMG`。它在截图数据库中存在时会作为可选项目加入 catalog；录制前必须确认 Cosmic Cliffs 金字塔已 ready，不得用整图加载冒充渐进 LOD。

- [x] `public/media/large-image/progressive.mp4` — NASA Cosmic Cliffs 从 overview 到目标 LOD 的渐进清晰过程，包含平移、连续缩放和 edge 区域且无白缝/闪烁 **[Tier A]** `[derived-mp4]`
- [ ] `images/workbench/large-image-pyramid-status.png` — required 超大图的“高清切片生成中”与失败/重试状态；不得自动请求整张原图 **[Tier A]** `[auto]`
- [ ] `images/mask-brush/large-image-limit.png` — 超大底图仍可浏览并使用矢量工具，同时 Mask 能力明确显示尺寸超限原因 **[Tier A]** `[auto]`（可先用 `P-LARGE-IMG` 建 scene）

- [x] `images/mask-brush/toolbar-overview.png` — Mask 笔刷浮动工具栏全貌（笔刷/橡皮 chip + 半径 slider + 状态文字） [auto]
- [x] `images/mask-brush/draw-in-progress.gif` — Mask 笔刷涂抹填区 + Enter 提交全过程 `[auto-gif]`（flows/mask-draw，P-COCO8，落库类型由任务 Mask 能力决定）
- [x] `public/media/video/mask-track-edit.mp4` — 点击「Mask 轨迹」从空白创建 Mask → `Enter` 生成首个关键帧 → 跳到保持帧编辑同一轨迹 → 笔刷修正 → `Enter` 物化第二个人工关键帧 **[Tier A]** `[derived-mp4]`
- [x] `public/media/video/mask-correction-propagate.mp4` — 在 F5 漂移帧补入漏分区域、扣除外溢区域 → 使用原生 Mask seed 向后传播 → 跨帧审阅 → 采纳后原轨迹保留 17 个关键帧 **[Tier A]** `[derived-mp4]`
- [ ] `images/pointcloud-crossframe/crossframe-propagate-toast.png` — 按 Alt+→ 跳帧自动选中新框 + toast [manual]
- [ ] `images/pointcloud-crossframe/overlay-k3-triview.png` — K=3 时主视图 + 三视图半透明虚线参考框 [manual]
- [ ] `images/workbench-pointcloud-projection/overlay-wireframe.png` — 相机面板线框投影 overlay + 「正对」角标 [manual]
- [ ] `images/workbench-pointcloud-projection/click-to-select-3d.png` — 点击投影框联动主视图高亮 [manual]
- [x] `images/workbench/pointcloud-real-scene.png` — nuScenes 激光雷达 + 6 相机环绕布局全景 `[auto]`（scene: `workbench/pointcloud-real-scene`，P-PC-MULTI）
- [x] `public/media/pointcloud/orbit.mp4` — 点云视图导航：收起两边栏后左键拖拽 orbit 环绕 + 滚轮缩放 `[derived-mp4]`（P-PC-DEV）
- [x] `public/media/pointcloud/controls.mp4` — 工作台设置抽屉点云控件演示（相机上色 / 点大小 / 深度提示逐项切换）`[derived-mp4]`（P-PC-DEV）
- [x] `images/workbench/pointcloud-rgb-colorize.png` — 相机上色前后对比（同上 `public/media/pointcloud/controls.mp4` 内含青蓝高度色→相机 RGB 的切换）`[derived-mp4]`
- [ ] `images/workbench/pointcloud-depth-heatmap.png` — 深度热力图 + figcaption 深度读数（控件 GIF 已演示开关，相机视图悬停深度读数特写仍 [manual]） [manual]
- [x] `images/polygon/draw-in-progress.gif` — 多边形逐点绘制全过程（落点 + 预览线，Enter 闭合提交）`[auto-gif]`（flows/polygon-draw，P-COCO8）
- [ ] `images/polygon/vertex-insert-alt.png` — 按住 Alt 悬停边上光标变「+」的瞬间
- [x] `images/polyline/draw-in-progress.gif` — 折线逐点绘制全过程（落点 + 预览线段，Enter 收尾）`[auto-gif]`（flows/polyline-draw，P-COCO8）
- [ ] `images/polyline/vertex-edit.png` — 折线选中态 Alt 插入/Shift 删除提示
- [x] `images/workbench/rotated-bbox.gif` — 拖框生成旋转框（angle=0）全过程 `[auto-gif]`（flows/rotated-bbox，P-COCO8；旋转手柄演示待补，盲拖坐标易空拖出第二框）
- [ ] `images/workbench/rotated-bbox-rotate.png` — 旋转约 30° 后状态 + 角度值
- [x] `images/sam/smart-point-toolbar.png` — 智能点交互工具条（正负极性 + 引擎/档位 + 状态灯）`[auto]`（scene: `sam/smart-point-toolbar`，P-COCO8 + live backend）
- [x] `images/sam/interactive-toolbar.png` — 智能框交互工具条（引擎/模型/档位 + 状态灯）`[auto]`（scene: `sam/interactive-toolbar`，P-COCO8 + live backend）
- [x] `images/sam/magic-box-toolbar.png` — Magic Box 交互工具条（紧凑 bbox 输出提示 + 引擎/档位 + 状态灯）`[auto]`（scene: `sam/magic-box-toolbar`，P-COCO8 + live backend）
- [x] `images/sam/exemplar-output-mode.png` — Exemplar 示例交互工具条（输出形态三选一 + 示例能力控件）`[auto]`（scene: `sam/exemplar-output-mode`，P-COCO8 + live backend）
- [x] `images/sam/smart-point-interaction.gif` — 无侧边栏的真实 SAM3 智能点车辆轮廓候选 `[auto-gif]`（flow: `sam-tool-smart-point`，P-COCO8）
- [x] `images/sam/smart-box-interaction.gif` — 无侧边栏的真实 SAM3 智能框车辆轮廓候选 `[auto-gif]`（flow: `sam-tool-smart-box`，P-COCO8）
- [x] `images/sam/smart-scribble-interaction.gif` — 选中已存原生 Mask 后连续绘制正、负笔迹并查看精修候选 `[auto-gif]`（flow: `smart-scribble`，P-COCO8 确定性签名候选）
- [x] `public/media/ai/assisted-annotation.mp4` — 无侧边栏的真实 SAM3 Magic Box 粗框、候选收紧与类别确认 `[derived-mp4]`（P-COCO8）
- [x] `images/sam/exemplar-interaction.gif` — 无侧边栏的真实 SAM3 Exemplar 车辆示例与全图相似候选 `[auto-gif]`（flow: `sam-tool-exemplar`，P-COCO8）
- [ ] `images/sam/exemplar-yoloe-toolbar.png` — YOLOE exemplar 交互工具栏能力裁剪态；红框：仅正样例、无负框/叠加文本、输出形态 [manual]
- [x] `images/sam/ai-inspector-panel.png` — 悬浮 AI 面板（Prompt/阈值滑块/变体选择） [auto]
- [ ] `images/workbench/current-task-project-pipeline.png` — 工作台「当前题 AI」面板按项目编排运行入口；红框：运行当前题（按项目编排 · N 阶段）按钮、项目编排来源提示 [manual]
- [ ] `images/video-playback/sampling-config.png` — 项目设置帧采样配置区（mode/target_fps/frame_step） [manual]
- [ ] `images/video-playback/chapter-sidebar.png` — 章节侧栏含彩色色带 + 章节列表 [manual]
- [x] `images/video-propagate/ai-tracking-panel.png` — 画布右上追踪面板展示新版作用范围、真实 backend 提供方、方向、范围与种子摘要 `[auto]`（scene: `workbench/video-ai-tracking-panel`）
- [x] `public/media/video/ai-tracker-panel.mp4` — 顶部打开 → 切换作用范围 → 拖动 / 缩放 → 关闭重开恢复 → 与 AI 单题互斥 `[derived-mp4]`
- [ ] `images/video-propagate/tracker-job-badge.png` — 进度 badge + 取消按钮 [manual]
- [x] `public/media/video/workbench-overview.mp4` — 视频工作台整体（时间轴 + 逐帧前进 + 播放）`[derived-mp4]`（开源 P-VIDEO-DEV，seed_video.py）
- [x] `images/workbench/video-track-trajectory.gif` — track 工具画框：两关键帧 + 逐帧线性插值 bbox 平滑移动（含类别 popover Enter 提交）`[auto-gif]`（flows/video-draw，P-VIDEO-DEV）
- [x] `images/workbench/video-real-scene.png` — 真实城市交通视频任务工作台 `[auto]`（scene: `workbench/video-real-scene`，P-VIDEO-DEV）
- [x] `images/workbench/video-track-timeline.png` — 视频轨道时间轴 + 关键帧 + 软网格（同上 `video-track-trajectory.gif` 画关键帧时时间轴同步呈现）`[auto-gif]`
- [ ] `images/workbench/video-track-compose-dialog.png` — 跳连对话框两种 gap 模式 [manual]
- [ ] `images/workbench/video-track-qc-warnings.png` — 画布左上角质量提示浮层 [manual]

### 工作流

- [x] 复用 `images/projects/ai-pre-config-panel.png` — ProjectDetailPanel（批次勾选 + predict_mode 三 tab + 跑预标按钮） [auto]
- [x] `images/workflows/failed-prediction-recovery-jobs-list.png` — /ai-pre/jobs?status=failed 列表 [auto]
- [x] 复用 `images/projects/wizard-steps.png` — 向导类型选择（7 种项目类型卡） [auto]
- [ ] `images/workflows/batch-assign-dialog.png` — 批次分配对话框（标注员/审核员选择）

### Dev / 协议图

> 这些是开发文档里的架构图候选，建议用 mermaid 而非真截图（直接写入对应 .md 文件）。

- [x] `dev/reference/video-frame-service.md` § Chunk 状态机：补 ready/pending/failed 三态图，含 smart_copy / transcode 注释
- [x] `dev/reference/video-frame-service.md` § Tracker job 事件序列：补 sequenceDiagram，含 FE / API / worker / ML / Redis Pub-Sub 五道
- [x] `dev/reference/ws-protocol.md` § 6.2 事件序列：补 stateDiagram-v2 可视化 tracker 事件流
- [x] `dev/concepts/state-machines.md` § Task 状态机：共享 Task canonical 已含 `rejected` 与批次级回退路径

## 新增图片时

1. 把图保存到 `docs-site/user-guide/images/<page>/<name>.png`
2. 在上表新增一行并勾选
3. 如果是可自动化的场景，在 `apps/web/e2e/screenshots/scenes.ts` 添加 scene，并标注 `[auto]`
4. `pnpm docs:build` 验证 dead-link 检查通过
