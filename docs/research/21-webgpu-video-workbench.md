# WebGPU 在视频工作台中的适用性调研

> 调研日期：2026-07-25 · Production provider A/B：2026-07-30 · 状态：R1.4 完成，候选后端默认关闭
>
> 目标：判断 WebGPU 能否改善视频精确帧、Konva 合成或 Raster Mask 性能，并明确它与 Linux
> 服务端 GPU、客户端硬件解码之间的边界。

---

## 0. 结论

1. **WebGPU 使用运行网页的客户端机器的 GPU，不会使用 Linux API / Celery 部署机器的
   GPU。** 只有浏览器本身也运行在部署机器上（例如远程桌面、kiosk 或云浏览器）时，二者才是同一块
   GPU。
2. **WebGPU 不能替代 H.264 / HEVC 解码。** 当前链路仍需 `<video>` 或 WebCodecs
   `VideoDecoder` 把码流解成 `VideoFrame`；WebGPU 能做的是导入解码后的帧，再执行缩放、色彩变换、
   滤镜、合成或通用计算。
3. **暂不建议把视频底图从 Konva 迁到 WebGPU。** 当前暂停态要把同一份 `displayBitmap`
   同时交给 Konva、Minimap 和 `captureCurrentFrameJpeg`。若把 WebGPU canvas 再作为
   `Konva.Image` 输入，会多一次 canvas 间同步 / 拷贝；若独立放到 Konva canvas 下方，则必须重建
   viewport 变换、精确帧回执、抓帧与上下文丢失合同。
4. **Raster Mask packed 输入与 core XOR 回读通过工程性能门，但仍不支持默认开启。** production
   Worker 直接从 base RLE 构造 packed ROI、shader 只回读 core XOR 后，`2048²` 两轮 p95 为
   37.7 / 40.9 ms，4K 为 61.4 / 57.0 ms；相对上一条 production provider 分别再改善
   77.5% / 76.6% 与 76.8% / 78.8%。成功 GPU 请求不再分配 input-sized alpha，XOR / save
   checksum、非 32 对齐 core、Long Task 和资源释放均通过；macOS、Wayland、Windows 无 flag 矩阵
   仍阻断默认开启。
5. **WebGPU 不是解决 Linux 服务器 WebCodecs 硬解问题的手段。** 如果确实要让服务端 RTX 3090
   承担视频解码，需要另建 FFmpeg/NVDEC、CUDA 或 GStreamer 服务端路径，并承担帧传输、缓存、并发
   和画面一致性成本；这属于另一套架构。

## 1. 资源边界

| 环节                                          | 执行位置     | 实际使用的资源                                      |
| --------------------------------------------- | ------------ | --------------------------------------------------- |
| chunk 生成、ffprobe sample metadata、对象存储 | Linux 服务端 | 服务端 CPU / 磁盘；显式配置原生转码时可用服务端 GPU |
| chunk 下载、`EncodedVideoChunk` 构造          | 用户浏览器   | 客户端 CPU / 内存                                   |
| WebCodecs `VideoDecoder`                      | 用户浏览器   | 由浏览器选择客户端硬件或软件 decoder                |
| `createImageBitmap`、Konva / Canvas 合成      | 用户浏览器   | 客户端 CPU / GPU，具体由浏览器实现决定              |
| WebGPU shader / compute                       | 用户浏览器   | 客户端 `GPUAdapter` 对应的 GPU                      |

因此，常规部署关系是：

```text
Linux 服务端
  API / chunk / sample metadata / storage
                 │ HTTPS
                 ▼
用户浏览器
  WebCodecs decode → VideoFrame / ImageBitmap → Konva
                         │
                         └─ 可选：WebGPU 后处理 / 合成
```

WebGPU 没有跨网络调用部署机 GPU 的语义。若要调用服务端 GPU，必须由后端提供独立 API 或流媒体
协议，前端只消费结果。

## 2. 当前主机实测

测试环境：

- Google Chrome `150.0.7871.114`
- Ubuntu 22.04，X11
- NVIDIA GeForce RTX 3090
- `http://127.0.0.1` secure context

结果：

| 启动方式                               | `navigator.gpu` | `requestAdapter()` | `VideoFrame` → `GPUExternalTexture` |
| -------------------------------------- | --------------: | -----------------: | ----------------------------------: |
| Chrome 默认启动                        |              有 |    **返回 `null`** |                            不可进入 |
| `--enable-unsafe-webgpu` + 强制 Vulkan |              有 |    NVIDIA / Ampere |                                成功 |

