#!/usr/bin/env bash
# SAM 3 backend 单图真实推理 + 单图显存峰值采样.
#
# Usage:
#   bash apps/sam3-backend/scripts/smoke_predict.sh                  # 全部测试
#   bash apps/sam3-backend/scripts/smoke_predict.sh text             # 仅 text
#   bash apps/sam3-backend/scripts/smoke_predict.sh exemplar         # 仅 exemplar
#   HOST=http://localhost:8002 bash .../smoke_predict.sh             # 自定义 host
#
# 思路: 后台 nvidia-smi 高频采样 (~25Hz) GPU 显存, 同时 curl /predict,
# 取窗口内 max 作为「单图推理峰值」. nvidia-smi 看到的是整卡所有进程的占用,
# 测试前后做 unload/reload 拿到干净基线; Δ = 峰值 − 基线 即推理活动期开销.
#
# 进程内权威值 (torch.cuda.max_memory_allocated) 比 nvidia-smi 更精确但需在
# 进程内查询; 本脚本以 nvidia-smi 为准, 与运维监控口径对齐.

set -euo pipefail

HOST="${HOST:-http://localhost:8002}"
MODE="${1:-all}"
ASSET_DIR="/app/vendor/sam3/assets/images"

require() { command -v "$1" >/dev/null || { echo "missing: $1" >&2; exit 1; }; }
require curl
require nvidia-smi
require python3

baseline_mb() { nvidia-smi --query-gpu=memory.used --format=csv,noheader,nounits | head -1; }

reset_backend() {
  echo "-> unload + reload sam3-backend (拿干净基线)" >&2
  curl -s -X POST "$HOST/unload" >/dev/null
  sleep 1
  curl -s -X POST "$HOST/reload" >/dev/null
  # /reload 是同步重载; 完成时模型已 ready. 再睡 1s 让 caching allocator 收敛.
  sleep 1
}

# run_case <label> <payload>
run_case() {
  local label="$1"; local payload="$2"
  local sample_file; sample_file=$(mktemp)
  local stop="${sample_file}.stop"
  # shellcheck disable=SC2064
  trap "rm -f '$sample_file' '$stop'" RETURN

  (
    while [ ! -f "$stop" ]; do
      nvidia-smi --query-gpu=memory.used --format=csv,noheader,nounits >> "$sample_file"
      sleep 0.04
    done
  ) &
  local sampler_pid=$!
  sleep 0.25
  local sample_baseline; sample_baseline=$(tail -1 "$sample_file")

  echo "=== $label ==="
  echo "  采样基线: ${sample_baseline} MB"

  local resp_file; resp_file=$(mktemp)
  local meta
  meta=$(curl -s -o "$resp_file" -w "%{http_code}|%{time_total}" -X POST "$HOST/predict" \
    -H "Content-Type: application/json" -d "$payload")
  sleep 0.15
  touch "$stop"
  wait "$sampler_pid" 2>/dev/null || true
  rm -f "$stop"

  local http_code="${meta%%|*}"
  local curl_time="${meta##*|}"
  echo "  HTTP=$http_code curl_time=${curl_time}s"

  RESP_FILE="$resp_file" python3 - <<'PY'
import json, os, sys
with open(os.environ["RESP_FILE"]) as f:
    d = json.load(f)
if "detail" in d:
    print(f'  ❌ ERROR: {d["detail"]}')
    sys.exit(0)
r = d.get("result", [])
print(f'  返回 {len(r)} 个目标, inference_time_ms={d.get("inference_time_ms")}ms, model={d.get("model_version")}')
for i, item in enumerate(r[:5]):
    s = item.get("score")
    v = item.get("value") if isinstance(item.get("value"), dict) else {}
    typ = item.get("type", "?")
    # text 路径单 polygon → value.points; geometric 路径多 polygon → value.polygons[].
    if isinstance(v.get("points"), list):
        shape = f'polygon_pts={len(v["points"])}'
    elif isinstance(v.get("polygons"), list):
        # 每个元素是 {"points": [[x,y],...], "holes": [[[x,y],...], ...]}.
        rings = v["polygons"]
        total = sum(len(r.get("points", [])) for r in rings if isinstance(r, dict))
        holes = sum(len(r.get("holes", [])) for r in rings if isinstance(r, dict))
        shape = f'instances={len(rings)} (total_outer_pts={total}, holes={holes})'
    elif "x" in v:
        shape = f'rect=[{v["x"]:.1f},{v["y"]:.1f},{v["width"]:.1f},{v["height"]:.1f}]'
    else:
        shape = '?'
    sline = f'{s:.3f}' if s is not None else "None"
    print(f'    [{i}] type={typ:14s} score={sline} {shape}')
PY
  rm -f "$resp_file"

  local peak min n
  peak=$(sort -n "$sample_file" | tail -1)
  min=$(sort -n "$sample_file" | head -1)
  n=$(wc -l < "$sample_file")
  echo "  显存: 样本=${n}, 区间=${min}~${peak} MB, Δ峰值=$((peak - sample_baseline)) MB"
  echo
}

PAYLOAD_TEXT=$(cat <<JSON
{"task":{"file_path":"$ASSET_DIR/truck.jpg"},
 "context":{"type":"text","text":"truck","output":"both"}}
JSON
)

PAYLOAD_EXEMPLAR=$(cat <<JSON
{"task":{"file_path":"$ASSET_DIR/truck.jpg"},
 "context":{"type":"exemplar","bbox":[0.31,0.22,0.81,0.63]}}
JSON
)

# 健康检查
if ! curl -fs "$HOST/health" >/dev/null; then
  echo "❌ $HOST/health 不可达" >&2
  exit 1
fi

case "$MODE" in
  text)
    reset_backend
    echo "重载后基线: $(baseline_mb) MB"; echo
    run_case "TEXT 'truck' on truck.jpg (1800x1200)" "$PAYLOAD_TEXT"
    ;;
  exemplar)
    reset_backend
    echo "重载后基线: $(baseline_mb) MB"; echo
    run_case "EXEMPLAR fresh on truck.jpg" "$PAYLOAD_EXEMPLAR"
    ;;
  all|"")
    reset_backend
    echo "重载后基线: $(baseline_mb) MB"; echo
    run_case "TEXT 'truck' on truck.jpg (fresh)" "$PAYLOAD_TEXT"
    # 第二轮 exemplar 走 cache 命中, 验证 embedding cache 生效.
    run_case "EXEMPLAR on truck.jpg (cache hit)" "$PAYLOAD_EXEMPLAR"
    reset_backend
    echo "重载后基线: $(baseline_mb) MB"; echo
    run_case "EXEMPLAR fresh on truck.jpg" "$PAYLOAD_EXEMPLAR"
    ;;
  *)
    echo "unknown mode: $MODE (expected: all | text | exemplar)" >&2
    exit 2
    ;;
esac

echo "完成."
