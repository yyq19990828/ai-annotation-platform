---
audience: [super_admin]
type: reference
since: v0.1.0
status: stable
last_reviewed: 2026-05-09
---

# 超级管理员手册

`super_admin` 角色专属的平台级运维与跨项目管理功能。本章节只覆盖**超管独有**或**超管视角额外能力**，标注员/项目管理员通用能力请见对应章节。

## 入口

- Sidebar 顶部出现两条独立入口：**平台概览** + **项目总览**（v0.9.9 B-3 拆分）
- `/dashboard?view=projects` — 用项目管理员视图查看所有项目
- `/model-market` — ML 模型市场（v0.9.3 合并 `/ml-integrations` + `/failed-predictions`）
- `/bugs` — BUG 反馈管理，支持状态流转、Markdown 描述/评论和多张截图附件

## 核心职责

| 任务 | 文档 |
|---|---|
| 注册 / 维护 ML Backend | [ML Backend 注册](./ml-backend-registry) |
| 跨项目管理 AI 模型 | [模型市场](./model-market) |
| 排查失败预标 | [失败预测排查](./failed-predictions) |
| 管理 BUG 反馈 | `/bugs` |
| 审计与合规 | [审计日志](./audit-logs) |
| 系统监控 | [系统监控](./system-monitoring) |

## 与项目管理员的边界

| 能力 | project_admin | super_admin |
|---|---|---|
| 创建项目 | ✅（自己的） | ✅（任何） |
| 注册 ML Backend | ✅（项目内） | ✅ + 全局 |
| 删除 ML Backend | ❌ | ✅ |
| 跨项目模型市场 | ❌ | ✅ |
| 平台概览 dashboard | ❌ | ✅ |
| 审计日志查看 | ❌ | ✅ |