这个结果只证明：

- 浏览器、驱动与 RTX 3090 在强制实验标志下具备 WebGPU 和 `VideoFrame` 外部纹理能力；
- 当前 X11 默认启动不能把 WebGPU 当作可用能力；
- 不安全启动标志只能用于调研，不能成为用户部署要求或生产兜底。

Chrome 当前公开口径是 Linux WebGPU 已逐步推出，而现代 NVIDIA 驱动的扩展支持面向
**Wayland**。这与当前 X11 默认拿不到 adapter 的结果一致，但不能外推到所有 Linux 客户端。

## 3. 可接入位置

### 3.1 替代 WebCodecs 解码

**不可行。** WebGPU 接受 buffer、texture 或已解码的外部图像源，不负责把压缩视频 access unit
解成像素。完整链路仍然是：

```text
MP4 chunk + samples
  → EncodedVideoChunk
  → WebCodecs VideoDecoder
  → VideoFrame
  → WebGPU importExternalTexture
  → shader / GPU canvas
```

WebCodecs 的 `hardwareAcceleration: "prefer-hardware"` 也只是 hint，浏览器可以忽略，不能靠
WebGPU 强制改变 decoder 选择。

### 3.2 消除 `createImageBitmap`

**技术上可做，当前没有收益证据。** `VideoFrame` 可直接导入 `GPUExternalTexture`，理论上能避免
先转 `ImageBitmap`。但项目已有直接 `VideoFrame` A/B：`createImageBitmap` 转换 p95 约
13.2 ms，而可见提交总 p95 仍约 33.6 ms；直接帧路径没有改善可见延迟。

此外，Konva 不能直接消费 `GPUTexture`：

- WebGPU 先画到 canvas、再把该 canvas 交给 `Konva.Image`，会增加一次合成边界；
- WebGPU canvas 独立放在 Konva 标注 canvas 下方，才可能保留低拷贝，但会改变当前显示架构。

因此，除非后续分段指标证明 `lastBitmapMs` 或 media paint 已成为主要瓶颈，不启动这条迁移。

### 3.3 独立 WebGPU 视频底图 canvas

**可行但改动大，优先级低。** 需要同时满足：

- 与 Konva Stage 的 pan / zoom / fit / resize 像素级对齐；
- 暂停态目标帧真正绘制完成后才发布 `paintedFrameIndex`；
- Minimap、当前帧 JPEG、AI 供图仍与用户看到的帧同源；
- 播放态与暂停态平滑切换，无双画面和黑帧；
- `GPUDevice.lost`、adapter 不可用、页面隐藏和显存压力下无缝回退；
- DPR、色彩空间、旋转和非默认 `VideoFrame.displaySize` 一致。

它更适合未来需要对每帧执行滤镜、色彩校正或多路视频合成时再评估，而不是只为绘制一张底图。

### 3.4 Raster Mask 与后处理

**单核 A/B 已通过，适合继续做有界原型。** 候选工作负载：

- 多个 4K / 8K mask 的 alpha 合成与调色；
- morphology、连通域前后处理中的规则并行阶段；
- 质量对比热力图、差异图和大面积笔刷预览；
- 视频帧 + mask + prediction heatmap 的单次 GPU 合成。

已先以 `square dilate r2` 完成同输入 A/B，输出与 CPU golden 逐像素一致。不应据此直接重写现有
Raster Mask Worker；下一步只把 GPU kernel 放进可丢弃的实验 provider，并保留 CPU Worker 作为
无 WebGPU、device lost、小图与不支持操作的稳定路径。

## 4. 项目级决策矩阵

| 方向                          | 预期收益             | 复杂度 / 风险                | 当前建议            |
| ----------------------------- | -------------------- | ---------------------------- | ------------------- |
| WebGPU 取代视频解码           | 无，能力不匹配       | 不可实现                     | 排除                |
| `VideoFrame` → WebGPU → Konva | 低，可能增加拷贝     | 中                           | 不做                |
| WebGPU 独立视频底图 canvas    | 中，适合重后处理     | 高，破坏同帧合同风险大       | 等待明确瓶颈        |
| WebGPU mask compute / compose | 单核收益已超过退出门 | 中高，可保留 Worker fallback | **进入有界原型**    |
| 服务端 NVIDIA 解码            | 可降低客户端解码要求 | 很高，新增传输和并发架构     | 另立服务端 GPU Epic |

