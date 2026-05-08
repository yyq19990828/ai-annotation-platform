# 项目

## 创建项目

```http
POST /api/v1/projects
{
  "name": "<unique>",
  "description": "...",
  "classes_config": [{ "name": "dog", "color": "#ff0000", "aliases": ["puppy"] }],
  "ai_enabled": false,
  "ml_backend_source_id": null   // v0.9.7 复用其它项目 backend
}
```

`classes_config` 是核心字段——后续 task 的 `class_name` 必须在这里。aliases 用于 AI 预标的 prompt 召回（DINO 对自然语言敏感）。

## 配置

```http
PATCH /api/v1/projects/:id
```

支持字段（部分更新）：

- `name` / `description`
- `classes_config`（整体替换）
- `ai_enabled` / `ml_backend_id`
- `attribute_schema`（属性配置）
- `review_required`

类别**重命名**走专用端点（v0.9.10 B-13，原子 + 迁移 annotations）：

```http
POST /api/v1/projects/:id/classes/rename
{ "old_name": "dog", "new_name": "canine" }
```

直接 PATCH `classes_config` 改名会让历史 annotation 的 `class_name` 失联。

## 成员管理

```http
POST   /api/v1/projects/:id/members        # 加成员
DELETE /api/v1/projects/:id/members/:uid   # 移除
PATCH  /api/v1/projects/:id/members/:uid   # 改角色
```

角色：`viewer` / `annotator` / `reviewer` / `project_admin`。

## Alias 频率（v0.9.6）

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
