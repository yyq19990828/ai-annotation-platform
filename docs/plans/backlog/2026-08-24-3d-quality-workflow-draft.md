# 3D 专属质量流程计划草案

> Status: research-draft
>
> Implementation authorization: no
>
> Version: unassigned；本草案不占版本号
>
> Finalization: 实施前必须执行 [`backlog/README.md`](README.md) 的“转定稿门”

## 1. 推荐结论

推荐新增**结构化的 3D Quality Run / Issue 领域**，复用平台现有异步任务、反馈线程和工作台定位能力，但不把 3D 几何指标硬塞进 `MaskQC`，也不把自动发现的问题直接当作普通人工评论。

第一版只做确定性或可解释的规则：规则生成 issue、用户定位与处置，绝不自动修改 annotation。3D Ground Truth / Consensus 依赖这套指标与定位合同，但另立草案。

## 2. 当前基线快照

- 平台已有 `MaskQCRun / MaskQCIssue`、`VideoTrackQualityRun / Issue`、`AsyncJob` 和 `AnnotationFeedback`，已经验证“机器发现 + 结构化指标 + 人工讨论”的分层价值。
- 3D 工作台已有 cuboid 内点选择、地面估计、自动拟合、投影、邻帧点云、ego 对齐和 `track_id`，多数首批规则不需要引入新算法依赖；track 断点和时序跳变在 [`SceneTrack`](../2026-08-25-v0.24.11-3d-track-domain-foundation.md) 稳定前不得把成员缺口当成生命周期真值。
- 通用 Issues 能锚定 project / task / annotation / pixel，但 3D 问题还需要 scene、frame、track、camera、PSR、点索引集合和辅助层参数，不能只靠一段 body 文本恢复现场。
- 当前没有 3D 专属规则版本、source snapshot、stale 判定和批量运行入口。

## 3. 领域边界

```text
Annotation / SceneTrack / Scene / Pose / Calibration
                │ source snapshot + rule config revision
                ▼
       3D Quality Run (AsyncJob)
                │
                ▼
  结构化 3D Quality Issue ─────► AnnotationFeedback 讨论线程
                │ locator
                ▼
 scene 时间轴 / 3D Workbench ─► 帧 + 对象 + 相机 + 辅助层复原
                │
                └─► resolved / wont_fix / stale（不自动改标注）
```

`3D Quality Issue` 保存规则 code、规则版本、metric、threshold、source annotation versions、`scene_track_id + track_revision`、scene / frame 定位器、相关 annotation、建议命令和状态。评论与协作继续进入 `AnnotationFeedback`，不在质量表重复造讨论系统。

## 4. 第一批规则

| 规则            | 输入与指标                                        | 定位行为                    | 首版边界                           |
| --------------- | ------------------------------------------------- | --------------------------- | ---------------------------------- |
| 空框 / 点数过少 | cuboid 内有效点数与项目阈值                       | 聚焦框并只高亮框内点        | 对抽样点云必须换算或明确标记近似   |
| 穿地 / 悬浮     | 框底面与地面估计差值                              | 显示地面层和高度差          | 地面置信度不足时不报结论性 issue   |
| 尺寸异常        | 类别内 length / width / height 稳健分位           | 打开 PSR 面板并展示同类范围 | 样本不足不计算类别异常             |
| 时序跳变        | 同 track 相邻帧中心、尺寸、yaw 的 pose 补偿后差值 | 同显前后帧框和差值          | 只比较可信 pose 或明确无 pose 模式 |
| track 断点      | 声明存在区间内缺失帧、重复身份或类别漂移          | 跳到断点并建议轨迹命令      | 明确缺席区间不报漏标，不自动补帧   |
| 点掩码重叠      | 互斥类别共享全局点 ID                             | 高亮冲突点和两个对象        | 点索引不稳定的数据集禁用           |

“多相机投影残差”只有在[持久化多模态对象草案](2026-08-24-persistent-multimodal-object-draft.md)落地后才启用；实时投影与自身比较不能构成独立质量证据。

