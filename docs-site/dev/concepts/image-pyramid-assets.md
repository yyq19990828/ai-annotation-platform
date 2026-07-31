---
title: 超大图金字塔派生资产
audience:
  - backend
  - frontend
  - platform
---

# 超大图金字塔派生资产

图片金字塔把超大源图转换为可按视口加载的 overview 和 tile。它是服务端派生资产：源图片和标注坐标仍是
权威数据，金字塔可重建，不能反向覆盖 source。

当前图片工作台尚不消费 tile；Task API 已提供稳定合同，供客户端切换时复用。

## 所有权与代次

`image_pyramid_assets` 表示稳定 owner：

- DatasetItem 来源以 DatasetItem 为 owner，多个 Task 共用一份资产；
- 未关联 DatasetItem 的 direct Task 以 Task 为 owner；
- owner 与 `profile_version` 唯一，数据库约束保证两种 owner 恰有一个非空。

`image_pyramid_generations` 表示一次不可变生成：

```text
pending → building → ready
                    └→ failed
```

同一 asset 同时最多有一个 pending/building generation。Worker 在所有对象上传和校验成功后，才在事务中
更新 `active_generation`。同源重建时旧 active 可继续提供服务；源被替换后旧 active 立即失效，避免旧像素
与新坐标叠加。

对象布局是服务端实现细节：

```text
image-pyramids/{asset_id}/g{generation}/
  manifest.json
  overview.webp
  tiles/{level}/{x}/{y}.webp
```

## 源身份与规范化

快速 source fence 由对象 ETag、字节数和可用的 version ID 组成。Worker 同时在流式下载时计算 SHA-256，
作为 manifest 的内容 fingerprint。生成前和发布前都会再次验证快速身份，覆盖生成期间源对象被替换的竞态。

规范化 profile 的合同为：

- 应用 EXIF autorotate，输出宽高是旋转后的逻辑尺寸；
- 有 ICC profile 时转换为 sRGB，否则把非 sRGB interpretation 转为 sRGB；
- 灰度转成 sRGB，alpha 保留；
- 多页图片拒绝，不静默选择任意页；
- 数据库已有逻辑尺寸与生成结果不同时稳定失败，不改变已有标注坐标。

生产生成器是 pyvips/libvips。Pillow 只用于小图缩略图、header probe 和测试 oracle，不是超大图生成兜底。

## Manifest 合同

manifest schema 是 `aap-image-pyramid/v1`：

- level 按 full-resolution-first 排列，`scaleFactor` 为二次幂；
- core tile 为 512×512，存储 tile 允许 1px overlap；
- edge 宽高、columns 和 rows 都由整数 ceil 规则显式计算；
- tile 使用 WebP；
- manifest 包含 generation、规范化版本和内容摘要；
- manifest 不包含 bucket、存储 key、host 或签名 URL。

客户端不得依赖对象前缀，也不得从 tile 坐标自行拼存储 key。

## API 边界

Task 列表和详情只附带 `image_pyramid` 轻量摘要，不附完整 levels 或 URL。

```text
GET  /api/v1/tasks/{task_id}/image-pyramid
POST /api/v1/tasks/{task_id}/image-pyramid/asset-urls
POST /api/v1/tasks/{task_id}/image-pyramid/retry
```

GET 返回状态 envelope；ready 时返回 manifest 和短期 overview URL，并支持 `ETag`/`If-None-Match`。
`asset-urls` 最多接受 128 个 overview/tile 逻辑请求，去重后按首次出现顺序返回。服务端验证 Task 可见性、
generation、level/grid 坐标和对象存在性，再统一签发到期时间。

对象缺失或 source fence 不匹配时，不返回 URL，并把 active generation 标记为不一致或陈旧。retry 对
pending/building 是幂等的，对失败请求有冷却和频率限制。

## 资源与生命周期

专用 Celery Worker 订阅 `image-pyramid` 队列，初始并发为 1。生成流程按以下顺序执行：

```text
取得 DB lease
  → 流式下载到有界临时文件
  → libvips 规范化并生成
  → 校验完整网格、edge 尺寸和摘要
  → 上传 tile 与 overview
  → 最后上传 manifest
  → 事务发布 active generation
```

像素、单边尺寸、source/derived/temp bytes、tile 数和 wall time都有硬限制。每日 reconciliation 回收过期
lease、非 active 旧代次和孤儿前缀。source 或 owner 删除时同步清理对应派生对象；`image-pyramids/`
不使用普通媒体缓存的固定期限 lifecycle。

相关运维步骤见[图片金字塔运行手册](/ops/runbooks/image-pyramid)。
