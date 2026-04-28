# 路线图

> 拆分自《AI标注平台深度调研报告》§7

> **此文件随开发进度持续更新** · 最后更新：v0.3.0（2026-04-28）

## v0.3（2026-04-28）— 把 AI 落地 ✅ 已完成

- [x] 数据模型重构：加 Organization / TaskLock / AnnotationDraft
- [x] **拆分 Annotation 和 Prediction**（关键！）
- [x] **MLBackend 表 + HTTP 客户端 + CRUD API**
- [ ] 部署一个 Grounded-SAM-2 ML Backend Demo
- [x] 批量预标：Celery 任务 + WebSocket 进度推送
- [ ] Workbench 接入交互式 SAM（鼠标点 → 出 mask）— API 就绪，前端待接入
- [x] Presigned URL 上传
- [x] 角色/状态枚举化（中文 → 英文）
- [x] Next-task 调度策略（uncertainty + uniform + sequence）
- [x] PredictionMeta 完整 token cost 追踪
- [x] Tasks API 从 stub 替换为真实实现（14 个端点）

## v0.4（2 周）— 协同 + 质检 + 前端真实对接

- [ ] WorkbenchPage 完整对接真实 API（替换 mock 数据）
- [ ] 部署 Grounded-SAM-2 ML Backend Demo 并端到端验证
- [ ] Workbench 交互式 SAM（鼠标点/拖框 → 出 mask）
- [ ] 任务锁前端集成（进入任务→获取锁→心跳续约→离开释放）
- [ ] 审核流：annotator → reviewer 二级流转
- [ ] AI 接管率统计仪表盘（基于 `parent_prediction_id`）
- [ ] 数据导出 COCO/VOC/YOLO

## v0.5（3-4 周）— Agent + 质量保证

- [ ] Adala 服务集成 + LabelStudioSkill 适配自己 schema
- [ ] LLM Judge 模式（VLM 判别 AI 预标质量）
- [ ] 多人交叉标注前端支持
- [ ] IAA / 一致性指标计算
- [ ] 草稿自动保存前端实现

## v0.6+ — 生产化

- [ ] 多源存储抽象（S3 / 阿里云 OSS）
- [ ] 审计日志 + Webhook 出口
- [ ] 持续训练触发器
- [ ] Helm Chart + 高可用部署
- [ ] i18n（react-i18next）