## 5. 建议的实验顺序

### R0：只读能力探针

记录但不持久化高熵硬件明细：

- secure context、`navigator.gpu`、adapter 是否可取得；
- `VideoFrame` external texture 是否成功；
- adapter / device 获取耗时、`device.lost`；
- 平台、浏览器主版本和 fallback reason。

默认行为始终 capability-first；没有 adapter 时继续走现有 Canvas / Worker 路径。

### R1：Raster Mask 单核 A/B

选择现有 4K / 8K benchmark 中最慢且可并行的单个操作，不改 UI 合同。至少比较：

- warm p50 / p95；
- 端到端可见延迟，而非只测 shader；
- 首次 adapter + pipeline 编译冷启动；
- CPU 占用、Long Task、显存 / 内存 plateau；
- 小图与大图 crossover；
- device lost 后的 CPU fallback。

建议退出门：

- 目标大图场景端到端 p95 至少改善 **20%**；
- 冷启动不恶化首次可交互体验；
- 无 adapter 与 device lost 均不影响编辑正确性；
- 输出逐像素或按现有容差与 CPU golden 一致。

#### R1 实施与结果

本轮使用隔离的 shader runner 建立计算核上限。生产 provider 接入后，该 runner 已删除，避免
独立 WGSL 与生产语义分叉；聚合数据继续作为历史决策证据保留，当前可重复验证统一使用下文的
production operation runner。

测试环境与约束：

- Chrome `150.0.7871.114`，有头模式，RTX 3090，NVIDIA driver `595.84`；
- X11 默认拿不到 adapter，因此测试显式使用 `--enable-unsafe-webgpu` 与 Vulkan；
- 操作为 `square dilate r2`，输入 / 输出使用每像素 1 bit 的 row-aligned storage buffer；
- WebGPU 总耗时包含主线程 bit pack、GPU upload / dispatch / readback 和 unpack；
- CPU 对照是与 production square morphology 同语义的两 pass kernel；小尺寸 fixture 先与 production
  `applyMaskMorphology` 逐像素校验；
- 两轮各 1 次预热 + 5 次记录，4K / 8K 都在同一浏览器与 device 内顺序执行。

| 分辨率 | CPU kernel p50 两轮 (ms) | CPU p95 两轮 (ms) | WebGPU 总 p50 两轮 (ms) | WebGPU 总 p95 两轮 (ms) |      p95 改善 | parity |
| ------ | -----------------------: | ----------------: | ----------------------: | ----------------------: | ------------: | ------ |
| 4K     |            153.0 / 144.1 |     212.8 / 201.5 |             46.7 / 46.2 |             66.0 / 64.3 | 69.0% / 68.1% | exact  |
| 8K     |          3249.3 / 3530.5 |   4400.8 / 4188.3 |           345.8 / 343.8 |           988.2 / 949.7 | 77.5% / 77.3% | exact  |

分段 p95：

| 分辨率 | bit pack 两轮 (ms) | GPU submit + readback 两轮 (ms) | unpack 两轮 (ms) |
| ------ | -----------------: | ------------------------------: | ---------------: |
| 4K     |        40.0 / 38.4 |                       5.0 / 4.9 |      22.1 / 21.6 |
| 8K     |      132.6 / 128.0 |                     43.3 / 44.3 |    814.3 / 792.9 |

精简聚合数据见
[`data/21-mask-webgpu-single-kernel-ab.json`](./data/21-mask-webgpu-single-kernel-ab.json)。两轮均输出
相同 checksum，4K / 8K GPU 结果与 CPU golden 逐像素一致，满足正确性与 20% p95 退出门。

这个结果仍不是生产 UI 性能承诺：

- adapter + device 冷启动两轮合计约 2.25–3.17 s，不能阻塞首次交互；
- 8K unpack p95 仍接近 0.8 s，说明生产路径不能在主线程反复 materialize 8192² alpha；
- 当前 8K 产品合同是 sparse tile，整图 A/B 只证明计算核上限，不代表应恢复整图 editor；
- production operation 还包含 Worker 往返、before / after analysis、报告与 RLE，这些共享成本会稀释
  kernel 的百分比收益；
