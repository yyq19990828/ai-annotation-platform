---
audience: [dev]
type: reference
since: v0.1.0
status: stable
last_reviewed: 2026-05-27
---

# 项目

## 创建项目

```http
POST /api/v1/projects
{
  "name": "<unique>",
  "description": "...",
  "data_type": "image",
  "tool_bindings": {
    "bbox": {
      "enabled": true,
      "classes": [{ "name": "dog", "color": "#ff0000", "aliases": ["puppy"] }],
      "attribute_schema": { "fields": [] }
    }
  },
  "ai_enabled": false,
  "ml_backend_source_id": null
}
```

`tool_bindings` 是类别与属性的存储真值。`classes_config` / `attribute_schema` 仍会在响应中作为兼容视图派生出来，但新代码应优先写 `tool_bindings`。aliases 用于 AI 预标的 prompt 召回（DINO 对自然语言敏感）。

`ml_backend_source_id` 指向全局注册表里的一个 backend：新建项目时填它即为新项目**启用**该全局注册项（**引用同一全局 id，不复制**），并把它设为项目主后端。留空则新项目不预先启用任何 backend。

## 配置

```http
PATCH /api/v1/projects/:id
```

支持字段（部分更新）：

- `name` / `description`
- `tool_bindings`（整体替换）
- `classes_config` / `attribute_schema`（兼容输入，会被归并到对应工具单位）
- `ai_enabled` / `ml_backend_id`
- `review_required`
- `annotation_guide` / `video_sampling` / `rendering_config`

类别**重命名**走专用端点（原子迁移 annotations）：

```http
POST /api/v1/projects/:id/classes/rename
{ "old_name": "dog", "new_name": "canine" }
```

直接 PATCH `classes_config` 改名会让历史 annotation 的 `class_name` 失联。

删除类别 / 属性定义不会删除已有标注；旧 `class_name` 或属性 key 会按当前配置实时判定为孤儿。提供两个治理端点：

```http
GET /api/v1/projects/:id/class-usage
POST /api/v1/projects/:id/cleanup-orphans
```

- `class-usage` 返回 `{ classes: {name: count}, attributes: {key: count} }`，用于删除确认。
- `cleanup-orphans` 默认 `dry_run=true`，返回 `{ orphan_annotations, orphan_attribute_keys }`；`dry_run=false` 时软删孤儿类别标注，并移除有效类别标注中不在当前 attribute schema 内的用户属性 key。

## 成员管理

```http
POST   /api/v1/projects/:id/members        # 加成员
DELETE /api/v1/projects/:id/members/:uid   # 移除
PATCH  /api/v1/projects/:id/members/:uid   # 改角色
```

角色：`viewer` / `annotator` / `reviewer` / `project_admin`。

## Task Views / Data Manager

```http
GET    /api/v1/projects/:id/task-views
POST   /api/v1/projects/:id/task-views
GET    /api/v1/projects/:id/task-views/:view_id
PATCH  /api/v1/projects/:id/task-views/:view_id
DELETE /api/v1/projects/:id/task-views/:view_id
POST   /api/v1/projects/:id/task-views/:view_id/copy

POST   /api/v1/projects/:id/tasks/query
GET    /api/v1/projects/:id/task-views/:view_id/tasks
GET    /api/v1/projects/:id/data-manager/schema?entity_scope=objects
POST   /api/v1/projects/:id/data-manager/objects/query
GET    /api/v1/projects/:id/data-manager/objects/:annotation_id/detail
GET    /api/v1/projects/:id/data-manager/objects/:annotation_id/location
POST   /api/v1/projects/:id/data-manager/tracks/query
GET    /api/v1/projects/:id/data-manager/tracks/:track_ref/detail
```

`task-views` 保存项目内 Data Manager 视图，包含 `entity_scope`（`tasks | objects | tracks`）、`filter_json`、`sort_json`、`columns_json` 和 `visibility`。不同 scope 的名称和字段白名单相互隔离。`private` 视图只有创建者可见；`project` 视图对项目成员可见，但只有项目负责人或超级管理员可编辑。

`tasks/query` 接受临时过滤条件，不保存视图：

```json
{
  "filter_json": {
    "op": "and",
    "rules": [
      { "field": "feedback.unresolved_count", "op": "gt", "value": 0 },
      { "field": "prediction.model_version", "op": "eq", "value": "sam3-v1" }
    ]
  },
  "sort_json": [{ "field": "last_activity_at", "direction": "desc" }],
  "columns_json": ["display_id", "status", "unresolved_feedback_count"],
  "limit": 50,
  "offset": 0
}
```

对象查询使用 annotation grain 的 keyset cursor；轨迹查询按 compact annotation 或 Scene 共享 track ID 的逻辑 grain 返回。两者的 total、facet、详情和定位都先与当前用户的 visible-task scope 连接，不返回 raw geometry。过滤字段是白名单，未知字段或不允许的操作符返回 422。Data Manager 查询只读，不提供批量写操作。

## Alias 频率

```http
GET /api/v1/admin/projects/:id/alias-frequency
```

返回每个 alias 在该项目历史 prediction 中的出现次数，前端 chip 按 desc 排序。

## 列出 / 详情

```http
GET /api/v1/projects                       # 当前用户可见
GET /api/v1/projects/:id
GET /api/v1/dashboard?view=projects        # 超管看全部
```

## 归档 / 删除

归档：`PATCH /projects/:id` 设 `status='archived'`。归档项目对标注员不可见但数据保留。

物理删除仅 super_admin，且需要先移除所有 task。

## 相关

- [批次与任务](./tasks-and-annotations)
- [ML Backend](./ml-backend)
