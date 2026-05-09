---
layout: home

hero:
  name: AI Annotation Platform
  text: 一站式 AI 辅助标注平台
  tagline: 为多媒体数据打标，让模型上线更快
  actions:
    - theme: brand
      text: 快速开始 →
      link: /user-guide/getting-started
    - theme: alt
      text: 用户手册
      link: /user-guide/
    - theme: alt
      text: 开发文档
      link: /dev/

features:
  - icon: 🖊️
    title: 我是标注员
    details: 登录、接受任务、完成 Bbox / Polygon / 关键点标注，使用 SAM 智能工具提效。
    link: /user-guide/workbench/
    linkText: 开始标注
  - icon: 📋
    title: 我是项目管理员
    details: 创建项目、上传数据、配置标注规范、分配批次、开启 AI 预标注。
    link: /user-guide/projects/
    linkText: 管理项目
  - icon: ✅
    title: 我是审核员
    details: 检查已提交标注的质量，一键通过或回退给标注员修正。
    link: /user-guide/review/
    linkText: 进入审核
  - icon: 🔧
    title: 我要部署平台
    details: Docker Compose 一键启动、配置 ML Backend、监控与告警。
    link: /ops/
    linkText: 查看部署指南
  - icon: 💻
    title: 我要贡献代码
    details: 5 分钟跑通本地环境，了解架构全景，按 How-to 完成第一个 PR。
    link: /dev/local-dev
    linkText: 开始开发
  - icon: 🔌
    title: 我要集成 API
    details: JWT 认证、项目 / 任务 / 标注 / 导出的完整 REST API，OpenAPI 3.1 规范。
    link: /api/
    linkText: 查看 API 文档
---

## 平台能力

| 能力 | 说明 |
|---|---|
| **多种标注类型** | Bbox、Polygon、关键点、分类等，支持图像与文本 |
| **AI 预标注** | 集成 GroundingDINO / SAM，先生成候选，标注员只需修正 |
| **协同与审核** | 任务分配、双盲审核、IoU 校验，确保数据质量 |
| **多格式导出** | COCO、YOLO、Pascal VOC、Label Studio JSON |
| **ML Backend** | 可注册任意模型服务，实时预测与批量预标注 |
| **可观测性** | 内置性能 HUD、Celery 任务监控、审计日志 |