- X11 必须强制不安全 Vulkan 才取得 adapter，此结果不能用于默认开启或客户端支持声明。

因此 R1 的结论是 **go to bounded prototype**，不是 go to production。R1.1 继续验证：

1. WebGPU device / pipeline 后台懒初始化，不阻塞首屏；
2. 512 / 1024 tile 与 4K ROI 的 CPU ↔ GPU crossover；
3. pack / unpack 移入 Worker，或让编辑会话直接持有 bitset，避免主线程 8K materialize；
4. `device.lost`、adapter 不可用和任务取消时无缝回到现有 CPU Worker；
5. 把 shared analysis / RLE 成本纳入真实 operation 端到端 A/B。

#### R1.1 Dedicated Worker 与 crossover 结果

有界原型将 CPU 双 pass kernel、bit pack / unpack 和 WebGPU device / pipeline 全部放入
Dedicated Worker，主线程只传递 transferable alpha buffer。独立原型 runner 已在生产接入时
删除；其聚合数据继续保留，当前 runner 直接调用生产 Worker pool、provider 与 sparse store。

两轮各 2 次预热 + 10 次记录，表中是主线程发起请求到 Worker 回传 alpha 的端到端
p95：

| ROI         | CPU Worker p95 两轮 (ms) | WebGPU Worker p95 两轮 (ms) |          p95 改善 | parity |
| ----------- | -----------------------: | --------------------------: | ----------------: | ------ |
| `256²`      |                2.1 / 2.1 |                   4.7 / 4.9 | -123.8% / -133.3% | exact  |
| `512²`      |                3.7 / 4.1 |                   6.2 / 6.0 |   -67.6% / -46.3% | exact  |
| `1024²`     |              23.6 / 24.1 |                 11.4 / 14.9 |     51.7% / 38.2% | exact  |
| `2048²`     |              85.1 / 87.6 |                 31.6 / 33.1 |     62.9% / 62.2% | exact  |
| `3840×2160` |            162.8 / 164.4 |                 57.8 / 64.1 |     64.5% / 61.0% | exact  |

同时验证了运行时合同：

- provider 在首个任务前不创建 Worker，CPU-only 任务不初始化 adapter / device；
- 两轮 adapter + device 冷启动合计约 5.03 s / 5.17 s，pipeline 编译均低于 8 ms；
- 每个 ROI 的 CPU / GPU 结果均逐像素一致，测试期间主线程 Long Task 均为 0；
- 通过真实 `GPUDevice.destroy()` 触发 `device.lost`，后续 WebGPU 请求正确回退 CPU，fallback reason 为
  `device-lost:destroyed`；
- 取消正在执行的任务会终止 Worker，下一个任务会重建 Worker，`dispose()` 后无残留任务或 Worker；
- X11 默认启动下的真实请求得到 `adapter-unavailable`，并保持精确 CPU fallback。

精简聚合数据见
[`data/21-mask-webgpu-worker-crossover.json`](./data/21-mask-webgpu-worker-crossover.json)。

R1.1 给出的是候选路由线，不是生产默认值：

- 低于 `1,048,576` 像素保留 CPU Worker；现有 `512²` sparse tile 不应单 tile 调度 GPU；
- 达到 `1024²` 时可候选 WebGPU Worker；如果实际 ROI 由多个 `512²` tile 组成，应先合并成
  至少 `1024²` 的批次，不要向 GPU 发送四个小任务；
- 约 5 s 冷启动不能阻塞首次编辑，只能在用户即将进入大 ROI 操作时预热，初始化未完成前
  继续使用 CPU Worker；
- 在 macOS / Wayland / Windows 无 flag 矩阵与真实 analysis / RLE 端到端 A/B 通过前，不接入
  production provider，不增加用户开关。

R1.2 表明这条 `1024²` 单核候选线不能用作生产 operation 路由线；纳入共享阶段与尾
延迟后，候选线需上移到 `2048²`。

#### R1.2 生产语义 operation A/B

本轮当时使用独立 operation 原型验证完整共享成本。该原型已由 R1.3 的 production runner
替换，避免实验协议与生产 `morphology_roi` 长期并存；历史聚合数据继续保留。

每个 CPU / WebGPU 请求都执行同一条端到端合同：

