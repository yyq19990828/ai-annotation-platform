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

## 新增图片时

1. 把图保存到 `docs-site/user-guide/images/<page>/<name>.png`
2. 在上表新增一行并勾选
3. 如果是可自动化的场景，在 `apps/web/e2e/screenshots/scenes.ts` 添加 scene，并标注 `[auto]`
4. `pnpm docs:build` 验证 dead-link 检查通过
