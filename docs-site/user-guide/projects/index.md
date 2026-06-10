---
audience: [project_admin]
type: how-to
since: v0.1.0
status: stable
last_reviewed: 2026-06-10
---

# 创建项目

> 适用角色：项目管理员 / 超级管理员

![创建项目入口](../images/projects/create-entry.png)
<!-- TODO(0.8.1) IMAGE_CHECKLIST: ProjectsPage「新建项目」按钮高亮。 -->

## 步骤

向导共 6 步（类型 → 类别 → 属性 → AI 接入 → 数据 → 成员），提交后项目即创建完成。

1. 顶部菜单 → 「项目管理」 → 「新建项目」
2. **Step 1 类型**：填写基本信息：
   - **项目名**
   - **数据类型**：图片 / 视频 / 3D 点云（三选一）
   - **工具集**：勾选本项目要用的工具单位
     - **矩形框 (bbox)**：拖框圈选,基础几何
     - **区域 (polygon + mask)** ⭐ 打包：实例分割,多边形与笔刷掩码一起启用
     - **AI 交互** ⭐ 打包：SAM 点 / 框 / 文本 / 示例 + Magic Box 一起启用
     - **折线 (polyline)** / **旋转框 (rotated_bbox)** / **关键点 (keypoint)**：图片项目可用的新几何工具
     - **3D 立体框 (lidar_box_3d)**：3D 点云项目可启用，对应 Three.js 工作台支持 3D 框绘制 / 选中 / 编辑（PSR + 朝向）与相机投影联动
   - **scene 模式**（图片 / 3D 点云项目可选）
3. **Step 2 类别**：每个启用的工具单位独立编辑类别（详见 [工具维度类别 / 属性](./tool-units.md)）
4. **Step 3 属性**：每个启用的工具单位独立编辑属性 schema
5. **Step 4 AI 接入**（可选）：启用 AI 预标注，并可复用其它项目已注册的 ML Backend
6. **Step 5 数据**：上传初始数据集（多文件 / ZIP / 数据源连接器，详见 [图像数据集导入](../datasets/import-images.md) 与 [存储连接器导入](../datasets/storage-connections.md)）
7. **Step 6 成员**：邀请标注员 / 审核员加入项目

> **标注规范文档与审核策略**不在向导内配置，需创建后进入 **项目设置页** 分别在「标注指引」与「采样 / 审核」区块配置。

## 工具维度类别 / 属性

类别与属性 schema 按**工具单位**强隔离绑定（每个工具单位独立持有自己的类别列表与属性 schema，可同名不同色），并涉及「遮挡样式」「视频单帧 / 轨迹框」等配置开关。完整说明、典型场景与后续修改方式见 [工具维度类别 / 属性](./tool-units.md)。

![向导步骤](../images/projects/wizard-steps.png)
<!-- TODO(0.8.1) IMAGE_CHECKLIST: 6 步 wizard 各步关键截图（类型 / 类别 / 属性 / AI 接入 / 数据 / 成员），可拼成一张长图。 -->

## scene 模式项目

scene 模式适合“一个连续场景被拆成多个 task”的项目，例如抽帧图片序列或逐帧点云。普通图片/点云项目不开启 scene 模式；视频项目仍走视频轨迹工作流，不显示该开关。

开启 scene 模式后：

- 项目默认开启同 scene 连续领取，标注员完成一帧后更容易继续拿到同一 scene 的下一帧。
- 数据集选择器只显示同媒体类型、且已经识别出 scene 的数据集。
- 关联后的初始分包默认使用按 scene 分包，让一个 scene 的所有帧留在同一个批次里。

数据集和项目的类型必须匹配。图片项目只能关联图片数据集；3D 点云项目关联点云数据集。scene 模式项目只能关联已识别出 scene 的数据集；普通项目只能关联未识别出 scene 的数据集。直接调用 API 也会执行同样的校验。

项目一旦已经生成 task，就不能再切换 scene 模式。需要变更时，先解绑数据集并清空任务，再调整项目配置。

> scene 模式项目需要关联**已识别出 scene 的数据集**。如何在导入时产生 scene（原生目录约定 / 多 scene 布局 / nuScenes 脚本），详见 [点云 / 多模态数据集导入格式](../datasets/import-formats.md)。

## Data Manager

项目设置页提供 **Data Manager** 入口，用于查看项目内任务运营视图。它支持保存视图、受控过滤 DSL、排序、列显隐和任务计数列，适合固定查看“有未解决反馈”“有预测候选”“某个模型版本低置信度”等任务集合。