```text
512² tile 副本传输
  → Worker 内 materialize 连续 ROI
  → square dilate r2
  → production before/after analysis + operation report
  → production COCO RLE encode
  → alpha + RLE 回传主线程
```

小尺寸 fixture 先与 production `applyMaskOperation` 校验；每个大 ROI 再比较 CPU / GPU 的
alpha、report 和 RLE，三者均精确一致。正式样本为 3 次预热 + 10 次记录：

| ROI         | tiles | CPU 端到端 p50 / p95 (ms) | WebGPU 端到端 p50 / p95 (ms) | p95 改善 | 保守准入字节 |
| ----------- | ----: | ------------------------: | ---------------------------: | -------: | -----------: |
| `1024²`     |     4 |               36.9 / 50.5 |                  31.1 / 41.0 |    18.8% |     9.50 MiB |
| `2048²`     |    16 |             158.4 / 162.7 |                109.4 / 116.3 |    28.5% |    38.00 MiB |
| `3840×2160` |    40 |             297.9 / 302.8 |                205.9 / 210.4 |    30.5% |    75.15 MiB |

4K WebGPU p95 的主要分段为：materialize 15.8 ms、GPU compute 51.5 ms、analysis / report
112.6 ms、RLE 30.7 ms。后两个共享阶段已占端到端 p95 的约 68%，因此继续只优化
shader 的上限很低。

稳定性探针同样改变了决策：

- 两轮短样本中，`2048²` p95 改善 29.2% / 29.4%，4K 改善 33.8% / 33.6%；
- `1024²` 两轮都出现 pack / unpack 尾延迟，p95 比 CPU 慢 96.2% / 108.7%；
- 单独以 4K 预热 3 次后，仍有一个 pack / unpack 尾样本将 p95 改善压到 17.7%；
- X11 默认 adapter 不可用时，完整 operation 以 `adapter-unavailable` 回退 CPU，三重
  parity 仍保持精确；
- 1 MiB 预算测试在 materialize 之前以 `byte-budget-exceeded` 拒绝，没有超额分配。

准入估算覆盖 tile 副本、8 个 alpha-sized 已知 buffer 和 4 份 packed GPU buffer，因此现有
sparse tile 预算下的候选路由为：

| 会话预算 | 可准入的最大已测 ROI | 说明                             |
| -------: | -------------------: | -------------------------------- |
|   32 MiB |              `1024²` | 不满足 WebGPU 端到端退出门       |
|   64 MiB |              `2048²` | 可候选，但仍需尾延迟与客户端矩阵 |
|  128 MiB |          `3840×2160` | 可候选，但仍不是生产默认值       |

聚合数据见
[`data/21-mask-webgpu-production-operation-ab.json`](./data/21-mask-webgpu-production-operation-ab.json)。

R1.2 结论是 **continue optimization, no production integration**：

1. 不沿用 R1.1 的 `1024²` 门槛，只将 `2048²` 作为后续实验候选线；
2. 下一个优化点不是增加 shader，而是让会话持有 packed bitset / GPU buffer，消除每次的
   tile clone、materialize、pack 和 unpack；
3. analysis / report 应改为 dirty ROI 增量计算，RLE 延迟到保存 / idle 阶段，否则 4K 仍有约
   143 ms 的共享下限；
4. 在真实 production provider、长会话内存 plateau 与 macOS / Wayland / Windows 无 flag 矩阵通过前，
   不增加功能开关。

#### R1.3 Production provider、sparse store 与 history A/B

当前 runner 直接加载生产 `RasterMaskWorkerPool`、`SparseMaskTileStore` 与懒加载 WebGPU
provider，不再维护第二份 shader 或消息协议：

```bash
pnpm --filter @anno/web mask:webgpu-operation-bench
```

计时从 store 发起 morphology 开始，到 Worker 返回 exact XOR patches、store 原子应用 patch、
构造 history command 并 retain 为止；计时后执行同一 patch undo，循环结束后走 production merge
验证保存 checksum。正式样本为有头 Chrome、RTX 3090、强制 Vulkan，两轮均为 3 次预热 + 10 次记录：

