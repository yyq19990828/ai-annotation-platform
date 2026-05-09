# 用户手册

面向标注员、审核员、项目管理员、超级管理员的使用文档。

**不确定从哪里开始？** 按你的角色选择入口：

## 按角色入口

### 🖊️ 标注员

接收任务、在工作台完成标注并提交。

- [快速开始](./getting-started) — 第一次登录怎么做
- [工作台概览](./workbench/) — 界面布局与基本操作
- [Bbox 标注](./workbench/bbox) · [Polygon 标注](./workbench/polygon) · [关键点标注](./workbench/keypoint)
- [SAM 智能工具](./workbench/sam-tool) — AI 辅助勾边

### 📋 项目管理员

创建项目、上传数据、分配任务给标注员，跟进进度。

- [项目管理](./projects/) — 创建项目、配置标注类型
- [批次与分配](./projects/batch) — 切批次、分配给标注员
- [AI 预标注](./projects/ai-preannotate) — 让模型先跑一遍

### ✅ 审核员

检查标注质量，通过或回退给标注员修正。

- [审核流程](./review/) — 审核工作台使用说明

### 🛡️ 超级管理员

管理用户、注册 ML Backend、查看系统状态。

- [超管概览](./superadmin/) — 权限与入口
- [ML Backend 注册](./superadmin/ml-backend-registry)
- [模型市场](./superadmin/model-market)
- [审计日志](./superadmin/audit-logs) · [系统监控](./superadmin/system-monitoring)

---

## 按任务入口

| 我想做的事 | 去哪里 |
|---|---|
| 第一次进入平台 | [快速开始](./getting-started) |
| 理解「任务 / 批次 / 标注」这些词的含义 | [平台概念与术语](./concepts) |
| 看快捷键列表 | [工作台概览 → 快捷键](./workbench/) |
| 导出标注数据 | [数据导出格式](./export/) |
| 提交 BUG 或问题 | 应用右下角「BUG 反馈」按钮 |
| 常见问题 | [FAQ](./faq) |
