---
audience: [project_admin]
type: how-to
since: v0.1.0
status: stable
last_reviewed: 2026-05-11
---

# 创建项目

> 适用角色：项目管理员 / 超级管理员

![创建项目入口](../images/projects/create-entry.png)
<!-- TODO(0.8.1) IMAGE_CHECKLIST: ProjectsPage「新建项目」按钮高亮。 -->

## 步骤

1. 顶部菜单 → 「项目管理」 → 「新建项目」
2. 填写基本信息：
   - **项目名**
   - **类型**：bbox / polygon / keypoint / classification / OCR
   - **类别 schema**（JSONB）：例如 `["person", "car", "bicycle"]`
   - **AI 模型**（可选）：选择预标注模型
3. 上传初始数据集（zip / 图片直传 / OSS 路径）
4. 设置标注规范文档（Markdown，标注员在工作台可见）
5. 配置审核策略：
   - **单审**：1 名审核员通过即可
   - **双审**：2 名审核员一致才通过
   - **采样审核**：随机抽 N% 审核

![向导步骤](../images/projects/wizard-steps.png)
<!-- TODO(0.8.1) IMAGE_CHECKLIST: 6 步 wizard 各步关键截图（基本信息 / 类型 / 类别 schema / 属性 schema / AI 模型 / 审核策略），可拼成一张长图。 -->

## 标注指引（v0.10.13+）

为项目编写 Markdown 形式的标注指引，工作台首次打开会自动展开浮层让标注员阅读。详见
[标注指引（Annotation Guide）](./annotation-guide.md)。

## 从已有项目复制配置（v0.10.11+）

如果新项目的 classes / 属性 schema / AI 模型 / 渲染配置等与既有项目相同（或大致相同），可以直接复制配置：

1. 在 Dashboard 找到要复制的项目卡片 → 右下角 `⋮` → 「复制项目配置」。
2. 自动跳到 Wizard，顶部出现 banner「已用源项目配置预填表单」；新项目名默认为 `{源项目名} (副本)`。
3. 7 步流程正常往下走，任何字段都可以在某步覆盖（你的修改优先于源配置）。
4. 提交后新项目就绪。**只复制配置**：classes / classes_config / attribute_schema / AI 配置 / label_config / rendering_config / 阈值 / 采样规则等。**不复制运行时数据**：datasets / tasks / annotations / members / batches。

> 需要跨项目共享 / 跨组织共享 / 模板版本管理？v0.10.14 起补上「项目模板库」独立资产形态，
> 详见 [项目模板库（Project Templates）](./project-templates.md)。

v0.10.13 起在 banner 中新增 checkbox **「同时复制标注指引」**（默认勾选）：复制配置时连
带源项目的 Markdown 指引与图片资源带过来。图片资源 storage key 与源项目共享，源项目删除资源会影响
新项目；如需独立资源在新项目设置页里重新拖入图片即可。

## 任务生成

项目创建或数据集关联后，每条数据会自动生成一个任务，状态为 `pending`，等待分配。

如果数据集已经关联到项目，后续在数据集页继续上传文件、上传 ZIP 或执行「扫描导入」，新增文件也会同步生成项目任务；无需先取消关联再重新关联。

## 常见问题

**类别如何后续修改？**
进入项目设置页可追加类别；删除已用类别会要求确认（已用过的标注会保留旧类名）。

**能否中途切换 AI 模型？**
可以，但已生成的预标注不会重跑，需手动触发「重新预标注」。
