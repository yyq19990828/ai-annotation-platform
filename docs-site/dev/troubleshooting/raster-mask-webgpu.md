---
audience: [dev, ops]
type: troubleshooting
status: experimental
last_reviewed: 2026-07-30
---

# Raster Mask WebGPU 未命中或回退 CPU

## 症状

- 开启实验环境变量后，大 ROI morphology 仍显示 `backend=cpu`；
- 诊断显示 `disabled`、`adapter-unavailable`、`initializing`、`budget-insufficient`、`device-lost` 或
  `gpu-runtime-failed`；
- Linux 部署机器有 NVIDIA GPU，但访问页面的浏览器没有命中 WebGPU。

这些状态都不代表 Mask 计算失败。只要 CPU Worker 成功，XOR patch、undo / redo 与保存语义保持一致。

## 先确认资源边界

WebGPU 运行在访问工作台的用户浏览器中，不运行在 API、Celery、PostgreSQL、对象存储或 ML backend
容器中。服务器有 GPU 不会让远程浏览器取得 adapter；反过来，客户端 MacBook 的浏览器可以使用本机
GPU，而 Linux 服务端完全不参与该计算。

`VITE_EXPERIMENTAL_RASTER_MASK_WEBGPU` 是 Vite build-time 开关：

- 默认 `false`，provider module 不加载，adapter 请求次数为 0；
- 修改 `.env` 后必须重建前端 image；只重启 API 或 Celery 不会改变已生成的浏览器 bundle；
- 该开关不是用户设置，也不会启用 WebCodecs 视频硬件解码。

## 诊断状态

| 状态 / reason                | 含义                                                                                   | 处理                                                                   |
| ---------------------------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `disabled` / `gate-disabled` | 当前前端 bundle 关闭实验 gate                                                          | 如确需试运行，以 `true` 重建前端；否则保持默认                         |
| `initializing`               | adapter / device / pipeline 仍在后台初始化                                             | 当次操作走 CPU；不要让 UI 等待初始化                                   |
| `adapter-unavailable`        | 浏览器无法取得兼容 adapter                                                             | 保留 CPU；检查浏览器、OS、驱动与安全上下文，不把服务端 GPU 当作证据    |
| `below-pixel-threshold`      | ROI 小于 `2048²`                                                                       | 预期行为；小 ROI 使用 CPU 更快                                         |
| `unsupported-operation`      | 不是受支持的 square dilation 或 radius 超界                                            | 预期 CPU 路由，不扩展 shader 前先跑端到端 A/B                          |
| `budget-insufficient`        | compute 预算无法同时覆盖 packed source / XOR result、cache、scratch 与三类 GPU buffers | 缩小 ROI 或保留 CPU；不要绕过准入预算                                  |
| `device-lost`                | 浏览器报告 device 丢失                                                                 | 当前请求回退 CPU，provider 保持 lost；切 task 或重建 pool 后再资格探测 |
| `gpu-runtime-failed`         | submit、map、readback 等运行阶段失败                                                   | 当前请求回退 CPU，provider 不在同一会话反复重试                        |

## 验证默认关闭没有访问 GPU

以默认环境构建后，检查 Raster Mask pool snapshot：

```text
webGpuGateEnabled=false
webGpuState=disabled
counters.initAttempts=0
gpuOwnerWorkers=0
gpuAllocatedBytes=0
baseCacheRetainedBytes=0
sourceScratchCapacityBytes=0
```

即使浏览器以可用的 Vulkan / Metal / D3D adapter 启动，这些字段也必须保持零。若出现初始化次数，说明
gate 被错误地运行时化或 provider 被静态导入，应视为回归。

## 研发 A/B

生产 runner 必须连接带对应 gate 的 Vite 页面：

```bash
pnpm --filter @anno/web mask:webgpu-operation-bench
```

强制 Vulkan 只允许用于研发资格实验，不要写入生产 Chrome 启动参数、Docker 配置或默认 Playwright
项目。结果至少核对 XOR patch checksum、save checksum、Long Task、owner 数、GPU / cache / scratch bytes
plateau 和 dispose 后资源归零；只记录 shader 时间不能作为开启依据。

