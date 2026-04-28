# 关键能力对比矩阵

> 拆分自《AI标注平台深度调研报告》§5

> ✅ 已具备 / 🟡 部分 / ❌ 缺失 / N/A 不适用
>
> **最后更新：v0.3.0（2026-04-28）**

## 5.1 标注能力

| 能力 | LS | CVAT | X-AL | Roboflow | Encord | V7 | 你 v0.3.0 |
|---|---|---|---|---|---|---|---|
| 矩形框 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 多边形 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| 实例分割(mask) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| 关键点 / Skeleton | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| 视频追踪 | 🟡 | ✅ | 🟡 | ✅ | ✅ | ✅ | ❌ |
| OCR（文本框 + 内容） | ✅ | 🟡 | ✅(PPOCR) | 🟡 | 🟡 | 🟡 | ❌ |
| 3D 点云 | ❌ | ✅ | 🟡 | ❌ | ✅ | ❌ | ❌ |
| 语义分割 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |

## 5.2 AI 能力

| 能力 | LS | CVAT | X-AL | Roboflow | Encord | V7 | 你 v0.3.0 |
|---|---|---|---|---|---|---|---|
| 模型即 HTTP 服务 | ✅ | ✅(Nuclio + Agent) | 🟡(Remote) | ✅ | ✅ | ✅ | ✅ MLBackend 表 + HTTP 客户端 |
| 交互式 SAM | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 🟡 API 就绪，前端待接入 |
| 批量预标 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ Celery + WebSocket 进度 |
| Active Learning | 🟡 LSE | 🟡 stage | 🟡 阈值 | 🟡 | ✅ | ✅ | 🟡 uncertainty 调度已实现 |
| LLM Judge / VLM | 🟡 通过 Adala | 🟡 | 🟡(Florence2/Gemini) | 🟡 | ✅ | ✅ | ❌ |
| 文本驱动检测 | ❌ | 🟡 | ✅(Grounding) | 🟡 | ✅ | ✅ SAM3 | ❌ |
| 持续训练 | ✅ | 🟡 | ❌ | ✅ | ✅ | ✅ | ❌ |
| Token 成本追踪 | ✅ PredictionMeta | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ PredictionMeta |

## 5.3 协同与质量

| 能力 | LS | CVAT | 你 v0.3.0 |
|---|---|---|---|
| 多租户 (Org) | ✅ | ✅ | 🟡 表已建，功能待实现 |
| 任务锁 (TaskLock) | ✅ | 🟡(state 字段) | ✅ 获取/释放/心跳续约 |
| 多人交叉 | ✅ overlap | ✅ Job | 🟡 overlap 字段 + 调度支持，前端待接入 |
| Ground Truth 验证 | ✅ | ✅ ValidationFrame | 🟡 ground_truth 字段已有 |
| IAA / 一致性 | 🟡 LSE | ✅ quality_control | ❌ |
| 共识标注 | ❌ | ✅ consensus | ❌ |
| 审核流(stage) | 🟡 | ✅ annotation/validation/acceptance | 🟡 submit → review 状态流转 |
| 审计日志 | 🟡 | 🟡 | ❌ |
| Webhook | ✅ | ✅ | ❌ |

## 5.4 工程化

| 能力 | LS | CVAT | 你 v0.3.0 |
|---|---|---|---|
| Docker Compose | ✅ | ✅ | ✅ 含 Celery worker |
| Helm Chart | ❌ | ✅ | ❌ |
| Presigned URL 上传 | ✅ | ✅ | ✅ upload-init + upload-complete |
| 多源存储抽象 | ✅ io_storages | ✅ cloud_provider | 🟡 MinIO 单源，StorageService 已抽象 |
| 异步任务队列 | ✅ RQ | ✅ RQ | ✅ Celery + Redis |
| WebSocket | 🟡 | ✅ | ✅ 预标注进度推送 |
| JWT + RBAC | ✅ | ✅ | ✅ 英文枚举 + require_roles |
| 数据导出多格式 | ✅ | ✅ | ❌ |
| Webhook | ✅ | ✅ | ❌ |
| 国际化 i18n | ✅ | ✅ | 🟡 前端 ROLE_LABELS 映射，框架待搭 |
| Feature Flags | ✅ | 🟡 | ❌ |
