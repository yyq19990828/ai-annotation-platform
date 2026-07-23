# Mask 高级操作 1080p 性能基线

## 结论摘要

高级 Mask 操作的 Worker 路径能避免生产 UI 直接承受同步计算的 Long Task，但 1080p 单次往返仍为约 286–760 ms。当前实现每次操作都创建、传输整幅 RLE 并终止一个 Worker；7 类操作各重复 20 次后，强制 GC 后的页面 heap 仍比基线高约 160 MiB。这是下一阶段优先解决 Worker 复用、transferable Buffer、稀疏 / tile 计算与内存预算的直接证据。

这个结论不等同于已确认的 JS 对象泄漏：`usedJSHeapSize` 会受 Chromium 对已终止 Worker isolate 的回收时机和 heap committed 策略影响。但强制 GC 后仍保留的量级足以作为发布后性能工作的阻断性输入，需要用 Worker 计数器和 heap snapshot 进一步归因。

## 测量方法

- 脚本：`apps/web/scripts/benchmark-mask-operations.mjs`
- 页面：本地 Vite 工作台 `http://localhost:3000`
- 浏览器：Playwright Chromium，headless，启用 precise memory info 和 exposed GC
- 分辨率：1920 × 1080
- 样本：sparse、dense、hole、multi-component
- 重复：2 次预热 + 20 次记录
- 机器：Linux 5.15，Intel Xeon Gold 6238R 2.20 GHz，Node 22.23.1
- 时间：2026-07-22

`main_thread` 是纯算法同步对照；生产大画布路径使用 `worker_round_trip`。Long Task 由 Chromium `PerformanceObserver` 记录，用来量化如果计算留在主线程会造成的阻塞，不代表生产 Worker 路径会产生同样的主线程 Long Task。

## 结果

| 操作           | 样本            | 主线程 p50 / p95 (ms) | Worker 往返 p50 / p95 (ms) | Long Task 次数 / 最大值 (ms) |
| -------------- | --------------- | --------------------: | -------------------------: | ---------------------------: |
| 保留命中组件   | multi-component |          83.7 / 131.2 |              285.9 / 306.1 |                     20 / 132 |
| 删除小组件     | multi-component |           81.7 / 87.6 |              287.2 / 306.1 |                      20 / 88 |
| 填充全部孔洞   | hole            |         230.6 / 249.6 |              467.4 / 478.9 |                     20 / 249 |
| close 圆盘 r2  | sparse          |         552.0 / 574.0 |              725.6 / 735.3 |                     20 / 574 |
| erode 圆盘 r2  | dense           |         134.6 / 145.6 |              289.1 / 330.8 |                     20 / 147 |
| smooth 方形 r2 | multi-component |         186.1 / 191.4 |              409.0 / 759.9 |                     20 / 191 |
| 拆分组件       | multi-component |         245.8 / 327.1 |              449.2 / 464.2 |                     20 / 327 |

所有同步对照在 20 次记录中都触发了超过 50 ms 的 Long Task。sparse close 是当前最慢的算法路径；smooth 的 Worker 往返远高于它的同步计算，表明 Worker 创建、RLE 克隆 / 编解码和结果传输已成为主要成本，不能只优化 morphology 循环。

### Heap

| 指标               |        字节 |   MiB |
| ------------------ | ----------: | ----: |
| 20 次重复前        |  30,111,643 |  28.7 |
| 重复后、强制 GC 前 | 222,132,311 | 211.8 |
| 重复后、强制 GC 后 | 197,977,232 | 188.8 |
| 强制 GC 后增量     | 167,865,589 | 160.1 |
| 测量期间峰值       | 228,828,295 | 218.2 |
| 相对基线峰值增量   | 198,716,652 | 189.5 |

## 后续优先级

1. 把「每操作一个 Worker」改为每个 Mask 编辑会话复用的 Worker，保留 `sessionId + generation + operationId` 取消语义，并为切题 / 卸载显式 terminate。
2. 让 alpha / RLE 正文使用 transferable `ArrayBuffer`，避免每次结构化克隆整幅输入和结果；相同会话内优先传 dirty rect 或 delta。
3. 为 morphology / component / hole 引入 tile 或稀疏 ROI 路径，避免 sparse Mask 仍扫描全部 2,073,600 像素。
4. 建立每会话 Worker 数、输入 / 输出字节、GC 后 retained heap 和连续操作 p95 门禁；用 heap snapshot 判定当前 160 MiB 信号是 Worker isolate 回收延迟还是可达对象泄漏。

## 复现

```bash
pnpm --filter @anno/web mask:operations-bench
```

可用 `RASTER_MASK_BENCH_BASE_URL`、`RASTER_MASK_BENCH_ITERATIONS`、`RASTER_MASK_BENCH_WARMUP`、`RASTER_MASK_BENCH_WIDTH` 和 `RASTER_MASK_BENCH_HEIGHT` 改写运行参数。
