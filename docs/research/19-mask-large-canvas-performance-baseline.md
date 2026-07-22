# Mask 大画布性能基线

## 结论摘要

当前 cropped render 能把 1080p 的 50 个 SAM 风格 Mask 保留量控制在约 58.9 MiB，已有实现并不是固定条数缓存；真正的瓶颈是每次分析创建一个 Worker、编辑路径扫描整幅 alpha，并在 stroke 结束时编码 before / after RLE。两轮基准中，4K 显示流水线 p50 / p95 为 235.2–238.8 / 254.5–267.2 ms，4K brush 加历史编码 p50 / p95 为 161.1–161.6 / 164.9–170.7 ms，远高于交互预算。

每轮共创建并终止 180 个 Worker。显式 Worker / bitmap 计数最终都归零，但强制 GC 后的页面 heap 仍比基线高约 22.0 MiB；这不单独证明对象泄漏，却超过后续冻结的 16 MiB 稳态门，必须通过 Worker pool、transferable counts 与更精确的资源计数继续归因。

8K 若延续当前整图实现，单 alpha 为 64 MiB，alpha + RGBA 与编辑临时量的保守估算约 576 MiB。当前 codec 在任一边超过 4096 时已先行拒绝；直接放宽常量会把内存风险推到工作台，因此图片 8K 必须与 sparse tile editor 同时落地，不能只改 schema。

## 测量方法

- 脚本：`apps/web/scripts/benchmark-mask-large-canvas.mjs`
- 命令：`pnpm --filter @anno/web mask:large-canvas-bench`
- 页面：本地 Vite 工作台 `http://localhost:3000`
- 浏览器：Playwright Chromium 147，headless，启用 precise memory info 与 exposed GC
- 机器：Linux 5.15，Intel Xeon Gold 6238R 2.20 GHz，Node 22.23.1
- 样本：确定性 SAM 风格多连通 / 带孔 Mask；720p、1080p、4K
- 重复：每轮 2 次预热 + 20 次记录，共独立执行两轮
- 压力项：1 / 10 / 50 个 1080p Mask、20 次 brush / lasso / history、50 帧并发切换、5K / 8K / 超宽边界
- 原始 trace、video 与 heap snapshot不保留；聚合数据见 `data/19-mask-large-canvas-performance-baseline.json`

`pipeline` 包括临时 Worker 创建、RLE decode / analyze、cropped bitmap 构建和关闭。history 基线模拟当前 stroke 前后 RLE 快照；Long Task 按每次编辑迭代让出事件循环后由 `PerformanceObserver` 记录。

## 显示流水线

| 分辨率 | Pipeline p50 两轮 (ms) | Pipeline p95 两轮 (ms) | Worker 往返 p50 两轮 (ms) | 单 Mask retained bytes |
|---|---:|---:|---:|---:|
| 1280 × 720 | 56.9 / 57.3 | 58.8 / 65.4 | 53.8 / 54.8 | 503,869 |
| 1920 × 1080 | 92.1 / 94.7 | 107.3 / 112.4 | 87.5 / 89.4 | 1,133,207 |
| 3840 × 2160 | 238.8 / 235.2 | 267.2 / 254.5 | 224.4 / 218.1 | 4,516,842 |

显示阶段没有主线程 Long Task；耗时主要发生在 Worker 内的连通域、孔洞与边界分析。4K pipeline p50 两轮差异 1.5%，p95 差异 4.9%。720p p95 差异 10.6%，对应短生命周期 Worker 启动调度抖动，正是后续复用 pool 要消除的固定成本。

## 缓存与快速切帧

| 1080p SAM 风格 Mask 数 | retained bytes | MiB | 是否超过 Standard 128 MiB |
|---:|---:|---:|---|
| 1 | 1,133,207 | 1.08 | 否 |
| 10 | 12,232,706 | 11.67 | 否 |
| 50 | 61,772,007 | 58.91 | 否 |

