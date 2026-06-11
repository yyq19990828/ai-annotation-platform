# apps/api/scripts

Dev / ops 用一次性 / 周期性脚本,各自带 `--help`。

## backfill_scenes (v0.14.0)

对历史 dataset 补 `scene_id` + `frame_index`(跨 task 帧序列地基)。

```bash
cd apps/api

# 1 个 dataset
PYTHONPATH=. uv run python scripts/backfill_scenes.py --dataset-id <uuid>

# 所有"无 scene"的 dataset(批量)
PYTHONPATH=. uv run python scripts/backfill_scenes.py --all-missing

# 预览(不写库)
PYTHONPATH=. uv run python scripts/backfill_scenes.py --all-missing --dry-run

# 显式指定 mode(默认 auto)
PYTHONPATH=. uv run python scripts/backfill_scenes.py --dataset-id <uuid> --mode single
```

**幂等**:已有 scene → 跳过(notes 提示);部分 items 有 scene_id → 跳过("partial migration",人工 review)。

**不在 docker 启动时自动跑**——管理员人工 review 后执行。

## import_nuscenes_scene (v0.14.2)

把 nuScenes-mini 的一个/多个 scene 转成本平台点云原生目录 + 入库(MinIO + DB)。
**按 scene name 显式建多 scene**(每个 scene 一个顶层子目录),显式调用 v0.14.0 的
scene service 建 scene + 赋 frame_index,不依赖目录启发式 single-scene inference。
不引入 nuscenes-devkit,只用 numpy + Pillow 自读 JSON。

数据下载:https://www.nuscenes.org/nuscenes#download (取 Mini split)。

```bash
cd apps/api

# 单 scene
uv run python scripts/import_nuscenes_scene.py \
    --nuscenes-root /data/nuscenes-mini --scene-tokens scene-0061 \
    --dataset-name nu-scene-0061

# 多 scene 共用 dataset(验证 v0.14.0 多 scene 隔离)
uv run python scripts/import_nuscenes_scene.py \
    --nuscenes-root /data/nuscenes-mini \
    --scene-tokens scene-0061,scene-0103,scene-0553 --dataset-name nu-mini-multi
```

`--scene-tokens` 实际匹配 scene.json 的 `name` 字段(如 scene-0061)。**幂等**:
dataset 按 DS-NU-<name> 复用;同名 scene 已存在则跳过。详见脚本顶部 docstring 的手动测试 checklist。

## 其他脚本

- `seed.py`:dev 账号 + 调用下方各夹具种子(图片 coco8 + 点云 SUSTech/nuScenes),不再造假项目
- `seed_coco8.py`:真实 `third-party/coco8`(8 图)→ 图片检测项目 + 每图 Task + YOLO 框走 `import_yolo` 作**预标注**导入(非人工标注)
- `seed_pointcloud.py`:SUSTechPOINTS 点云 demo + `third-party/nuscenes-mini` scene-0061 → scene 模式项目并按 scene 建包(by_scene split)
- `seed_scale.py`:大规模压测夹具种子
- `import_images.py`:批量导入本地图片到 dataset
- `bootstrap_admin.py`:从 ENV 建超管
- `reset_datasets.py`:清空 datasets + 关联表
- `dump-openapi.py`:导出 openapi.snapshot.json
