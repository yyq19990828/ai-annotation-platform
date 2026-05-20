# 导出标注 / 导入预标注 深度优化（异步化 + 目录镜像）

> **性质：设计计划（待实现）。** 调研 + 决策已定型，按本文分阶段落地。本期范围限 **image**，video / lidar 留后续窗口。
> 调研日期：2026-05-20。驱动：导出完全同步存在生产级内存/超时风险 + 导出产物扁平化丢失递归目录（含同名覆盖导致的静默数据丢失）。

---

## 1. 现状定性（调研结论）

### 1.1 导出 `apps/api/app/services/export.py`

- 4 格式：COCO(`export_coco` 299-420) / YOLO(`export_yolo` 422-479) / VOC(`export_voc` 481-535) / AAP JSON v1.1(`export_aap_json` 537-651)。
- 入口：`GET /projects/{id}/export`（`api/v1/projects.py:708`）、`GET /.../batches/{bid}/export`（`api/v1/batches.py:843`）。参数 `format` / `include_attributes` / `video_frame_mode`。
- **完全同步**：`_load_data()`（93 行）一次性把项目全部 task+annotation 拉进内存，`async def` 直接在路由 `await`，拼完整 ZIP/JSON 后 `Response(content=...)` 流返回。**无分页 / 无流式 / 无 Celery / 不落对象存储**。大项目（万级 task）→ 内存暴涨 + 请求超时。**ROADMAP 此前漏列。**
- **产物扁平化 bug**：YOLO 用 `base = t.file_name.rsplit(".",1)[0]` → `labels/{base}.txt`；VOC 同理只用 `t.file_name`。`file_name` 只存叶子名，**丢失递归目录**。不同子目录同名文件（`animals/cat/001.jpg` 与 `animals/dog/001.jpg`）→ 两者都写 `labels/001.txt`，**第二个静默覆盖第一个 = 数据丢失**。
- **硬编码尺寸 bug**：`export.py:41` `IMG_W, IMG_H = 1920, 1280`，COCO(`371-388`) / VOC(`503-521`) 用常量算像素坐标。真实尺寸其实存在 `DatasetItem.width/height`（`db/models/dataset.py:52`+），只是没用。

### 1.2 导入预标注 `apps/api/app/services/predictions_import.py`

- 端点 `POST /projects/{id}/predictions/import`（`api/v1/predictions.py:258-377`），支持 COCO + AAP JSON。
- 架构成熟：同步端点 + `async_jobs` 追踪（kind=`predictions_import`）+ `dry_run` 全路径校验 + geometry 适配层（`internal_geometry_to_ls_shape` 46-143）复用 `PredictionService.create_from_ml_result`。lenient 容错（错误进 `errors[]` 不整批失败）。
- 前端 `PredictionImportWizard.tsx`（三步：选格式/文件 → dry-run 预览 → 提交），`predictionsApi.import` 走 multipart。
- 缺口：仅按 `image.file_name` ↔ `task.file_path` 匹配（`task_matcher.resolve_task`，display_id 优先 + file_path fallback），**未按相对目录匹配**；同名跨目录会误匹配。

### 1.3 存储层 `apps/api/app/services/storage.py`（健康，可直接扩展）

- 已是多桶模式：`annotations` / `datasets` / `bug-reports` / `media-cache` / `audit-archive`。
- 现成能力：`ensure_bucket` / `ensure_all_buckets` / `_ensure_lifecycle`（已有按前缀 90d/180d/30d 规则）/ `generate_upload_url` / `generate_download_url`（预签名）/ `list_objects`（分页）/ `_public_url`（内网→公网替换）。
- **新增 import/export 桶 + 7 天 lifecycle 只是同模式小扩展。**

### 1.4 数据模型关键事实

