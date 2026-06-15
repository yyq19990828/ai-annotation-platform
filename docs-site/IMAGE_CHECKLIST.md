# 截图清单（用户手册）

> 这个文件**不上侧边栏**，仅作为 maintainer 的工作清单。
>
> 标 `[auto]` 的图由 `pnpm --filter web screenshots` 自动生成（脚本：`apps/web/e2e/screenshots/`），输出到 `docs-site/user-guide/images/`。
>
> 标 `[auto-gif]` 的动图由 `pnpm --filter web screenshots:flows` 录制（流程脚本：`apps/web/e2e/screenshots/flows/`），webm→GIF（需 ffmpeg），多步交互用，直接落到 `docs-site/user-guide/images/<page>/<name>.gif`。
> 更新流程：
>
> 1. 启动 docker / api / dev 三件套（同 `pnpm test:e2e`）
> 2. `pnpm --filter web screenshots`
> 3. `git diff docs-site/user-guide/images/` 人眼审阅
> 4. 满意即 commit；如需调整可编辑 `apps/web/e2e/screenshots/scenes.ts` 里的 `prepare` 钩子后再跑

## 拍摄约定

- **分辨率**：1920×1080（页面级）/ 1280×720（GIF 录屏）
- **格式**：截图 PNG，GIF 用于流程录屏
- **浏览器**：Chrome / Edge，关闭账号头像 / 时间 / 通知数等动态元素
- **数据脱敏**：邮箱 `demo@example.com`、姓名 `张三 / 李四 / 王五`、项目名 `演示项目-A`
- **标注红框**：引导读者注意的位置用红框（#FF3333，2px）
- **主题**：统一浅色主题
- **保存路径**：`docs-site/user-guide/images/<page>/<name>.png`

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

## 综合截图清单（按区域维护）

> 新截图统一在这里按区域维护；已废弃截图保留删除原因，避免后续重复补拍。
### 入口
- [x] `images/getting-started/login.png` — 登录页全屏 [auto]
- [x] `images/getting-started/forgot-password.png` — 忘记密码页 + 成功 toast [auto]
- [x] `images/getting-started/e2e.gif` — 30-60s 录屏：登录 → 打开项目 → 标 bbox → 提交
- [x] `images/concepts/role-permission-matrix.png` — /users 权限矩阵 5 角色行，标注红框：viewer 行 [auto]
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
- [x] `images/superadmin/ml-backend/register-form.png` — 注册表单全貌含 max_concurrency/extra_params `[auto]`（深链 `/model-market?tab=registry`）
- [ ] `images/superadmin/ml-backend/health-card.png` — 实时 `/health` 卡片（GPU / video_pool meta）
- [ ] `images/superadmin/ml-backend/health-state-badges.png` — connected/error/disconnected 三状态徽章对比 [manual]
- [x] `images/superadmin/model-market/list.png` — 模型市场 3 个 tab 全图
- [ ] `images/superadmin/model-market-runtime-card.png` — backend 卡片（GPU 显存 + 池状态 + 操作按钮） [manual]
- [ ] `images/superadmin/model-market/video-pool.png` — `_video_pool` 视频模态独立池 UI
- [ ] `images/superadmin/public-templates/scope-selector.png` — 可见范围下拉「公共」选项 disabled（非超管视角） [manual]
- [x] `images/superadmin/public-templates/templates-list.png` — 模板库四 tab + scope chip + usage_count `[auto]`（本地无模板呈空态）
- [x] `images/superadmin/system-monitoring/health-panel.png` — 4 组件卡 + Celery 队列表 + Workers 心跳表
- [x] `images/superadmin/system-monitoring/workers-table.png` — Workers 表（名称/Heartbeat/Pool/状态） `[auto]`

