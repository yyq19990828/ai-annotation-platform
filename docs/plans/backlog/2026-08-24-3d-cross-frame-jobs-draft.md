# 3D 跨帧任务中心与 Registration 跟踪计划草案

> Status: research-draft
>
> Implementation authorization: no
>
> Version: unassigned；本草案不占版本号
>
> Finalization: 实施前必须执行 [`backlog/README.md`](README.md) 的“转定稿门”

## 1. 推荐结论

推荐先把现有传播、批量传播和插值统一到一个**显式范围、可观察、可取消、可重试的跨帧任务合同**，再把 registration-based 跟踪作为同一合同下的新 operation。不得采用“有选中对象就处理选中对象、没有选择就处理全部”的隐式规则。

registration 不替换现有 ego-aware 传播和关键帧插值；它只是在点云配准质量足够时提供另一个候选生成器，结果必须进入预览 / 审核而不是直接覆盖人工真值。

## 2. 当前基线快照

- `Annotation.track_id` 已是跨几何类型对象身份；后端已有 propagate、batch propagate、interpolate range 与邻帧 annotation 查询。
- 3D 工作台已有目标帧选择、邻帧点云、ego pose 对齐和对象级对齐几何 helper。
- 平台已有 `AsyncJob`、prediction job 进度、取消 / 清理和 WebSocket 通路，但跨帧 3D 操作尚未形成统一产品合同。
- 当前 `FramePicker` 主要解决局部目标选择，无法解释长区间进度、部分失败与重试边界。

## 3. 任务合同

每次启动必须让用户明确确认以下五项：

1. `operation`：传播、插值、registration 跟踪或已注册的其他能力。
2. `scope`：`selected` 或 `all`；selected 必须携带稳定的 annotation / track 快照，all 必须显示对象数量。
3. `direction`：forward、backward 或显式双向；不得从目标帧大小隐式推断。
4. `range`：起止帧与最大帧数，启动前展示预计处理帧数和不可访问帧。
5. `conflict policy`：默认 skip existing；overwrite 需要二次确认并记录审计。

```text
Workbench 选择 + scene 区间
          │ 显式 scope / direction / policy
          ▼
   Cross-frame Job API ─► AsyncJob / Worker ─► operation adapter
          │                    │                    │
          │                    ├─ progress          ├─ ego-aware propagate
          │                    ├─ cancel            ├─ interpolate
          │                    └─ failed frames     └─ registration candidate
          ▼
 scene 时间轴 / 任务面板 ─► 预览与接受 ─► Annotation + history / audit
```

## 4. Registration 推荐边界

- 输入只使用同 scene 的相邻或有限窗口点云、可信 ego pose 和用户明确选择的对象 / 范围。
- registration 输出是每帧的变换、质量分数和候选 `box_3d`，不是已接受 annotation。
- 质量低于阈值、点云缺失、pose 缺失或配准发散时标记失败帧，不外推到剩余区间。
- 候选接受后复用 Prediction lineage、`track_id` 与现有 annotation 写入；拒绝不污染人工真值。
- 第一版只允许一个短窗口和单个选中对象。`all` 与长区间要在准确率、运行时和取消语义通过后才开放。

## 5. 范围

- 统一跨帧 job 的请求、状态、进度、取消、失败帧和按失败子集重试语义。
- 在 3D 工作台提供显式 selected / all、方向、范围与冲突策略确认。
- 让 scene 时间轴和任务面板消费同一 job 状态，不各自维护运行中标记。
- 把现有同步 / 批量操作适配到统一状态模型，保证幂等与部分失败可解释。
- 在门控基准通过后增加单对象短窗口 registration adapter 与候选审核。

## 6. 非范围

- 不默认“无选择等于全部对象”。
- 不让取消等同回滚已经成功写入的人工标注；若 operation 是候选生成，取消只停止未完成帧。
- 不建设通用 DAG、工作流编排器或新的模型注册中心。
- 不用 registration 替换 ego pose，也不跨 scene 跟踪。
- 不在第一版做实时 4D SLAM、多 LiDAR 联合优化或类别专用学习模型。

## 7. 幂等、快照与失败语义

- 启动作业时冻结 source annotation version、track_id、scene frame range、pose / calibration revision 和 conflict policy。
- 相同 singleflight key 的 active job 返回同一 job；完成后再次提交必须由显式 retry / rerun 创建新 revision。
- worker 写入前复核源版本。源对象已修改时该帧标记 stale，不用旧快照覆盖新真值。
- progress 以已终结帧数计算，成功、skipped、failed、stale、cancelled 之和可对账。
- retry 默认只处理 failed / stale 中用户重新确认的子集，保留 parent job id 和参数快照。

## 8. 推荐实现切片（转定稿后执行）

1. **显式启动合同**：先在 UI 和 API 固定 operation / scope / direction / range / policy，不改变算法。
2. **异步状态与恢复**：把长区间操作接入 job、进度、取消和失败重试；时间轴只消费状态。
3. **候选型写入**：对会生成多个帧结果的 operation 增加预览 / 接受边界，锁定 version conflict。
4. **registration 门控切片**：固定数据集上达到准确率和运行预算后，加入单对象短窗口 adapter，再评估 all scope。

## 9. Registration 触发门

转定稿不得只因竞品已有该能力就实施。至少需要：

- 三类场景的固定验证集：静态背景 + 缓慢运动、快速 ego 运动、稀疏 / 遮挡目标。
- 与现有 ego-aware propagate、线性插值和人工操作比较中心误差、yaw 误差、尺寸漂移、失败率与每帧耗时。
- 单对象短窗口相对现有最好基线有稳定收益，且失败能被质量分数识别。
- worker 取消、超时、内存上限和无 GPU 路径均有确定性结果。

未通过时仍可实施跨帧任务中心，但 registration operation 保持不开放。

## 10. 验收方向

- 启动作业前 UI 中没有任何隐式 scope；请求和审计能复原用户选择。
- 取消后 job 在有限时间内终结，时间轴不遗留永久 running；已完成帧与未处理帧可对账。
- 网络刷新或重新打开任务能恢复同一 job 状态，不重复启动。
- 对部分失败执行 retry 只处理选定失败帧，不重复写成功帧。
- 源 annotation 在运行中修改时旧 job 不覆盖新版本。
- registration 的候选在接受前不出现在正式导出中。

## 11. 风险与回滚

- 把现有短操作全部强制异步可能增加等待感；转定稿应保留统一状态语义，但允许低于稳定阈值的操作走即时完成实现。
- 长任务取消与逐帧写入的边界最容易产生“半完成”。必须把部分完成当正常状态展示，不伪装事务级回滚。
- 回滚 registration 只需停止暴露该 operation；统一 job 历史仍可保留。回滚任务中心时需保留已产生 annotation 和审计，不能删除用户结果。

## 12. 转定稿专项检查

- 重新审计 annotation propagation、interpolation、AsyncJob、worker progress、WebSocket 与 Prediction candidate 的真实合同。
- 决定现有同步端点是适配、弃用还是保留；定稿必须给出兼容期和调用方迁移清单。
- 核对 scene 时间轴是否已实施；未实施时提供独立任务面板，不把时间轴作为硬依赖。
- 用当前 worker / Redis / DB 环境验证 singleflight、取消和 stale write，再固定模型、迁移、API 与测试文件。