50 帧、并发 4 的快速切换耗时为 763.4 / 763.1 ms，单帧延迟 p50 为 55.8 / 55.3 ms，p95 为 109.6 / 106.9 ms。两轮 stale commit 与最终 queue 都为 0；但每轮合计创建 180 个 Worker，说明正确性已有基础，生命周期成本仍无稳态。

现有 128 MiB 缓存预算足以容纳这组 50 个稀疏 1080p Mask，但 active descriptor 仍可能绕过 admission。后续应保留 crop 成果，只补严格准入、selected pin、deferred 状态和计数器，而不是重写成另一套条数 LRU。

## 编辑与历史

| 分辨率 | Brush + before/after RLE p50 / p95 两轮 (ms) | Lasso p50 / p95 两轮 (ms) | 20 条历史 bytes | Long Task 次数 / 最大值两轮 (ms) |
|---|---:|---:|---:|---:|
| 1080p | 37.6/74.2 · 36.5/74.1 | 25.8/59.9 · 25.4/59.2 | 339,312 | 22 / 272 · 22 / 269 |
| 4K | 161.1/170.7 · 161.6/164.9 | 101.0/104.4 · 97.7/104.3 | 731,609 | 22 / 269 · 22 / 267 |

RLE byte数在稀疏样本上看似不大，但每次生成快照都要按 COCO column-major 扫描全幅 8.29M 像素，且 brush / lasso 的报告计算也扫描 before / after。结果是 4K 每次迭代都形成可见 Long Task。XOR tile history 的首要收益是移除全图扫描与复制，而不只是缩小序列化后的 JSON。

## Heap 与资源

| 指标 | 第一轮 | 第二轮 |
|---|---:|---:|
| GC 前基线 | 20.79 MiB | 20.79 MiB |
| 强制 GC 后 | 42.82 MiB | 42.82 MiB |
| GC 后增量 | 22.03 MiB | 22.03 MiB |
| 相对基线峰值临时量 | 34.81 MiB | 34.87 MiB |
| Worker created / terminated | 180 / 180 | 180 / 180 |
| Bitmap created / closed | 66 / 66 | 66 / 66 |

两轮 GC 后增量只相差 332 bytes，信号可重复。`usedJSHeapSize` 不覆盖 GPU bitmap external memory，也可能包含 Vite module 与 committed heap，因此后续门禁必须同时使用 live bitmap、Worker、queue、tile 与 retained bytes 计数，不能只看 heap。

## 5K / 8K 边界

| 场景 | 像素 | 512 tile 网格 | 当前整图 editor 估算 | 当前结果 |
|---|---:|---:|---:|---|
| 5120 × 2880 sparse | 14,745,600 | 10 × 6 | 126.6 MiB | codec 按单边上限拒绝 |
| 7680 × 2160 sparse | 16,588,800 | 15 × 5 | 142.4 MiB | codec 按单边上限拒绝 |
| 8192 × 8192 sparse / dense | 67,108,864 | 16 × 16 | 576 MiB | codec 按单边上限拒绝 |

8K 50% noise 估算约 33,554,432 runs，棋盘格约 67,108,864 runs，均远超 1,000,000 runs 合同。图片 8K 支持因此只承诺可持久化的稀疏 / 普通实心生产内容；不能把“尺寸可达”解释为任意像素熵都可保存。

## 冻结的后续门

1. 保留 canonical COCO RLE 持久格式；图片最大 8192 / 67,108,864 像素，视频与交互式 AI 继续 4096。
2. 大于 4096 单边或 16,777,216 像素时进入 512 tile editor；主线程不得分配整图 alpha、RGBA 或 canvas。
3. Worker pool 按设备档位固定为 1 或 2，queue 最大 32；输入 counts 使用 `Uint32Array` transfer。
4. history 使用 512 tile XOR bitset，最多 100 条并同时受 16 / 32 / 64 MiB 档位预算。
5. 全图扫描超预算时只允许显式 ROI morphology；component、hole、split 等返回稳定原因，不静默回主线程。

这些值的架构理由与替代方案记录在 ADR-0054。高级 morphology / component 的独立 1080p 基线继续参考 [Mask 高级操作基准](./18-mask-advanced-operations-benchmark.md)。
