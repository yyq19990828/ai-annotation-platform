# async_jobs 单一真值表收敛（2026-05-23）

> 把 `async_jobs` 从「索引层」升级为「单一真值表」，收敛掉 `prediction_jobs`(PredictionJob) 与
> `video_tracker_jobs`(VideoTrackerJob) 两张专表的双写双轨。
>
> 来源：ROADMAP §B「性能 / 扩展 · async_jobs 统一表收敛」(P3) + 取经合集 §1.7；底线见决策表「Task 双重含义」行。
>
> 分支：`feat/async-jobs-unification`，分批提交（Phase 1 / Phase 2 各自成 commit）。

## 背景与现状

- `async_jobs`（[async_job.py](../apps/api/app/db/models/async_job.py)）已是所有长任务的汇总索引表，前端任务铃铛 / 历史页 / `/ai-pre/jobs` / 视频 job 页**全部已迁到 `/async-jobs`**（v0.10.45）。
- 专表仍作 domain 真值双写双轨：
  - `PredictionJob`（批×模型，图像预标）—— worker 把它当**运行时工作记录**用。
  - `VideoTrackerJob`（任务×标注，帧级追踪）—— runner 把它当**运行时状态机** + WebSocket `event_channel` 载体。
- 专表读取端点（`/admin/preannotate-jobs`、`/video-tracker-jobs`）前端仅有 api 定义、**无页面调用**。

## 设计决策

1. **收敛后 domain 字段去向**：所有 domain 专属字段进 `async_jobs.payload`（输入）/ `result`（输出）JSONB。
2. **外键完整性取舍**：收敛会丢掉专表的 FK（`batch_id` / `ml_backend_id` / `task_id` / `annotation_id` / `segment_id`）。
   - `project_id` / `user_id` 已在 `async_jobs` 上（保留 FK + cascade）。
   - 其余 domain id 进 payload，**接受失去引用完整性**（这些 job 是瞬时执行记录，非长期实体关系；删除关联实体时 job 记录变为孤儿索引可接受，retention 会清）。
3. **不可逆迁移**：Phase 1 / Phase 2 各含 drop table 迁移。项目未上生产，dev 库可重置，风险可控。

## Phase 1 — 收敛 PredictionJob（v0.10.49，低风险）

字段全部已双写进 async_jobs payload/result，前端已迁离，最独立。

1. **worker 改以 async_jobs 为工作状态**：[tasks.py](../apps/api/app/workers/tasks.py) `batch_predict`
   - 删除 PredictionJob 的建行（145-156）/ 进度统计更新（285-292）；统计写入 `async_job.result`。
   - 批次自动翻状态依赖的 `batch_id` 从 `async_job.payload["batch_id"]` 取。
   - `_mark_job_failed`（327-376）去掉专表分支，只走 `async_job_svc.mark_failed`。
   - → verify：现有 `test_prediction_jobs_worker.py` 改写为断言 async_jobs；batch_predict 端到端跑通。
2. **弃用读取端点**：[admin_preannotate_jobs.py](../apps/api/app/api/v1/admin_preannotate_jobs.py) `/admin/preannotate-jobs` 改读 `async_jobs WHERE kind=batch_predict`，或直接删端点 + 前端 api 定义。
   - [admin_preannotate.py](../apps/api/app/api/v1/admin_preannotate.py) 的 `MAX(started_at) GROUP BY project_id` 改查 async_jobs。
3. **删表迁移**：drop `prediction_jobs`；删 [prediction_job.py](../apps/api/app/db/models/prediction_job.py) model。
   - → verify：`alembic upgrade head` + 全后端测试通过。

## Phase 2 — 收敛 VideoTrackerJob（v0.10.50，中风险）

runner 把专表当运行时状态机，且有 WebSocket 实时通道，需更细致。

1. **async_jobs 补字段**：新增 `cancel_requested_at DateTime nullable`（取消语义无处安放，进列而非 payload，因 runner 需轮询）。
2. **event_channel 动态生成**：不再存列，按 `f"video-tracker-jobs:{job_id}"` 在订阅/发布两端一致生成；核对 [video_tracker_runner.py](../apps/api/app/services/video_tracker_runner.py) 与前端 [useVideoTrackerJobs.ts](../apps/web/src/hooks/useVideoTrackerJobs.ts) 通道名一致。
3. **runner / worker 迁移**：[video_tracker.py](../apps/api/app/workers/video_tracker.py) + [video_tracker_runner.py](../apps/api/app/services/video_tracker_runner.py) 改以 async_jobs 为状态真值。
   - **补齐取消同步**：runner 取消分支（305-306）当前**没有**同步 async_jobs，收敛后必须补。
4. **弃用读取端点**：[video_tracker_jobs.py](../apps/api/app/api/v1/video_tracker_jobs.py) `/video-tracker-jobs`（含 JOIN Task + cursor 分页 + status 计数）改为 async_jobs 视图或删除 + 前端 api 定义。
   - [video_tracker_job_service.py](../apps/api/app/services/video_tracker_job_service.py) 专表读取部分删除。
5. **删表迁移**：drop `video_tracker_jobs`；删 [video_tracker_job.py](../apps/api/app/db/models/video_tracker_job.py) model。
   - → verify：视频追踪端到端（创建 → 帧级 WS 进度 → 完成 / 取消）跑通；新增 cancel 同步单测。

## 验证清单（合并后主进程跑）

- [ ] `cd apps/api && uv run pytest`（重点 test_async_jobs / video_tracker / preannotate）
- [ ] `alembic upgrade head` 在干净 dev 库无误
- [ ] 前端 `pnpm lint && pnpm test`
- [ ] 手动：batch_predict 预标 + 视频追踪（含取消）端到端，任务铃铛 / 历史页正常

## 收尾

- 删 ROADMAP §B「async_jobs 统一表收敛」条目 + 优先级表相关行；决策表「Task 双重含义」行更新为「已收敛单一真值」。
- CHANGELOG 记 v0.10.49 / v0.10.50 两段。
