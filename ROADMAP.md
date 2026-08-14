# 待实现路线图

> 本文件只记录当前源码仍缺失的能力。历史状态与交付记录见
> [CHANGELOG.md](CHANGELOG.md) 和 [docs/changelogs/](docs/changelogs/)。
>
> 判断以当前数据模型、API、执行链路和可达 UI 为准；只有协议或字段地基、但没有完整用户链路的，
> 仍视为未完成。

## 当前主线

### 视频工作台收尾

详见[视频工作台路线](ROADMAP/2026-05-21-video-workbench-roadmap.md)。

- 在可获得的 Windows Edge 与 macOS Safari 客户端补齐 1080p/4K correctness、可见延迟、资源 plateau
  与 fallback rate；Apple Silicon 原生有头 Chrome 已完成 strict 资格，不再作为遗留项。

### 超大图 Tile 与 Raster Mask 客户端计算

详见
[v0.23.21–v0.23.25 超大图 Tile 与 Raster Mask 客户端计算 Epic](docs/plans/2026-07-31-v0.23.21-v0.23.25-large-image-tile-webgpu-epic.md)。

- Epic 已完成：不可变图片金字塔、viewport LOD/Konva tile、隐藏整图消费者收口、task-scoped
  背景/Mask 资源协调、packed CPU fallback 与 one-pass WebGPU 长会话均已封版。横/纵可分离 WebGPU
  候选未通过数据分布无关的两轮端到端门，未进入 production；WebGPU 始终使用访问页面的客户端资源，
  不使用 Linux API/Celery 部署机器的 GPU。
- 后验资格只保留真实缺口：在无实验 flag 的 Linux Wayland、macOS Metal 与 Windows D3D12 客户端补齐
  one-pass correctness、长会话、p95 和 fallback rate；Safari/Edge 按实际 WebGPU 能力记录。没有机器时
  继续标记 `not tested`，不改变 capability-first fallback，也不重新引入 separable 候选。
- 超大图背景可以超过当前 Raster Mask 原生上限；Raster Mask 仍受单边 8192、总计
  67,108,864 pixels 和 morphology ROI 16,777,216 pixels 约束，扩大协议另立版本。

### 点云与图像联合标注

详见[点云 + 图像联合标注路线](ROADMAP/2026-06-14-pointcloud-image-joint-annotation.md)。

- 在相机投影视图中拖拽手柄微调 3D 框。
- 处理多相机一致性约束与 2D 派生导出。

## 独立 Epic

### 数据闭环与训练

- 数据集不可变 snapshot、lineage 与训练复现。
- 主动学习选样、智能切批、批次级 IAA / 共识合并。
- 训练任务状态机与 UI；当前 `/training` 仍是占位入口。
- 严格批次暂停：统一任务可见性、锁归属和写入门禁，补足现有 soft hold 语义。

参考[大规模数据集切批调研](docs/research/12-large-dataset-batching.md)和
[长期规划 L1/L2](ROADMAP/2026-05-12-long-term-strategy.md)。

### 大文件浏览器直传

- 为大于 5GB 的视频和点云提供 multipart upload init / part / complete / abort 协议。
- 保留失败清理、断点续传、内容校验和重复文件检测。

### 多模态工作台扩展

- 为 `video-mm` / `mm` 建立专用工作台分流和交互模型。
- 多 LiDAR 融合标注按真实项目需求单独立项。

## 需求触发 Backlog

### AI 与模型平台

- **模型变体实验**：按稳定实验分组路由非等价变体、记录实验标签，并在工作台并排比较同输入结果。
- **受保护的运行时观测**：让 env-only backend 的 observe 探测支持认证 token。
- **预测导入延伸**：仅在跨实例匹配不再能依赖 `display_id` / `file_path` 时增加 Task `external_id`；按审计需求补 `predictions_import` 取证明细。
- **批量推理**：吞吐压测证明瓶颈后，将 `batchable` 分块派发与 backend 真 GPU batch 一起设计，避免只摊销 HTTP 开销。
- **编排新数据源**：支持既有矩形标注作为 crops 源；scene 跨帧聚合作为独立执行单位。
- **生产存储地址策略**：首个复杂部署出现时扩展 `ML_BACKEND_STORAGE_HOST` 的 endpoint 选择规则。
- **新几何预测对账**：客户 backend 实际输出 rotated bbox / polyline / keypoint 时，补齐协议与端到端导入导出验收。
- **类别确认建议**：Magic Box 产出后提供模型类别 hint，由标注员确认。

### 项目模板

- 模板版本快照、变更对比和审计轨迹。
- organization admin 提交 public 模板的审核流。
- 模板使用明细与传播路径；总使用次数不重复建设。
- AAP JSON 携带模板，实现跨实例导入。
- 审计期确有取证缺口时补模板专项 detail。

### 账号、组织与安全

- 头像上传，以及用户级语言和时区偏好。
- 可操作的组织 / 工作区切换器。
- OAuth2 / 企业 SSO；2FA / TOTP 由客户安全要求触发。
- i18n 文案体系，以及可量化的无障碍审计和 CI 门禁。

### 集成、治理与运营

- Webhook 订阅、outbox、重试投递和签名校验；复用现有事件信封 schema。
- Bug Report 的 LLM 聚类、邮件摘要投递和用户邮件通知偏好。
- AnnotationFeedback 旧表退役并切为单一写入源；视频 Issue 创建时写入当前帧锚点。
- 首次进入标注工作台的一次性 onboarding。

### 标注体验

- 视频单帧折线、polygon track、polyline track 的无冲突快捷键。
- `U` 键改为服务端按真实预测置信度查找下一最不确定任务，不再按预测数量近似。
- 用户级快捷键映射、冲突校验、设置页录制器和动态快捷键帮助。
- 明确 outside 帧是否显示 ghost 参考几何；产品决策后统一实现与测试。
- 评估视频连接层 wedge 后自动硬刷新的收益与标注中断风险。

## 规模或监控触发

- **学习式动静分割**：邻帧点云中的未标注动态目标确实影响生产时再引入。
- **模板治理升级**：误改、公共模板数量或跨组织发布达到现有人工流程上限时启动。

## 工程维护

- 提升 `BatchesSection`、`useWorkbenchShellModel`、`useImageAnnotationActions` 等复杂页面和 hook 的有效测试覆盖，不在路线图固化易过期的覆盖率快照。
- 为 `vite` 代理 `/ws` 的多并发 CONNECTING 卡死制作最小复现；生产链路不受影响。
- 先建立 Playwright 视觉基线，再拆分 `useStageViewport` 相关的首帧 paint 时序。

## 战略与研究输入

- [长期规划（12 个月以外）](ROADMAP/2026-05-12-long-term-strategy.md)
- [CVAT / Label Studio 取经合集](ROADMAP/2026-05-18-cvat-labelstudio-inspiration.md)
- [视频工作台路线](ROADMAP/2026-05-21-video-workbench-roadmap.md)
- [点云 + 图像联合标注路线](ROADMAP/2026-06-14-pointcloud-image-joint-annotation.md)

架构反模式与决策底线统一维护在
[取经合集 §6](ROADMAP/2026-05-18-cvat-labelstudio-inspiration.md#6-避坑清单保持当前选择不要走回头路)，
不再与路线任务混排。
