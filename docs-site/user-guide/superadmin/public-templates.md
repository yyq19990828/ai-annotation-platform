---
audience: [super_admin]
type: how-to
since: v0.10.14
status: stable
last_reviewed: 2026-05-18
---

# 公共模板治理

> 适用角色：超级管理员

v0.10.14 起平台支持「公共模板」（`scope=public`）—— 全平台可见可用、不受组织边界限制。
本页给治理公共模板的实践要点。

## 谁能创建

**仅超级管理员**。非超管在模板编辑界面选 `scope=public` 会被禁用 / 后端返 403。

> 设计意图：公共模板是平台层面的"官方背书"，需要超管把关 schema 一致性、命名规范、合规性，避免出现"野生公共模板"污染列表。

## 推荐流程

1. 项目管理员先在自己组织内打磨模板（`scope=private` → 灰度试用 → 推到 `scope=organization`）。
2. 跑通后将模板 ID / 用例报给超管，超管 PATCH `scope=public`。
3. 命名建议：用 `[场景]-[版本号]` 风格，例如 `自动驾驶-车辆检测-v2`。

## 公共模板的可编辑性

- 任何超级管理员都可以编辑 / 删除任意公共模板。
- 非超管只能"克隆"公共模板为私有副本，再自由修改。

## 删除公共模板

- 弹确认但不阻拦。
- 已基于该模板创建的项目不受影响（字段已 deepcopy）。
- 删除前如有重大使用量（如 `usage_count > 50`），建议先在群里告知一声，避免破坏团队习惯。

## 与 ML backend / model-market 的关系

公共模板可以预填 `ai_enabled` + `ai_model` display hint，但**不绑定具体 ml_backend_id**
（ml_backend 是项目级实体，跨项目 / 跨组织共享 backend row 没意义）。应用模板创建项目时，
新项目需自行注册 / 复用 ml_backend。
