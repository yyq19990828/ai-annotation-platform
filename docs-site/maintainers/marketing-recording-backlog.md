# 高清母版录制 backlog

本清单只规划尚未进入 `marketing-assets.ts` 的母版。真正开始实现某项时，先把规格写入
`apps/web/e2e/screenshots/_helpers/marketing-assets.ts`，再增加一个只表达该目标的独立 flow；
不得用无意义停顿、慢放或混入其他功能来满足时长。

每项完成后需要同时满足：4K UHD / 60fps 门禁通过、运行 manifest 含完整分镜与来源提交、
文档派生 MP4 已生成、对应文档引用已更新、媒体审计不报告损坏或过期。

## 第一批：当前题 AI 完整链路

| 优先级 | 资产 ID                         | 完整链路与验收重点                                                            | 建议时长 | 文档落点                                | 状态 |
| ------ | ------------------------------- | ----------------------------------------------------------------------------- | -------- | --------------------------------------- | ---- |
| P0     | `current-task-image-inference`  | 打开当前题 AI → 选择项目编排 → 运行 → 查看候选几何与置信度 → 采纳 → 标注落库  | 15–24 秒 | `ai/current-task-inference`             | 已录 |
| P0     | `current-frame-video-inference` | 定位有目标帧 → 运行当前帧推理 → 查看帧级候选 → 采纳 → 切换相邻帧确认作用范围  | 16–26 秒 | `ai/current-task-inference`、视频工作台 | 已录 |
| P0     | `secondary-inference-attribute` | 选中已有目标 → 发起二次推理 → 返回属性/文本 → 人工修正 → 保存到同一标注       | 14–24 秒 | `ai/current-task-inference`             | 已录 |
| P0     | `candidate-review-lifecycle`    | 连续审阅至少三个候选 → 分别采纳、驳回和跳过 → 焦点自动前进 → 展示最终候选计数 | 16–28 秒 | `ai/candidate-review`                   | 已录 |

## 第二批：视频 AI 追踪与修正

| 优先级 | 资产 ID                           | 完整链路与验收重点                                                              | 建议时长 | 文档落点                    | 状态 |
| ------ | --------------------------------- | ------------------------------------------------------------------------------- | -------- | --------------------------- | ---- |
| P0     | `video-tracker-text-discovery`    | 输入明确目标文本 → 发起无源发现 → 跨帧查看候选 → 采纳为新轨迹                   | 18–30 秒 | `workbench/video-propagate` | 已录 |
| P0     | `video-tracker-combo-discovery`   | 输入文本 → 运行“发现 + 逐对象记忆”组合模型 → 跨窗口核对稳定身份 → 筛选并采纳    | 30–50 秒 | `workbench/video-propagate` | 已录 |
| P0     | `video-mask-correction-propagate` | 查看错误边界 → 在后续帧添加正负笔迹修正 → 从修正帧重新传播 → 核对并保存更新轨迹 | 20–36 秒 | `workbench/mask-brush`      | 已录 |

## 第三批：项目编排、运维与大数据能力

| 优先级 | 资产 ID                         | 完整链路与验收重点                                                           | 建议时长 | 文档落点                            | 状态 |
| ------ | ------------------------------- | ---------------------------------------------------------------------------- | -------- | ----------------------------------- | ---- |
| P1     | `pipeline-template-create`      | 新建编排 → 添加两个有因果关系的阶段 → 配置模型 → 校验并保存                  | 18–30 秒 | 项目 AI 编排                        | 已录 |
| P1     | `pipeline-apply-project`        | 选择已保存编排 → 绑定项目 → 发起预标 → 查看阶段进度与最终候选                | 18–32 秒 | `projects/ai-preannotate`           | 已录 |
| P1     | `jobs-retry-recovery`           | 打开失败作业 → 查看错误摘要 → 重试 → 新作业完成 → 进入工作台审阅结果         | 16–45 秒 | 工作流失败恢复                      | 已录 |
| P1     | `pointcloud-camera-seed-3d-box` | 在相机视图给出二维提示 → 视锥选点拟合真实 3D 框 → 三视图核对 → 相机重投影    | 16–36 秒 | `workbench/pointcloud-projection`   | 已录 |
| P1     | `pointcloud-crossframe-track`   | 已复核 3D 框 → 延续两个相邻帧 → 中间帧修正 → 核对同一 `track_id` 与邻帧参考  | 22–40 秒 | `workbench/pointcloud-crossframe`   | 已录 |
| P1     | `large-image-pyramid-recovery`  | 缩放至高清切片 → 模拟单切片失败 → 自动重试恢复 → 继续平移并保持细节          | 16–28 秒 | `workbench/index`                   | 已录 |
| P1     | `model-market-runtime-pool`     | 打开服务池 → 展开实例 → 查看路由状态、并发与资源观测 → 切换实例详情          | 15–26 秒 | 超级管理员模型市场                  | 已录 |
| P1     | `project-ml-routing`            | 启用 YOLO 并设为批量主后端 → 当前题 AI 命中 YOLO → Smart Point 自动命中 SAM3 | 18–32 秒 | 项目后端配置、当前题 AI             | 已录 |
| P1     | `background-export-download`    | 发起大批量导出 → 查看后台任务进度 → 完成后下载 → 展示导出格式与文件          | 16–30 秒 | `datasets/prediction-import-export` | 已录 |

## 版本与复核

- 录制来源版本、dirty 状态、种子修订和媒体哈希由 manifest 自动记录，不在表格中手填。
- 人工复核只通过 `pnpm docs:media:approve -- --asset <仓库相对路径>` 写入
  `media-reviews.json`；全部素材都已逐项目视检查后可改用 `--all`，命令要求工作区干净。
- 每周巡检只生成报告，不自动重录或覆盖母版；Tier A 缺口、源码变更或超过复核周期后进入下一轮计划。
