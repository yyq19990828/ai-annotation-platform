# 关键点标注

## 适用场景

- 人体姿态（COCO 17 点）
- 人脸关键点
- 手势骨架

## 操作

1. 按 `K` 切到关键点工具
2. 工具栏会出现该项目预设的关键点 schema（如 nose / left_eye / right_eye ...）
3. 按顺序在图像上单击落点

## 跳过不可见点

按住 `Shift` 单击 → 标记为「不可见」（数据中 visibility=0）

## 编辑

- 拖动单点修正位置
- 右键单击点 → 设置可见性 / 删除

## 模板示例

![人体姿态](../images/keypoint/human-pose.png)
<!-- TODO(0.8.1) IMAGE_CHECKLIST: COCO 17 点人体姿态标注示例；点 + 骨架连线可见。 -->

![手部关键点](../images/keypoint/hand.png)
<!-- TODO(0.8.1) IMAGE_CHECKLIST: 21 点手部骨架标注示例。 -->
