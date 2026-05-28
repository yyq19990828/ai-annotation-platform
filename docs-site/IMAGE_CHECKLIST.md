# 截图清单（用户手册）

> 这个文件**不上侧边栏**，仅作为 maintainer 的工作清单。
>
> 标 `[auto]` 的图由 `pnpm --filter web screenshots` 自动生成（脚本：`apps/web/e2e/screenshots/`），输出到 `docs-site/user-guide/images/`。
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

## 图片清单

### Getting Started

- [x] `images/getting-started/login.png` — 登录页全屏 `[auto]`
- [x] `images/getting-started/forgot-password.png` — 忘记密码页 + 成功 toast `[auto]`
- [x] `images/getting-started/e2e.gif` — 30-60s 录屏：登录 → 打开项目 → 标 bbox → 提交

### Workbench / Bbox

- [x] `images/bbox/toolbar.png` — 工具栏 + 红框「矩形」按钮 `[auto]`
- [x] `images/bbox/iou.png` — 双框 IoU 示意 `[auto]`
- [x] `images/bbox/bulk-edit.png` — 多选 + 批量改类别 `[auto]`

### Workbench / Polygon

- [x] `images/polygon/vertex-edit.png` — 多边形选中态 + 边悬停 + 图标 `[auto]`
- [x] `images/polygon/close-hint.png` — 三顶点后第四点贴近闭合提示 `[auto]`

### Workbench / Keypoint

- [x] `images/keypoint/human-pose.png` — COCO 17 点人体姿态 + 骨架连线
- [x] `images/keypoint/hand.png` — 21 点手部骨架

### Workbench / SAM

- [x] `images/sam/subtoolbar.png` — SAM 子工具栏 `[auto]`
- [x] `images/sam/text-three-modes.png` — 文字提示三种模式 `[auto]`

### Projects

- [x] `images/projects/create-entry.png` — 「新建项目」按钮高亮 `[auto]`
- [x] `images/projects/wizard-steps.png` — 6 步 wizard 关键截图 `[auto]`
- [x] `images/projects/wizard-step4-backend.png` — wizard 第 4 步 ML Backend 配置 `[auto]`
- [x] `images/projects/empty-state.png` — 项目列表空状态 `[auto]`
- [x] `images/projects/error-state.png` — 项目列表错误状态 `[auto]`
- [x] `images/projects/ai-pre-stepper.png` — AI 预标注步骤条 `[auto]`
- [x] `images/projects/ai-pre-history-search.png` — 预标注历史搜索 `[auto]`
- [x] `images/projects/ai-pre-empty-alias.png` — 预标注 alias 为空提示 `[auto]`

### Review

- [x] `images/review/workbench.png` — 审核三栏全图 + 操作面板 `[auto]`
- [x] `images/review/reject-form.png` — 退回备注表单 `[auto]`

### Export

- [x] `images/export/format-select.png` — 导出对话框 + 格式选项 `[auto]`
- [x] `images/export/progress.png` — 进度条 + 下载链接 toast `[auto]`

### Superadmin / BUG 反馈管理（新增于 2026-05-29 审计）

- [ ] `images/superadmin/bugs/list.png` — `/bugs` 列表全图，含状态/严重度筛选 + 重开徽标 `↻N`
- [ ] `images/superadmin/bugs/detail-panel.png` — 详情面板：元信息行、Markdown 描述、截图附件、状态切换按钮
- [ ] `images/superadmin/bugs/status-transitions.png` — 状态切换按钮高亮 + 关闭后再重开的 reopen 徽标

### Superadmin / 用户与权限（新增于 2026-05-29）

- [ ] `images/superadmin/users/list.png` — `/users` 卡片列表 + 顶部 4 张统计卡 + 角色徽标颜色
- [ ] `images/superadmin/users/invite-modal.png` — 邀请用户对话框
- [ ] `images/superadmin/users/edit-modal.png` — 编辑用户对话框（角色选择 + 停用按钮）
- [ ] `images/superadmin/users/permission-matrix.png` — 权限矩阵预览（PERMISSION_GROUPS × ROLE_PERMISSIONS）
- [ ] `images/superadmin/users/groups-tab.png` — 用户组 tab，演示组创建与成员添加
- [ ] `images/superadmin/users/api-keys.png` — API Keys 对话框（明文一次显示）

### Settings 页（新增于 2026-05-29）

- [ ] `images/settings/profile.png` — 设置 / 个人资料 区
- [ ] `images/settings/workbench-prefs.png` — 标注偏好（自动保存周期 + 颜色策略）
- [ ] `images/settings/notification-prefs.png` — 通知偏好的 in-app / email 开关矩阵
- [ ] `images/settings/system-smtp.png` — 系统设置 / SMTP 配置 + 发送测试邮件按钮（仅 super_admin）
- [ ] `images/settings/my-feedback.png` — 我的反馈：用户视角看自己提交的 BUG 工单与状态

### Workbench 截图（待补真实截图，目前部分仅 ASCII 图）

- [ ] `images/workbench/layout-overview.png` — 工作台四区布局真实截图（顶栏 / 左工具栏 / 画布 / 右侧抽屉）
- [ ] `images/workbench/video-track-timeline.png` — 视频轨道时间轴 + 关键帧 + 软网格 `[auto]`
- [ ] `images/workbench/mask-brush-overlay.png` — Mask brush 工具半透明涂抹 + Tab 切换刷子/橡皮

### ML Backend / Model Market（新增于 2026-05-29）

- [ ] `images/superadmin/ml-backend/register-form.png` — 注册 ML Backend 表单（URL/auth/capability）
- [ ] `images/superadmin/ml-backend/health-card.png` — 实时 `/health` 卡片（GPU / video_pool meta）
- [ ] `images/superadmin/model-market/list.png` — 模型市场 3 个 tab 全图
- [ ] `images/superadmin/model-market/video-pool.png` — `_video_pool` 视频模态独立池 UI

### Dev / 协议图（新增于 2026-05-29 — 替换文字为时序图）

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