| ROI         |       CPU p50 / p95 两轮 (ms) |    WebGPU p50 / p95 两轮 (ms) |  p95 改善两轮 | GPU bytes plateau |
| ----------- | ----------------------------: | ----------------------------: | ------------: | ----------------: |
| `2048²`     | 268.8 / 427.5 · 267.8 / 420.9 | 144.4 / 167.2 · 144.9 / 175.0 | 60.9% / 58.4% |         1,572,880 |
| `3840×2160` | 509.6 / 521.5 · 510.1 / 528.4 | 259.0 / 265.2 · 260.2 / 268.9 | 49.1% / 49.1% |         3,145,744 |

两轮都满足生产候选门：

- CPU / WebGPU 的 XOR patch checksum、undo 后保存 checksum 精确一致；
- 记录窗口内 GPU allocated bytes 没有增长，owner Worker 始终为 1；
- 每轮 26 个 CPU job 与 26 个 GPU job，主线程 Long Task 为 0；
- dispose 后 Worker、session、GPU owner 和 allocated bytes 全部归零；
- `1024²` 在真实生产路由中稳定保留 CPU，reason 为 `below-pixel-threshold`。

失败矩阵也使用同一生产 runner：X11 默认 Chrome 在 gate 开启时得到
`adapter-unavailable`，XOR / save parity 保持精确；即使以可取得 adapter 的强制 Vulkan 启动，gate
关闭时仍为 `disabled`、初始化次数 0、GPU bytes 0。provider 单测分别验证 device lost 与 runtime
error 的稳定终态，不允许主动销毁 device 产生的回调覆盖原始错误。

聚合结果见
[`data/21-mask-webgpu-production-provider-ab.json`](./data/21-mask-webgpu-production-provider-ab.json)。

R1.3 决策是 **保留 default-off production candidate**：CPU Worker session 与 XOR patch 是默认
交付；WebGPU 仅在构建期开关启用、客户端 adapter ready、ROI 至少 `2048²`、操作为 square dilate
且字节预算允许时参与路由。Linux 强制 Vulkan 只证明工程可行性，不构成默认 Linux 支持声明；
macOS、Wayland 和 Windows 无 flag 矩阵继续阻断默认开启。

#### R1.4 Packed source 与 core XOR production A/B

R1.3 的成功 GPU 路径仍先从 base RLE materialize dense alpha，再逐像素 pack；回读 full after plane
后又对 core 逐像素 diff。R1.4 保持 store、history 与保存合同不变，只替换 Worker 内部数据路径：

```text
base RLE + dirty packed overrides
  → row-aligned packed input
  → WebGPU square dilate + source XOR
  → core-only XOR words
  → non-zero words / set bits → existing tile history patches
```

provider ready 前先做无分配 preflight。gate 关闭、adapter 不可用、warming、预算不足和不支持操作仍
直接 materialize dense alpha 走 CPU；GPU submit / map / device lost 等中途失败才惰性 materialize alpha
并返回 `cpu-fallback`。source、XOR target、readback 改为独立 grow-only capacity，snapshot 报告实际总和。

同一 RTX 3090、Chrome 150、有头强制 Vulkan 下，两轮均为 3 次预热 + 10 次记录。下表的“相对上一
候选”使用 R1.3 两轮 WebGPU p95 作为固定基线：

| ROI         | R1.3 WebGPU p95 两轮 (ms) | packed XOR p50 / p95 两轮 (ms) | 相对上一候选 p95 改善 | GPU bytes plateau |
| ----------- | ------------------------: | -----------------------------: | --------------------: | ----------------: |
| `2048²`     |             167.2 / 175.0 |      33.5 / 37.7 · 34.9 / 40.9 |         77.5% / 76.6% |         1,572,912 |
| `3840×2160` |             265.2 / 268.9 |      52.4 / 61.4 · 48.3 / 57.0 |         76.8% / 78.8% |         3,145,776 |

候选分段 p95：

| ROI         | packed prepare 两轮 | GPU wall 两轮 | patch build 两轮 | upload / submit 两轮 | readback 两轮 |
| ----------- | ------------------: | ------------: | ---------------: | -------------------: | ------------: |
| `2048²`     |      16.9 / 17.6 ms |  4.8 / 4.0 ms |   10.3 / 10.2 ms |         0.3 / 0.2 ms |  4.4 / 3.9 ms |
| `3840×2160` |      28.8 / 27.4 ms |  6.5 / 6.0 ms |   15.6 / 15.3 ms |         0.5 / 0.6 ms |  6.0 / 5.4 ms |

资格证据同时满足：

