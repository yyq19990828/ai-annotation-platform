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

## 任务生成

项目创建后，每条上传的数据会自动生成一个任务，状态为 `pending`，等待分配。

## 常见问题

**类别如何后续修改？**
进入项目设置页可追加类别；删除已用类别会要求确认（已用过的标注会保留旧类名）。

**能否中途切换 AI 模型？**
可以，但已生成的预标注不会重跑，需手动触发「重新预标注」。
