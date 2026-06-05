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

## 其他脚本

- `seed.py` / `seed_pointcloud.py` / `seed_scale.py`:dev 夹具种子
- `import_images.py`:批量导入本地图片到 dataset
- `bootstrap_admin.py`:从 ENV 建超管
- `reset_datasets.py`:清空 datasets + 关联表
- `dump-openapi.py`:导出 openapi.snapshot.json
