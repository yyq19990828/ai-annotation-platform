# 多几何 track 剩余切片索引

状态：**规划索引（2026-07-12，基于 `v0.21.30` 代码勘察）**。承接
[`v0.21.20` 多几何 track 母计划](2026-07-05-v0.21.20-multi-geometry-track.md)，只维护剩余切片之间的边界与依赖；
每个版本的实施合同、验收和非目标均在独立计划文件中。

## 独立版本计划

| 版本 | 主题 | 状态 | 计划 |
|---|---|---|---|
| `v0.21.31` | 已交付 `yolo-frames-seg` 的用户入口与文档事实同步 | 可直接开发 | [计划草案](2026-07-12-v0.21.31-yolo-frames-seg-ui-reachability.md) |
| `v0.21.32` | polyline track AI 中心线传播 | **已取消，不实施** | [否决记录](2026-07-12-v0.21.32-polyline-track-ai-propagation.md) |
| `v0.21.33` | 视频逐帧 COCO segmentation | 已解闸门（COCO API 标准），可开发 | [计划](2026-07-12-v0.21.33-coco-frames-seg.md) |
| `v0.22.0` | 真·栅格 mask track、tracker 原始 mask 回填、DAVIS | 已实施 | [实施计划](2026-07-12-v0.22.0-raster-mask-track-davis.md) |

## 当前能力校准

| 能力 | bbox track | polygon track | polyline track | raster mask track |
|---|---:|---:|---:|---:|
| schema / compact keyframes | 已有 | 已有 | 已有 | `coco_rle_ref` |
| 绘制 / 当前帧编辑 | 已有 | 已有 | 已有 | 笔刷 / 橡皮 |
| 帧间解析 | 线性插值 | 闭环弧长重采样 | 开路径弧长重采样 | nearest hold |
| AI 传播 | 已有 | 已有 | **明确不支持，保留 400** | SAM2 / SAM3 原始 mask |
| 候选预览 | bbox | polygon | polyline 不支持 AI | alpha mask |
| bbox-only 导出 | 原样 | 外接框降级 | 外接框降级 | RLE AABB 降级 |
| 视频分割导出 | 不适用 | YOLO / COCO | 跳过（开放路径） | COCO RLE / DAVIS |
| 导出 UI | 可达 | YOLO / COCO 可达 | 不适用 | DAVIS 可达 |

## 跨版本固定边界

- 保留 bbox / polygon / polyline / mask 平行 geometry 变体，不重构成大一统 `shape`。
- 视频 COCO 使用独立 target `coco-frames-seg`，不复用图片 `coco` 的跨模态含义。
- polyline AI 已取消：现有模型不原生追踪开放折线，mask 骨架化方案不作为通用平台能力；保留 400，等待明确垂直模型触发。
- mask 继续归 `region` tool unit；不新增类别 / 属性孤岛。
- raster mask 的真实尺寸基准已触发体积闸；`v0.22.0` 使用内容寻址 `coco_rle_ref`，不把逐帧 RLE 内联进无限增长的 JSONB。
- mask 不做 optical-flow / morphing；采用 nearest-keyframe hold，`outside` 优先。
- 单帧 `video_mask`、非 bbox track 的完整 convert / split / merge / join、AAP predictions importer 重构均不属于本组版本。

## 依赖关系

```text
v0.21.31 yolo-frames-seg UI 可达（已交付）
    └── v0.21.33 coco-frames-seg（已解闸门：COCO API 标准）

v0.22.0 mask 合同与体积闸
    └── schema/read path
          ├── 前端 render/edit
          └── backend 原始 mask output
                └── candidate/accept + DAVIS
```

`v0.21.32` 已取消，不再作为任何版本的依赖；`v0.21.33` 不阻塞 `v0.22.0`，后者只在前者已经交付时顺带扩 COCO RLE
mask annotation。mask 所需 geometry-kind dispatch 由 `v0.22.0` 自身按实际合同实现。
