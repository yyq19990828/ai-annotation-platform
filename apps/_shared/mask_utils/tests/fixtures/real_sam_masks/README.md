# real_sam_masks — eval_simplify 评测数据集

> 用于 `scripts/eval_simplify.py` 评测 `mask_to_polygon` 在不同 tolerance 下的 IoU + 顶点数。

## 当前内容（v0.9.4 phase 3 落，2026-05-08）

- **`real_sam_*.png`** 84 张：30 帧 cpc0-R 1920×1080 沙盘视频 × **DINO+SAM text 模式** 3 文本 prompts（`car` / `person` / `building`，DINO scores 0.85-0.97）。命名 `real_sam_{frame_idx}_{prompt}.png`。
- **`synthetic_*.png`** 6 张：圆（大/小）、椭圆、半月、三角、organic blob —— 凸/凹/复杂边界 baseline。

## 真实 SAM mask 采集流程（已用过一次的实际命令）

```bash
# 1. 拿 SAM backend 起着 (GPU profile)
docker compose --profile gpu up -d grounded-sam2-backend
curl -fsS http://localhost:8001/health   # 确认 loaded=true

# 2. 从 MinIO 拷 N 张样本图 (跨 stride 取均匀分布)
mkdir -p /tmp/sam_eval_inputs && i=0
docker exec ai-annotation-platform-minio-1 mc ls --recursive local/datasets/<DATASET>/ \
  | grep -E '\.jpg$' | awk '{print $NF}' | awk 'NR%2==0' | head -30 \
  | while read -r key; do i=$((i+1)); \
      docker exec ai-annotation-platform-minio-1 mc cp "local/datasets/<DATASET>/$key" "/tmp/$key" >/dev/null 2>&1; \
      docker cp "ai-annotation-platform-minio-1:/tmp/$key" "/tmp/sam_eval_inputs/img_$(printf '%02d' $i).jpg"; \
    done

# 3. 推进 SAM 容器 → 跑 dump 脚本 (DINO + SAM text 模式; 见 dump_text.py 附录)
docker exec ai-annotation-platform-grounded-sam2-backend-1 mkdir -p /app/eval_inputs /app/eval_masks
for f in /tmp/sam_eval_inputs/*.jpg; do
  docker cp "$f" "ai-annotation-platform-grounded-sam2-backend-1:/app/eval_inputs/$(basename $f)"
done
docker cp scripts/dump_text.py ai-annotation-platform-grounded-sam2-backend-1:/app/dump_text.py
docker exec ai-annotation-platform-grounded-sam2-backend-1 python /app/dump_text.py

# 4. 拷 mask png 出来到 fixtures
docker exec ai-annotation-platform-grounded-sam2-backend-1 sh -c "cd /app/eval_masks && tar cf - real_sam_*.png" \
  | tar xf - -C apps/_shared/mask_utils/tests/fixtures/real_sam_masks/

# 5. 重跑评测
uv run --project apps/_shared/mask_utils python scripts/eval_simplify.py \
    --masks-dir apps/_shared/mask_utils/tests/fixtures/real_sam_masks \
    --tolerances 0.5,1.0,2.0,3.0,5.0 \
    --out docs/research/13-simplify-tolerance-eval.md
```

> **采集 prompt 选择经验**（v0.9.4 phase 3 踩坑）：
> - ❌ 「中心 60% bbox」prompt 在大场景图（1920×1080 多对象沙盘）出 IoU mean 0.54 — bbox 覆盖太多杂物
> - ✅ DINO+SAM **文本 prompt** 出 IoU mean 0.98 — 与工作台 `S` 工具 text 模式真实使用对齐
> - 单图取多个文本 prompt 提升样本多样性（同图 3 物体 → 3 种边界复杂度）

## 文件协议

每张 PNG **单通道二值** mask：
- 0 = 背景，非零 = 前景
- 任意尺寸（脚本自动按 mask shape 算 IoU）
- 文件名仅用于报告 traceability，不影响评测逻辑

## 评测复现

```bash
cd ai-annotation-platform
uv run --project apps/_shared/mask_utils python scripts/eval_simplify.py \
    --masks-dir apps/_shared/mask_utils/tests/fixtures/real_sam_masks \
    --tolerances 0.5,1.0,2.0,3.0,5.0 \
    --out docs/research/13-simplify-tolerance-eval.md
```

## .gitignore 策略

> 当前 6 张合成 mask **commit 进库**（< 30KB 总），作为 first-commit 骨架样本。
> 真实 SAM mask 大批量采集时若超 ~500KB 总，按需 `.gitignore '!synthetic_*.png'` 仅留合成占位。
