---
audience: [super_admin]
type: reference
since: v0.9.0
status: stable
last_reviewed: 2026-05-09
---

# 模型市场（/model-market）

v0.9.3-phase2 把分散的 `/ml-integrations` 与 `/failed-predictions` 两个超管页合并成统一的 **模型市场**。

## 目的

跨项目纵览所有 ML Backend 与最近的预测健康度。从这里可以一站式：

- 看哪些 backend 在线 / 不可达
- 看每个 backend 最近 N 次推理的成功/失败率
- 跳转到具体失败 case 排查
- 全局新增 / 编辑 backend

## 主要 Tab

### 1. Integrations（集成）

列所有项目的 ML Backend 表，列：

| 列 | 说明 |
|---|---|
| 名称 / 类型 | — |
| URL | 点击可复制；红/绿色徽章表示健康 |
| 所属项目 | 一个 backend 若被多项目复用，列每个项目 |
| 最近 24h 调用 | 调用次数 + 成功率 |
| 操作 | 编辑 / 删除 |

### 2. Failed Predictions（失败预测）

`prediction_jobs` 表中 `status='failed'` 的记录，按 `finished_at desc` 排：

- 列 backend 名 / 项目名 / 触发时间 / 错误片段
- 点击展开看完整 error trace
- 可一键「查看 job 详情」跳到 `/ai-pre/jobs?job_id=X`
- v0.9.9 B-2 起这个 tab 也在项目侧 `/ai-pre` 出现，方便项目管理员自查（不再是超管独占）

### 3. Health Overview

可观测性概览（最近 24h）：

- 各 backend 的调用次数 / P95 延迟 / 错误率
- grounded-sam2-backend 还会显示 embedding 缓存命中率（v0.9.1 LRU）
- Prometheus 指标见 [可观测性](../../dev/monitoring)

## 新建 / 编辑 Backend

按钮「新建 ML Backend」弹表单，与 [ML Backend 注册](./ml-backend-registry) 等价。差别在这里创建的 backend 默认 `project_id=NULL`（全局可选），项目设置 wizard 复制时才落到具体项目。

## 删除

超管在此处可批量删除孤立 backend（无项目引用的）。有引用的需要先在项目侧解绑。

## 路由历史

| 旧路由 | 新路由 |
|---|---|
| `/ml-integrations` | `/model-market`（Integrations tab） |
| `/failed-predictions` | `/model-market`（Failed Predictions tab） |

旧路由已 301 重定向到新地址。
