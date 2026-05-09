# 架构地图

这里是「概念（架构）」板块的导航页。每篇文档回答一个「**为什么**」或「**是什么**」，而非「怎么做」。

> 想做具体操作？去 [How-to](/dev/#我该改哪里)。想排查问题？去 [故障排查](/dev/troubleshooting/)。

## 先看哪里

```
新人路径：
  系统全景（overview）
    → 后端分层 + 前端分层
      → 数据流
        → 预标注流水线 / AI 模型集成
```

## 各篇索引

| 文档 | 回答的问题 |
|---|---|
| [系统全景](../architecture/overview) | 各模块是什么、怎么拼在一起 |
| [后端基础设施（容器）](../architecture/backend-infrastructure) | 哪些容器，各自职责，容器间网络 |
| [后端分层](../architecture/backend-layers) | FastAPI / Service / Repository 各层边界 |
| [前端分层](../architecture/frontend-layers) | 页面 / 组件 / Store / API Client 的关系 |
| [数据流](../architecture/data-flow) | 一条标注从上传到导出走哪些节点 |
| [AI 模型集成](../architecture/ai-models) | GroundingDINO / SAM 怎么接入，预测怎么存 |
| [API Schema 边界](../architecture/api-schema-boundary) | 前后端契约在哪里定义、如何保证一致 |
| [预标注流水线](../architecture/prediction-pipeline) | Job 生命周期、Celery 任务链、错误处理 |
| [部署拓扑](../architecture/deployment-topology) | 生产环境的网络拓扑与服务边界 |
| [性能 HUD](../architecture/perfhud) | 开发期内置性能面板的原理与使用 |

## 尚未覆盖（待补充）

- WebSocket 实时通知架构（详见 [ws-protocol](/dev/ws-protocol)，ADR 层面的 rationale 待写）
- 审核流的状态机设计
- 多租户 / 权限边界（见 [安全模型](/dev/security)）