- `DatasetItem.file_path = key`（**完整 MinIO key，保留嵌套**，web 上传 / `scan_and_import` 路径，`dataset.py:298`），`file_name` 只存叶子名。
- `tasks.file_path`（String 1000）/ `file_name`（String 500）/ `dataset_item_id` FK → 可 join 拿 `width/height`。
- **MinIO/S3 本质扁平 KV，没有真目录**；key 里的 `/` 是普通字符，"文件夹"是控制台按前缀渲染的视觉假象。**MinIO 完全能保留嵌套**（key 写成 `animals/cat/001.jpg` 即可），拍平是我们代码的选择，且两条入口不一致：
  - Web / `scan_and_import`：`file_path = key` ✅ **保留嵌套**。
  - CLI `import_images.py:111`：`storage_key = f"{folder}/{img_path.name}"` ❌ **拍平**（只取叶子名）。

---

## 2. 核心决策（本次对齐）

1. **导出异步化**：转 Celery worker + `async_jobs` 追踪（复用导入端已验证模式）+ 产物落 MinIO `export` 桶 + 返回预签名下载 URL + 前端轮询/进度。
2. **新建两个 MinIO 桶**：`import` / `export`，**7 天 lifecycle**（产物短生命周期）。桶内按 `image / video / lidar` 分层（三种模态导出内容有偏差），**本期只做 image**。
3. **导出产物 = 仅 labels 镜像目录 + 按需回源脚本**（不打包图片本体）：
   - 理由：体积小、桶生命周期压力小、尊重"用户本地可能已有数据集"。
   - 布局：
     ```
     {project_display_id}_export.zip
     ├── {project_id}/{dataset_id}/labels/animals/cat/001.txt   ← 镜像 file_path 去前缀的相对路径
     ├── {project_id}/{dataset_id}/labels/animals/cat/001.attrs.json  (include_attributes 时)
     ├── classes.txt
     ├── attribute_schema.json
     ├── data.yaml                ← YOLO 训练入口，images/labels 路径已配好
     ├── images_manifest.json     ← 每张图 {相对路径, dataset_id, presigned_url(7天)}
     └── fetch_images.py          ← 跑它把图片拉成 images/<同相对路径> 平行树
     ```
   - `fetch_images.py` 读 `images_manifest.json` 的**预签名 URL**（7 天有效 = 桶生命周期，用户无需配 MinIO 密钥）；下载到 `images/` 与 `labels/` 严格平行 → 即取即训。本地已有图则不跑。
4. **相对路径真值**：`file_path` 去掉 dataset 名前缀（`{dataset}/animals/cat/001.jpg` → `animals/cat/001.jpg`），换扩展名落 `labels/`。**绝不用 `file_name`**（丢目录 + 同名覆盖）。
5. **VOC 前端隐藏**：太少用 + 硬编码尺寸本身有 bug。后端 `export_voc` 暂留（不删，避免破坏 API 契约），仅前端 `ExportSection` 下拉摘掉选项。
6. **导入端对称**：`predictions/import`（及未来 `annotations/import`）应支持**按相对目录路径匹配** task，与导出镜像形式一致。
7. **连带必修**：CLI `import_images.py` 改为 `relative_to(image_dir)` 保留相对路径——否则入口拍平后库里无嵌套可镜像，导出再用心也只能还原平铺。Web/scan 路径已 OK 无需改。

---

## 3. 分阶段落地清单

### 阶段 1 · 存储基建（无行为变化，可独立先发）

- `config.py` + `.env.example`：`MINIO_IMPORT_BUCKET=import` / `MINIO_EXPORT_BUCKET=export`。
- `storage.py`：纳入 `ensure_all_buckets` / `list_all_buckets`；`_ensure_lifecycle` 给两桶各挂整桶 **7 天** Expiration 规则（复用现有 try/except 静默降级）。
- 健康检查 / 桶用量统计（`summarize_bucket`）自动覆盖新桶（已通过 `list_all_buckets`）。

### 阶段 2 · 导出异步化（后端）

