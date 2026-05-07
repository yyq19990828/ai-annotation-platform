# 截图回填清单（0.8.1 候选 → v0.8.7 自动化）

> 这张表汇总了 v0.8.0 用户手册中所有 `<!-- TODO(0.8.1) IMAGE_CHECKLIST: ... -->` 占位项。补图时勾选并删除对应注释。
>
> 这个文件**不上侧边栏**（VitePress sidebar 不引用），仅作为 maintainer 的工作清单。
>
> **v0.8.7 自动化**：14 张可由 `pnpm --filter web screenshots` 自动生成（脚本：`apps/web/e2e/screenshots/`），输出到下面对应路径。流程：
>
> 1. 启动 docker / api / dev 三件套（同 `pnpm test:e2e`）
> 2. `pnpm --filter web screenshots`
> 3. `git diff docs-site/user-guide/images/` 人眼审阅
> 4. 满意即 commit；不满意可在 `apps/web/e2e/screenshots/scenes.ts` 调 `prepare` 钩子（高亮元素 / 切 tab / 打开 modal 等）后再跑
>
> keypoint 两张（human-pose / hand）暂跳过——非 image-det 工作台尚未实装，等后续版本接入时补。其他自动化产出仍可能因 UI 状态欠完整需 maintainer 手工覆盖（如 `bbox/iou.png` 需双框重叠、`export/progress.png` 需真实 50% 进度条），脚本只截基线。

## 拍摄约定

- **分辨率**：1920×1080（页面级）/ 1280×720（GIF 录屏）
- **格式**：截图 PNG 优先，GIF 用于流程录屏
- **浏览器**：Chrome / Edge，关闭账号头像 / 时间 / 通知数等会随时变化的元素
- **数据脱敏**：邮箱用 `demo@example.com`、姓名用 `张三 / 李四 / 王五`、项目名 `演示项目-A`；不出现真实客户/同事姓名
- **标注红框**：需要引导读者注意的位置用红框（推荐 #FF3333，2px）；红框 > 文字箭头
- **暗色 / 浅色**：统一浅色主题（v0.6.x 起平台支持暗色，但截图主基线用浅色）
- **保存路径**：每张图按 `docs-site/user-guide/images/<page>/<name>.png` 组织。markdown 中的引用路径：根目录文件（如 `getting-started.md`）用 `./images/<page>/<name>.png`；子目录文件（如 `workbench/bbox.md`、`projects/index.md`、`review/index.md`、`export/index.md`）用 `../images/<page>/<name>.png`

## 待补清单

> 完成一张就把对应行 ✅ 并 commit。

### Getting Started

- [ ] `images/getting-started/login.png` — 登录页全屏；红框：邮箱输入、密码输入、登录按钮、「忘记密码」链接
- [ ] `images/getting-started/forgot-password.png` — 忘记密码页 + 输入邮箱后的成功 toast
- [ ] `images/getting-started/e2e.gif` — 30-60s 录屏：登录 → Dashboard → 打开项目 → 标 1 个 bbox → 提交 → 看到下一题。1280×720

### Workbench / Bbox

- [ ] `images/bbox/toolbar.png` — 工具栏全图 + 红框「矩形」按钮 + hotkey 提示
- [ ] `images/bbox/iou.png` — 一张图上叠两个 bbox（基准绿框 + 标注员蓝框），含 IoU 计算示意 + 0.5 / 0.7 / 0.9 三档对照
- [ ] `images/bbox/bulk-edit.png` — 多选 3-5 个 bbox（Shift+click）+ 右侧属性面板批量改类别状态

### Workbench / Polygon

- [ ] `images/polygon/vertex-edit.png` — 多边形选中态，鼠标悬停在边上出现 + 图标
- [ ] `images/polygon/close-hint.png` — 三顶点已落，第四点贴近第一点出现「单击闭合」提示

### Workbench / Keypoint

- [ ] `images/keypoint/human-pose.png` — COCO 17 点人体姿态标注；点 + 骨架连线
- [ ] `images/keypoint/hand.png` — 21 点手部骨架标注

### Projects

- [ ] `images/projects/create-entry.png` — ProjectsPage「新建项目」按钮高亮
- [ ] `images/projects/wizard-steps.png` — 6 步 wizard 各步关键截图（基本信息 / 类型 / 类别 schema / 属性 schema / AI 模型 / 审核策略），可拼成一张长图

### Review

- [ ] `images/review/workbench.png` — 审核界面三栏全图 + 右侧操作面板的「通过/退回/修改后通过」按钮
- [ ] `images/review/reject-form.png` — 「退回」弹出的备注表单，含原因下拉 + 富文本备注框

### Export

- [ ] `images/export/format-select.png` — 导出对话框，4 个格式选项 + 当前选中 + 导出范围切换
- [ ] `images/export/progress.png` — 进度条 + 完成后的下载链接 toast

## 完成动作

每补一张图：
1. 把图保存到对应路径
2. 删除文档里对应的 `<!-- TODO(0.8.1) IMAGE_CHECKLIST: ... -->` 注释
3. 把本文件勾选为 ✅
4. `pnpm docs:build` 验证 dead-link 检查通过