分段诊断中，成功 GPU 请求应满足：

```text
inputAlphaBytes=0
packedSourceBytes>0
xorReadbackBytes>0
fallbackMaterializeMs=null
prepareStrategy=packed-cache 或 direct-rle
gpuSourceCapacityBytes>0
gpuXorCapacityBytes>0
gpuReadbackCapacityBytes>0
```

`backendPrepareMs` 是构造 packed input 的总时间。进一步按策略读取：

| 字段                                       | 解释                                                                  |
| ------------------------------------------ | --------------------------------------------------------------------- |
| `prepareStrategy=packed-cache`             | 使用 immutable base tile cache 与 word-span assemble                  |
| `prepareStrategy=direct-rle`               | cache 预算不足或被清空，仍走 WebGPU，但直接扫描 RLE 构造 packed input |
| `prepareStrategy=dense-cpu`                | 在 packed prepare 前已决定走 CPU，或没有先尝试 GPU                    |
| `directRleScanMs`                          | direct-RLE 策略扫描 canonical RLE 的时间                              |
| `baseCacheFillMs`                          | 本次 cache misses 从 RLE 填充 immutable tiles 的时间                  |
| `packedAssembleMs`                         | base tile spans 组装到 row-aligned source scratch 的时间              |
| `dirtyOverlayMs`                           | dirty overrides 以 masked overwrite 覆盖 scratch 的时间               |
| `baseCacheHitTiles` / `baseCacheMissTiles` | 本次 ROI 的 base cache 复用与填充数量                                 |
| `baseCacheEvictedTiles`                    | 本次准入为满足硬上限淘汰的 tile 数量                                  |
| `baseCacheRetainedBytes`                   | Worker 当前保留的 immutable cache 字节                                |
| `sourceScratchCapacityBytes`               | grow-only scratch 的实际 capacity；可大于本次 packed payload          |

同一 warm ROI 仍持续 miss，通常表示 session 被反复注册、Worker 被替换、cache 预算无法准入或工作集超过
LRU 上限。先对照 `workersReplaced`、session 数、`prepareStrategy` 和 retained bytes，不要通过提高全局内存
限制来掩盖生命周期问题。50% overlap pan 应只 miss 新进入 ROI 的 tiles；disjoint ROI 第一次全 miss 属于
预期，返回仍在 LRU 内的 ROI 应恢复全 hit。

`gpuUploadSubmitMs` 与 `gpuReadbackMs` 分别表示提交前工作和 map / clone 回读，`diffOrPatchMs` 是 non-zero
XOR words 生成 tile patch 的时间。若 `backend=cpu-fallback`，`fallbackMaterializeMs` 应为非空，表示 GPU
中途失败后惰性重建 dense alpha；普通 gate / capability CPU 路由不应先构造 packed source。

成功 GPU 请求的 `xorOutputStrategy` 应为 `dense-word-scatter`。`xorTotalWords` / `xorNonZeroWords` /
`xorWordDensity` 用于判断 core XOR 稀疏度，`xorChangedPixels` / `xorTouchedTiles` 描述实际 patch 工作量；
`xorScanMs`、`xorPatchAllocateMs`、`xorPatchScatterMs` 与 `wordPatchBuildMs` 用于定位 dense plane 扫描、tile
payload 分配和 byte-span 写入。当前 production 不含 atomic sparse records、overflow 或 record buffer；不要
把缺少 sparse counters 误判为诊断未加载。

## 回滚

将 `VITE_EXPERIMENTAL_RASTER_MASK_WEBGPU=false` 后重建前端。CPU Worker session、主线程 sparse packed
tile、XOR history 与 canonical COCO RLE 保存路径不依赖该 gate，不需要回滚 API 或数据库。Worker 内的
immutable base cache 只在 provider ready 且预算准入后使用；关闭 gate 后 retained cache 与 scratch 应为 0。

## 相关

- [标注模块](../concepts/annotation-module)
- [环境变量](../reference/env-vars)
- [ADR-0056](/dev/adr/0056-raster-mask-persistent-client-compute-session)