本版 Data Manager 只读，不执行批量指派、导出、重跑预标或清理预测。详见 [Data Manager](./data-manager.md)。

## 标注指引

为项目编写 Markdown 形式的标注指引，供标注员在工作台阅读以降低标注偏差。**该功能当前已下线**（特性开关 `ANNOTATION_GUIDE_UI_ENABLED=false`），设计与行为说明见
[标注指引（Annotation Guide）](./annotation-guide.md)。

## 从已有项目复制配置

如果新项目的 classes / 属性 schema / AI 接入配置 / 渲染配置等与既有项目相同（或大致相同），可以直接复制配置：

1. 在 Dashboard 找到要复制的项目卡片 → 右下角 `⋮` → 「复制项目配置」。
2. 自动跳到 Wizard，顶部出现 banner「已用源项目配置预填表单」；新项目名默认为 `{源项目名} (副本)`。
3. 7 步流程正常往下走，任何字段都可以在某步覆盖（你的修改优先于源配置）。
4. 提交后新项目就绪。**只复制配置**：`tool_bindings`（类别与属性 schema）/ `type_key` / `type_label` / `data_type` / `ai_enabled` / `label_config` / `sampling` / `rendering_config` / `show_overlap_first` / `iou_dedup_threshold` / `box_threshold` / `text_threshold` / `text_output_default` / `maximum_annotations`（完整列表见后端 `CLONEABLE_PROJECT_FIELDS`）。**不复制运行时数据**：datasets / tasks / annotations / members / batches。

> 需要跨项目共享 / 跨组织共享 / 模板治理？使用「项目模板库」独立资产形态，
> 详见 [项目模板库（Project Templates）](./project-templates.md)。

banner 中的 **「同时复制标注指引」** 默认勾选：复制配置时连
带源项目的 Markdown 指引与图片资源带过来。图片资源 storage key 与源项目共享，源项目删除资源会影响
新项目；如需独立资源在新项目设置页里重新拖入图片即可。

## 导入 / 清理外部预测

把客户自训模型、第三方推理服务的产物以 AAP JSON / COCO Detection / YOLO zip 形式导入为待采纳预测，或按来源（外部导入 / ML Backend 预标 / 全部）清理已有预测。入口、各格式最小 payload、YOLO 变体与替换 / 清理规则详见 [导入 / 导出外部预测](../datasets/prediction-import-export.md)。

## 任务生成

项目创建或数据集关联后，每条数据会自动生成一个任务，状态为 `pending`，等待分配。

> **大数据集异步建任务**（v0.12.0）：关联的数据集条目数超过 `TASK_CREATE_SYNC_THRESHOLD`（默认 2000）时，建任务会转入后台异步进行，关联界面显示进度条；**完成前工作台 / 未归类横带还看不到这批任务，属正常现象**。建完后即可在「未归类任务」横带处理，详见 [批次与分配](./batch.md)。

如果数据集已经关联到项目，后续在数据集页继续上传文件、上传 ZIP、执行「扫描导入」或从连接器导入，新增文件也会同步生成项目任务；无需先取消关联再重新关联。

在数据集导入向导的「基本信息」步可勾选「声明为时序数据集（scene）」，也可通过导入脚本 / API 设置（字段 `is_temporal`，nuScenes 转换脚本会自动声明）。声明为时序后，导入完成时如果系统没有识别出任何 scene，会直接失败并提示检查目录结构；未声明的数据集保持普通导入行为。点云 / 多模态数据集如何在导入时产生 scene，详见 [点云 / 多模态数据集导入格式](../datasets/import-formats.md)。

## 从数据源连接器导入数据集

通过 S3 / OSS / SFTP 连接器按路径 + 通配符批量拉取数据入库。连接器的创建、主机白名单、密钥加密、SFTP 前置条件，以及「连接器导入」向导的完整步骤详见 [存储连接器导入](../datasets/storage-connections.md)。

## 常见问题

**类别如何后续修改？**
进入项目设置页的「类别与属性」可按工具单位追加类别和属性 schema；删除已用类别 / 属性会先显示受影响标注数。删除定义不会删除标注数据：加回同名类别或同 key 属性即可恢复。工作台 ⚙ 菜单可临时隐藏孤儿标注；需要永久清理时由项目负责人或超管执行 cleanup。

**能否中途切换 ML Backend？**
可以，在项目设置的「ML 模型」中切换绑定的 backend；已生成的预标注不会重跑，需手动触发「重新预标注」。