## 5. 状态与可复现性

- 每次 run 冻结 scope、规则配置 revision、源 annotation id / version、pose / calibration revision 和点云身份摘要。
- 同一问题使用稳定 dedupe key；新 run 再次发现时更新 `last_seen_run`，不制造无穷重复 issue。
- 源 annotation、pose、calibration 或规则版本改变后，旧 issue 变为 stale 或重新评估，不能继续显示为当前事实。
- `resolved` 表示用户确认问题已处理，`wont_fix` 必须记录原因，`stale` 由版本变化推导；重新打开需要审计记录。
- 阈值属于项目级、可版本化配置。默认值必须来自固定评估集，不把部署环境变量当业务规则仓库。

## 6. 范围

- 3D 质量 run / issue 的持久化、异步运行、幂等、进度、取消和 stale 语义。
- 六条首批规则中的确定性子集；转定稿可因评估证据缩减，不能无证据扩大。
- 项目 / scene / task / annotation 范围启动与过滤。
- 工作台问题列表、严重度、指标解释和一键恢复现场。
- 与 annotation feedback 的讨论关联，以及 resolve / wont-fix / reopen 审计。

## 7. 非范围

- 不自动移动 cuboid、补 track、执行生命周期命令、删除点或接受候选。
- 不在本计划实现 GT job、多人 replica、Consensus 投票或合并。
- 不把统计离群等同错误；阈值不足或证据低置信时降级为 info 或不产出。
- 不复用 MaskQC 的 region mask 存储去承载 3D 点索引。
- 不承诺一次覆盖所有 geometry、所有传感器或无 pose 的任意时序数据。

## 8. 推荐实现切片（转定稿后执行）

1. **合同与最小两规则**：run / issue / locator / stale，先落空框和尺寸异常，验证数据模型与定位闭环。
2. **scene 规则**：加入地面差、时序跳变和 track 断点，接入时间轴；各规则可独立开关和回滚。
3. **点级冲突**：确认全局点 ID 后加入点掩码重叠，建立大点集计算预算。
4. **处置与运营**：项目配置、过滤、反馈线程、审计、正式文档和固定评估集回归。

## 9. 验收方向

- 每条 issue 都能一键恢复到正确 scene、frame、annotation / track、相机和所需辅助层。
- 同一 source snapshot 重跑得到相同 issue code、metric、threshold 和 dedupe key。
- annotation 修改后旧 issue 不再冒充当前问题；stale 与重新检测结果可追溯。
- 自动 run 只写质量 issue，不产生 annotation mutation；API 和审计可证明这一点。
- 固定真阳性 / 真阴性夹具给出逐规则 precision / recall 或误报清单，阈值有依据。
- 取消、worker crash 和部分场景失败均有终态，成功结果与失败范围可对账。

## 10. 风险与回滚

- 规则过多会制造告警疲劳。第一版宁可少而可解释，并按项目启用，不用“总分”掩盖规则差异。
- 复用 MaskQC 表会导致 locator 与版本语义扭曲；推荐复用模式和基础设施，不复用领域表。
- 回滚可停止新 run 并隐藏 3D QC 入口；已有 issue 保留只读审计，不删除用户处置记录。

## 11. 转定稿专项检查

- 对比届时的 MaskQC、VideoTrackQuality 和 AnnotationFeedback，确认哪些基础设施已抽成共享层，避免复制过期实现。
- SceneTrack、存在区间、track revision 与可逆命令日志必须先完成；质量规则只引用命令建议，不能绕过 preview 和用户确认直接修改真值。
- 用真实点云抽样 / tiling 状态核对点数和点索引语义；近似指标必须在 UI 标出。
- 为每条拟实施规则先建立正反夹具和阈值报告，未达到解释性要求的规则从定稿移除。
- 精确列出模型、迁移、worker、service、router、前端定位器、时间轴、测试和文档文件，并确认大变更面。
