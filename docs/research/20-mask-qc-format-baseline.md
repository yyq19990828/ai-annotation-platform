# Mask QC 与格式消费基线

## 结论摘要

确定性 golden fixture 已冻结单帧拓扑、重叠计算、300 帧时序状态和格式损失码。基线 runner
使用现有 API 环境，在同一进程内对当前 `analyze_mask` 完成 1080p、4K、8192 × 8192
稀疏 Mask 各两轮测量；8K p50 / p95 为 16,383.7 / 16,400.7 ms，进程累计峰值 RSS
为 975.3 MiB。这是当前 dense decode / analyze 路径的诊断基线，不是最终 QC kernel 的性能目标。

现有 `analyze_mask` 的前景连通域是 **4-connectivity**，而冻结合同要求前景 8-connectivity、
背景 4-connectivity。对角相邻的两个前景像素在当前实现中得到 2 个 component，合同期望 1 个。
因此 golden reference 已冻结，但当前 analyzer **尚未满足**该合同；这是后续 QC 实现必须修复的明确差距。

聚合机器数据见 [`data/20-mask-qc-format-baseline.json`](./data/20-mask-qc-format-baseline.json)，
不会保留原始 trace、临时导出包或逐帧副本。

## 冻结合同

- 前景连通性：8-connectivity；背景 / 孔洞连通性：4-connectivity。
- 区域边界：归一化半开区间 `[x0, y0, x1, y1)`。
- 单帧样本：空 Mask、对角连通、孔洞与孤岛、触边与分离 component、单像素桥。
- 重叠样本：冻结面积、交集、并集、IoU 和 containment 的整数分子 / 分母。
- 时序样本：300 帧 × 20 tracks，共 6,000 条记录；覆盖 exact、held、absent、outside、
  occluded、两帧 flicker 和 prediction drift。
- 格式损失：冻结 14 个稳定 loss code，供后续导出 preflight 和 consumer 合同复用。

时序记录的 canonical SHA-256 为
`ddafd7c21f6950c432a6682d1ccdd23d7ba5cd71da7280cc63a40d7a99c0386c`，状态计数为
exact 4,375、held 1,465、absent 10、outside 100、occluded 50。runner 会在输出前校验记录数、
状态计数和 digest，避免 fixture 被无意改写。

## 当前 dense analyze 基线

样本由确定性稀疏 donut 和 detached island 组成，runner 直接生成 uncompressed COCO RLE，
不先构造大尺寸输入 alpha；被测的生产 `analyze_mask` 仍会完整 decode 并执行两次 dense 分析。

| 分辨率 | 像素 | RLE runs | RLE JSON bytes | 两轮耗时 (ms) | p50 / p95 (ms) |
|---|---:|---:|---:|---:|---:|
| 1920 × 1080 | 2,073,600 | 1,075 | 4,016 | 492.3 / 506.1 | 499.2 / 505.4 |
| 3840 × 2160 | 8,294,400 | 2,149 | 9,426 | 2,010.3 / 2,001.4 | 2,005.8 / 2,009.8 |
| 8192 × 8192 | 67,108,864 | 4,587 | 21,360 | 16,402.5 / 16,364.9 | 16,383.7 / 16,400.7 |

峰值 RSS 是进程级累计值，不能拆成单个分辨率的独占内存；它说明当前 8K dense 路径与后续
“QC kernel 不 materialize 全幅 alpha”的目标存在显著距离。后续优化应继续用同一 fixture 对比，
不能通过缩小样本或改变拓扑合同换取数字改善。

## 格式 consumer 小样

同一个 8 × 6、11 前景像素的 donut + island 样本经过以下真实 consumer 校验：

| 合同 | consumer | 校验结果 |
|---|---|---|
| AAP uncompressed COCO RLE | 平台 codec | 像素级 round-trip 通过 |
| COCO instance RLE | `pycocotools.COCO.annToMask` | 11 pixels，通过 |
| Binary PNG | Pillow `L` mode | 11 pixels，通过 |
| Indexed PNG / DAVIS 像素 ID | Pillow `P` mode | instance IDs `[0, 7]`，通过 |
| MOTS RLE line | `pycocotools.mask.decode` | frame / track / class 与 11 pixels，通过 |

所有样例包只写入 `TemporaryDirectory`，consumer 读取完成后目录自动删除；聚合 JSON 中
`temporary_artifacts_retained` 固定校验为 `0`。

## 复现方法

使用 API 已有虚拟环境和依赖：

```bash
cd apps/api
uv run python ../../scripts/benchmark_mask_qc.py --rounds 2
```

只校验 golden、时序 digest 和格式 consumer，不运行大尺寸 dense 基线：

```bash
cd apps/api
uv run python ../../scripts/benchmark_mask_qc.py --skip-dense --json /tmp/mask-qc-check.json
rm /tmp/mask-qc-check.json
```

基线环境为 Python 3.12.11、NumPy 2.4.4、Pillow 12.2.0、Linux x86_64。计时使用
`perf_counter` wall time；机器可读输出只包含聚合结果和复现环境，不包含临时 consumer 包。
