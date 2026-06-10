# 用户手册

面向标注员、审核员、项目管理员、超级管理员、观察者的使用文档。

**不确定从哪里开始？** 按你的角色选择入口：

## 按角色入口

<!-- TODO(v0.14.18) IMAGE_CHECKLIST: images/getting-started/role-dashboard-overview.png — 四种角色 Dashboard 拼图 [auto] -->

### 🖊️ 标注员

接收任务、在工作台完成标注并提交。

- [快速开始](./getting-started) — 第一次登录怎么做
- [工作台概览](./workbench/) — 界面布局与基本操作
- [Bbox 标注](./workbench/bbox) · [Polygon 标注](./workbench/polygon) · [关键点标注](./workbench/keypoint)
- [SAM 智能工具](./workbench/sam-tool) — AI 辅助勾边
- [视频追踪标注](./workbench/video-track) · [3D 点云标注](./workbench/pointcloud-view)

### 📋 项目管理员

创建项目、上传数据、分配任务给标注员，跟进进度。

- [项目管理](./projects/) — 创建项目、配置标注类型
- [批次与分配](./projects/batch) — 切批次、分配给标注员
- [AI 预标注](./projects/ai-preannotate) — 让模型先跑一遍
- [数据集管理](./datasets/) · [工作流配置](./workflows/new-project-end-to-end)

### ✅ 审核员（质检员）

检查标注质量，通过或回退给标注员修正。

- [审核流程](./review/) — 审核工作台使用说明

### 🛡️ 超级管理员

管理用户、注册 ML Backend、查看系统状态。

- [超管概览](./superadmin/) — 权限与入口
- [用户与权限](./superadmin/user-management) · [BUG 反馈管理](./superadmin/bug-management)
- [ML Backend 注册](./superadmin/ml-backend-registry) · [模型市场](./superadmin/model-market)
- [审计日志](./superadmin/audit-logs) · [系统监控](./superadmin/system-monitoring)

### 👁️ 观察者（Viewer）

仅可查看平台公开内容，无法操作任务或项目。通过开放注册自助注册的账号默认为此角色，需由超管或项目管理员升级权限后方可参与标注工作。

---

## 按任务入口

<!-- TODO(v0.14.18) IMAGE_CHECKLIST: images/getting-started/platform-nav-overview.png — 平台主界面侧边栏各分区 [auto] -->

| 我想做的事 | 去哪里 |
|---|---|
| 第一次进入平台 | [快速开始](./getting-started) |
| 理解「任务 / 批次 / 标注」这些词的含义 | [平台概念与术语](./concepts) |
| 看快捷键列表 | [工作台概览 → 快捷键](./workbench/) |
| 导入数据 | [导入图像数据集](./datasets/import-images) · [数据集总览](./datasets/) |
| 配置存储连接器 | [存储连接器导入](./datasets/storage-connections) |
| 视频 / 点云标注 | [视频追踪标注](./workbench/video-track) · [3D 点云标注](./workbench/pointcloud-view) |
| 端到端创建项目 | [新项目端到端流程](./workflows/new-project-end-to-end) |
| 导出标注数据 | [数据导出格式](./reference/export-formats) |
| 修改密码 / 通知偏好 / 标注偏好 | [设置页](./reference/settings) |
| 提交 BUG 或问题 | 应用右下角「BUG 反馈」按钮 |
| 常见问题 | [FAQ](./faq) |