- 新 `apps/api/app/services/export_packaging.py`（或扩 `export.py`）：
  - `relative_path_from_file_path(file_path, dataset_name) -> str`：去前缀拿相对路径（核心 helper，导出 + 导入共用）。
  - YOLO/COCO/AAP 写 label 时用相对路径镜像；按 `project_id/dataset_id/labels/<rel>` 组织。
  - 生成 `data.yaml` / `images_manifest.json`（含预签名 URL，7 天）/ `fetch_images.py`（模板脚本，纯 stdlib）。
  - COCO/VOC 像素坐标改用 `DatasetItem.width/height`，缺失再回退常量（顺手修硬编码 bug）。
- 新 `apps/api/app/workers/export.py`：Celery 任务 `run_export(project_id, batch_id, format, opts)` → 调 service 生成 ZIP → `put_object` 到 `export` 桶 key `image/{project_id}/{job_id}.zip` → 写 `async_jobs` 进度/结果（含预签名下载 URL）。路由进 `default` 或新 `export` 队列（注意 v0.10.25 的 `task_routes` 显式路由坑，别落无人消费的 `celery` 队列）。
- 端点改造：`/projects/{id}/export` 与 `batches/{bid}/export` 从同步流式改为**创建异步 job → 返回 job_id**；新增 `GET /export-jobs/{id}` 查状态/下载 URL（或复用现有 async_jobs 查询端点，需核对是否已有）。
- 小项目可保留同步快路径（阈值如 task 数 < N 直接返回），避免轻量导出也走队列——**待定，见开放问题**。

### 阶段 3 · 前端

- `ExportSection.tsx`：下拉移除 VOC；导出从「直接 blob 下载」改为「发起 job → 轮询进度 → 出下载链接」（复用导入 Wizard 的 async_jobs 轮询/进度组件）。
- `ExportFormat` 类型移除 `"voc"`（或仅 UI 隐藏，类型保留兼容）。

### 阶段 4 · 导入对称 + 连带

- `import_images.py`：`storage_key` 改用 `img_path.relative_to(image_dir)` 保留相对路径（dev 脚本，改动小但必须同步）。
- `task_matcher` / `predictions_import`：支持按相对目录路径匹配（与导出镜像一致），消除同名跨目录误匹配。
- （可选，独立）`POST /annotations/import`：打通 AAP JSON round-trip——ROADMAP 既有 P3 项，本计划不强绑，视需要单独评估。

---

## 4. 开放问题（实现前需拍板）

1. **小项目同步快路径阈值**：是否保留？阈值定多少 task 数？还是一律走异步求一致性。
2. **导出 job 去重 / 缓存**：一周内同 (project/batch, format, params) 重复导出，是否复用已有产物（按 annotation 最大 updated_at 做 cache key），还是每次重生成。
3. **预签名 URL 有效期 vs 桶 lifecycle**：URL 7 天 = 桶 7 天，临界点（第 7 天图片被清而 URL 仍"有效"）如何提示用户？manifest 里写 `expires_at` + 脚本启动校验。
4. **`export` 队列归属**：新开 `export` 队列还是复用 `media`/`default`？需同步 `celery_app.py` 的 worker 订阅列表与 `task_routes`。
5. **batch 导出的 dataset 分层**：跨多 dataset 的 batch，`{project_id}/{dataset_id}/` 分层是否够，还是再按 batch 细分。

---

## 5. 后续窗口（本期不做）

- **video / lidar 导出形态**：MOT/KITTI/DAVIS（ROADMAP §C R22）、lidar 点云格式——两种模态导出内容与 image 偏差大，桶内 `video/` `lidar/` 前缀已预留。
- **`POST /annotations/import`**（AAP JSON annotations round-trip，ROADMAP §A P3）。
- **Task `external_id`**（跨实例稳定匹配，ROADMAP §A P3）。
- **COCO importer `image_size_hint` 参数化**（ROADMAP §A P3）。