### 工作台
- [x] `images/bbox/toolbar.png` — 工具栏 + 红框「矩形」按钮 [auto]
- [x] `images/bbox/iou.png` — 双框 IoU 示意 [auto]
- [x] `images/bbox/bulk-edit.png` — 多选 + 批量改类别 [auto]
- [x] `images/polygon/vertex-edit.png` — 多边形选中态 + 边悬停 + 图标 [auto]
- [x] `images/polygon/close-hint.png` — 三顶点后第四点贴近闭合提示 [auto]
- [x] `images/keypoint/human-pose.png` — COCO 17 点人体姿态 + 骨架连线
- [x] `images/keypoint/hand.png` — 21 点手部骨架
- [x] `images/sam/subtoolbar.png` — SAM 子工具栏 [auto]
- [x] `images/sam/text-three-modes.png` — 文字提示三种模式 [auto]
- [ ] `images/3d-box/workbench-overview.png` — 3D 工作台全局（主视图 + 相机面板 + PSR 面板 + 自动贴合按钮组） [manual]
- [ ] `images/3d-box/psr-panel.png` — PSR 面板近景，标注红框：l/w/h 尺寸字段 [manual]
- [ ] `images/3d-box/autofit-buttons.png` — 贴合/收尺寸/贴地/朝向按钮组 [manual]
- [x] `images/workbench/layout-overview.png` — 四区布局全图（顶栏/左工具栏/画布/右抽屉） [auto]
- [ ] `images/workbench/task-status-labels.png` — 六种状态标签竖列
- [x] `images/mask-brush/toolbar-overview.png` — Mask 笔刷浮动工具栏全貌（笔刷/橡皮 chip + 半径 slider + 状态文字） [auto]
- [x] `images/mask-brush/draw-in-progress.gif` — Mask 笔刷涂抹填区 + Enter 提交全过程 `[auto-gif]`（flows/mask-draw，P-COCO8，提交转 polygon 落库）
- [ ] `images/pointcloud-crossframe/crossframe-propagate-toast.png` — 按 Alt+→ 跳帧自动选中新框 + toast [manual]
- [ ] `images/pointcloud-crossframe/overlay-k3-triview.png` — K=3 时主视图 + 三视图半透明虚线参考框 [manual]
- [ ] `images/workbench-pointcloud-projection/overlay-wireframe.png` — 相机面板线框投影 overlay + 「正对」角标 [manual]
- [ ] `images/workbench-pointcloud-projection/click-to-select-3d.png` — 点击投影框联动主视图高亮 [manual]
- [ ] `images/workbench-pointcloud-projection/camera-panel-layout.png` — 6 相机环绕布局全景 [manual]
- [ ] `images/workbench/pointcloud-controls-bar.png` — 控件浮条全景（重置/俯视/点大小滑杆/上色/深度/邻帧框叠加） [manual]
- [ ] `images/workbench/pointcloud-rgb-colorize.png` — 相机上色前后对比 [manual]
- [ ] `images/workbench/pointcloud-depth-heatmap.png` — 深度热力图 + figcaption 深度读数 [manual]
- [x] `images/polygon/draw-in-progress.gif` — 多边形逐点绘制全过程（落点 + 预览线，Enter 闭合提交）`[auto-gif]`（flows/polygon-draw，P-COCO8）
- [ ] `images/polygon/vertex-insert-alt.png` — 按住 Alt 悬停边上光标变「+」的瞬间
- [x] `images/polyline/draw-in-progress.gif` — 折线逐点绘制全过程（落点 + 预览线段，Enter 收尾）`[auto-gif]`（flows/polyline-draw，P-COCO8）
- [ ] `images/polyline/vertex-edit.png` — 折线选中态 Alt 插入/Shift 删除提示
- [x] `images/workbench/rotated-bbox.gif` — 拖框生成旋转框（angle=0）全过程 `[auto-gif]`（flows/rotated-bbox，P-COCO8；旋转手柄演示待补，盲拖坐标易空拖出第二框）
- [ ] `images/workbench/rotated-bbox-rotate.png` — 旋转约 30° 后状态 + 角度值
- [x] `images/sam/ai-tool-drawer.png` — AIToolDrawer 全图（后端下拉/极性切换/状态灯） [auto]
- [x] `images/sam/exemplar-output-mode.png` — 输出形态三选一 TabRow [auto]
- [x] `images/sam/ai-inspector-panel.png` — 悬浮 AI 面板（Prompt/阈值滑块/变体选择） [auto]
- [ ] `images/video-playback/sampling-config.png` — 项目设置帧采样配置区（mode/target_fps/frame_step） [manual]
- [ ] `images/video-playback/chapter-sidebar.png` — 章节侧栏含彩色色带 + 章节列表 [manual]
- [ ] `images/video-propagate/ai-propagate-dialog.png` — AI 传播对话框（方向/范围/模型/尺寸下拉） [manual]
- [ ] `images/video-propagate/tracker-job-badge.png` — 进度 badge + 取消按钮 [manual]
- [ ] `images/workbench/video-track-overview.png` — 视频工作台整体（时间轴 + 工具栏 B/T/V + 轨迹面板） [manual]
- [ ] `images/workbench/video-track-timeline.png` — 视频轨道时间轴 + 关键帧 + 软网格 [auto]
- [ ] `images/workbench/video-track-compose-dialog.png` — 跳连对话框两种 gap 模式 [manual]
- [ ] `images/workbench/video-track-qc-warnings.png` — 画布左上角质量提示浮层 [manual]

### 工作流
- [x] `images/workflows/ai-pre-project-detail-panel.png` — ProjectDetailPanel（批次勾选 + predict_mode 三 tab + 跑预标按钮） [auto]
- [x] `images/workflows/failed-prediction-recovery-jobs-list.png` — /ai-pre/jobs?status=failed 列表 [auto]
- [x] `images/workflows/project-wizard-type-select.png` — 向导类型选择（7 种项目类型卡） [auto]
- [ ] `images/workflows/batch-assign-dialog.png` — 批次分配对话框（标注员/审核员选择）

### Dev / 协议图

> 这些是开发文档里的架构图候选，建议用 mermaid 而非真截图（直接写入对应 .md 文件）。

- [x] `dev/reference/video-frame-service.md` § Chunk 状态机：补 ready/pending/failed 三态图，含 smart_copy / transcode 注释
- [x] `dev/reference/video-frame-service.md` § Tracker job 事件序列：补 sequenceDiagram，含 FE / API / worker / ML / Redis Pub-Sub 五道
- [x] `dev/reference/ws-protocol.md` § 6.2 事件序列：补 stateDiagram-v2 可视化 tracker 事件流
- [x] `dev/concepts/state-machines.md` § Task 状态机：已含 rejected 转移（旧版即已补，本轮核验确认）

## 新增图片时

1. 把图保存到 `docs-site/user-guide/images/<page>/<name>.png`
2. 在上表新增一行并勾选
3. 如果是可自动化的场景，在 `apps/web/e2e/screenshots/scenes.ts` 添加 scene，并标注 `[auto]`
4. `pnpm docs:build` 验证 dead-link 检查通过