- CPU / WebGPU XOR patch checksum 与 undo 后 save checksum 精确一致；
- `(31, 31, 2048, 2048)` 非 32 对齐 core 在 `2112²` 图上命中 WebGPU，并与 CPU exact；
- 每个成功 GPU 样本 `inputAlphaBytes=0`，不再执行 core-wide dense diff；
- source / XOR / readback capacity 分别计账，记录窗口稳定，owner 始终为 1；
- 两轮 Long Task 均为 0，dispose 后 device、buffer、owner、Worker 与 session 归零；
- X11 默认 Chrome 仍以 `adapter-unavailable` 精确回退；gate off 即使强制 Vulkan 可用，也保持
  init attempts 0、GPU bytes 0。

聚合结果见
[`data/21-mask-webgpu-packed-xor-ab.json`](./data/21-mask-webgpu-packed-xor-ab.json)。runner schema
升级后同时输出每个 raw sample 的 prepare、compute、patch、upload / submit、readback、alpha / packed /
XOR bytes 与 buffer capacities，资格结论仍以 operation end-to-end wall time 为准。

R1.4 决策是 **保留 packed XOR production path，继续 default-off**。下一优化点由新的阶段占比触发：
packed prepare 与 patch build 仍大于 GPU wall，但在 macOS / Wayland / Windows 无 flag 矩阵通过前，不
建立 GPU-resident 可写 session、不增加 readback ring、不引入 subgroups，也不扩展 morphology kernel。

#### R1.5 Immutable packed base cache 与有界 ROI assemble

R1.4 每次请求都会重复扫描 immutable column-major RLE。R1.5 在 owner Worker 内增加按 session 隔离的
512² row-aligned packed base tile cache；cache 只表达 canonical base，不保存 current truth。相交 tile 以
word span 组装到 grow-only scratch，本次请求声明的 dirty packed overrides 再以 masked overwrite 覆盖，
既可 set 也可 clear。cache miss、预算不足或 invariant failure 都可使用 direct-RLE packed prepare，不改变
GPU shader、XOR history、CPU fallback 或保存合同。

cache 上限为 `min(32 MiB, computeBudget / 4)`。多个 session 共用确定性 LRU；cache retained bytes、scratch
capacity 与 GPU 三类 buffer 一起进入 provider 的 prospective budget preflight。session release 会移除所属
entries，最后一个 session release、Worker replacement 或 dispose 后所有资源归零。

同一 RTX 3090、Chrome 150、有头强制 Vulkan 下，两轮均为 3 次预热 + 10 次记录，measured core 交替执行：

| ROI         | R1.4 total p95 两轮 |   cache total p50 / p95 两轮 | total p95 改善 | R1.4 prepare p95 两轮 | cache prepare p95 两轮 |  prepare 改善 |
| ----------- | ------------------: | ---------------------------: | -------------: | --------------------: | ---------------------: | ------------: |
| `2048²`     |      37.7 / 40.9 ms | 21.2 / 22.1 · 22.1 / 24.7 ms |  41.4% / 39.6% |        16.9 / 17.6 ms |           2.3 / 2.5 ms | 86.4% / 85.8% |
| `3840×2160` |      61.4 / 57.0 ms | 33.9 / 39.3 · 34.5 / 40.2 ms |  36.0% / 29.5% |        28.8 / 27.4 ms |           6.1 / 6.5 ms | 78.8% / 76.3% |

warm 样本中，2048² 每次命中 16 tiles、4K 每次命中 40 tiles，miss 都为 0。对应 cache / scratch plateau
分别为 512 KiB / 512 KiB 与约 1.49 MiB / 1 MiB。两轮 patch checksum、undo 后 save checksum 精确一致，
Long Task 为 0，owner 始终为 1，dispose 后 GPU、cache、scratch、Worker 与 session 全部归零。

pan 探针进一步区分了复用与偶然抖动：

- 50% overlap 首次移到相邻 core 时命中 16、miss 4，仅填充新进入的 tiles；返回原 core 时 20 hit / 0 miss；
- disjoint 首次移动是 0 hit / 20 miss，返回已缓存 core 后恢复 20 hit / 0 miss；
- 两侧完全 warm 后，overlap / disjoint 交替 p95 分别为 24.4 / 19.9 ms，每个样本均 20 hit / 0 miss；
- 两种 probe 的 CPU / WebGPU patch 与 save checksum 均 exact，Long Task 为 0，dispose 后资源归零。

