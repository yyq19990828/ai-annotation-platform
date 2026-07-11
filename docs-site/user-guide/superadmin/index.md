---
audience: [super_admin]
type: reference
since: v0.1.0
status: stable
last_reviewed: 2026-07-11
---

# 超级管理员手册

`super_admin` 角色专属的平台级运维与跨项目管理功能。本章节只覆盖**超管独有**或**超管视角额外能力**，标注员/项目管理员通用能力请见对应章节。

## 入口

- Sidebar 顶部出现两条独立入口：**平台概览** + **项目管理**
- `/overview` — 查看全局平台运行状态与资源分布
- `/dashboard` — 管理平台全部项目、负责人、批次分派与导出入口
- `/model-market` — ML 模型市场，集中管理 ML Backend 与失败预测
- `/bugs` — BUG 反馈管理，支持状态流转、Markdown 描述/评论和多张截图附件

## 核心职责

| 任务 | 文档 |
|---|---|
| 用户与权限管理 | [用户与权限](./user-management) |
| 注册 / 维护 ML Backend | [ML Backend 注册](./ml-backend-registry) |
| 跨项目管理 AI 模型 | [模型市场](./model-market) |
| 排查失败预标 | [失败预测排查](./failed-predictions) |
| 管理 BUG 反馈 | [BUG 反馈管理](./bug-management) |
| 治理公共模板 | [公共模板治理](./public-templates) |
| 审计与合规 | [审计日志](./audit-logs) |
| 系统监控 | [系统监控](./system-monitoring) |

项目级 AI 操作（启用 backend、运行预标、审阅候选）统一从[AI 辅助标注](../ai/)进入；本章只保留超管独有的注册、运行时观测和跨项目排障入口。

## 与项目管理员的边界

| 能力 | project_admin | super_admin |
|---|---|---|
| 创建项目 | ✅（自己的） | ✅（任何） |
| 启用 / 停用项目 ML Backend | ✅（自己项目中已注册的 backend） | ✅（任意项目） |
| 注册 / 编辑 / 删除全局 ML Backend | ❌ | ✅ |
| 模型市场页面 | ✅（可访问） | ✅ |
| 全局 ML 观测 / Smoke Test | ❌ | ✅ |
| 平台概览 dashboard | ❌ | ✅ |
| 审计日志查看（前端入口） | ❌ | ✅ |
| BUG 反馈列表（`/bugs`） | ✅ | ✅ |