聚合结果见
[`data/21-mask-webgpu-packed-base-cache-ab.json`](./data/21-mask-webgpu-packed-base-cache-ab.json)。runner schema
升级为 v3，raw samples 保留 warmup / cold / measured phase、core、prepare strategy、RLE scan、cache fill、
assemble、dirty overlay、hit / miss / evict 与 cache / scratch 字节。

R1.5 的 warm prepare、端到端与 cold 门均通过。cold 资格使用同一 candidate bundle、同一 provider，只将
compute budget 降到 `3 MiB` 以准入 dense WebGPU buffers 但绕过 cache；两轮 direct-RLE / cache cold wall
分别为 `128.5 → 130.4 ms` 与 `134.7 → 138.1 ms`，回归 `1.5% / 2.5%`。这种 paired control 避免把不同
dev server 的 Vite 首次编译和调度噪声误记成 cache fill 成本。

封版矩阵还验证了：Linux default X11 无 unsafe Vulkan 时以 `adapter-unavailable` 返回 exact CPU patch；
gate off 即使 Vulkan adapter 可用也保持 init attempts、GPU/cache/scratch bytes 为 0；`3 MiB` cache bypass
保持 `backend=webgpu`、`prepareStrategy=direct-rle`；2048² / 4K、gate off、adapter unavailable 与 bypass
的 save 后 reload checksum 都 exact。provider write failure 注入继续稳定返回 `gpu-runtime-failed`，不误记
device lost。macOS、Wayland、Windows 无 flag 矩阵仍未验证，因此结论仍是 **default-off candidate**。

新分段显示 patch build p95 约 10–16 ms，已超过 warm prepare 与 GPU wall，是下一版唯一值得优先调研的
计算阶段；若设计 GPU sparse XOR compaction，必须保留 bounded capacity、overflow、stable ordering 和
dense XOR exact fallback，不能把 atomic append 当成无界输出。

### R2：视频底图 spike（条件触发）

只有当生产诊断显示 `lastBitmapMs` / `lastPaintMs` 占可见延迟主要部分，或产品明确需要逐帧 GPU
滤镜 / 多层视频合成时启动。必须同时 A/B：

- 当前 `ImageBitmap → Konva`；
- `VideoFrame → WebGPU canvas`；
- Minimap / JPEG capture / 精确帧 painted gate；
- 1080p、4K、播放态和逐帧 seek。

不满足 20% 端到端 p95 收益则删除 spike，不保留双渲染架构。

## 6. 明确的非目标与未验证项

### 非目标

- 不用 WebGPU 替代 `VideoDecoder`；
- 不通过 WebGPU 远程使用 Linux 服务端 GPU；
- 不因本机强制 Vulkan 成功就默认开启；
- 不在缺少 A/B 证据时重写 Konva 视频底图或 Raster Mask Worker。

### 未验证

- Wayland + 现代 NVIDIA 驱动的默认 adapter 和稳定性；
- Windows / macOS / ChromeOS 与 Intel / AMD Linux；
- Firefox / Safari 的项目实际兼容矩阵；
- 真实解码 `VideoFrame` 的零拷贝是否在各平台成立；
- 显存压力和多标签页下的恢复；
- 无实验 flags 的 macOS / Wayland / Windows 实际收益与 adapter 冷启动；
- 真实生产 WebGPU device lost 的浏览器注入矩阵；当前由 provider 状态机单测与早期原型实测分别覆盖；
- 多标签页并行编辑下的总显存压力与恢复；
- 独立 WebGPU canvas 与 Konva 的色彩、DPR 和抓帧一致性。

## 7. 参考资料

- [W3C WebGPU Candidate Recommendation Draft](https://www.w3.org/TR/webgpu/)
- [W3C WebCodecs](https://www.w3.org/TR/webcodecs/)
- [Chrome：From WebGL to WebGPU — Video frame processing](https://developer.chrome.com/docs/web-platform/webgpu/from-webgl-to-webgpu)
- [Chrome：WebCodecs `VideoFrame` 与 WebGPU 集成](https://developer.chrome.com/blog/new-in-webgpu-116)
- [Chrome：Linux NVIDIA WebGPU 支持范围](https://developer.chrome.com/blog/new-in-webgpu-147-148)
