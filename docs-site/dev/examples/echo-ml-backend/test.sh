#!/usr/bin/env bash
# 三连击校验 echo backend 实现了 ml-backend-protocol §1-3 的四个端点。
# 启动 backend 后另起一个 shell 跑此脚本（默认 host=localhost:8000）。

set -euo pipefail

HOST="${HOST:-http://localhost:8000}"

echo "→ GET ${HOST}/health"
curl -sS -f "${HOST}/health"
echo

echo "→ GET ${HOST}/setup"
curl -sS -f "${HOST}/setup"
echo

echo "→ POST ${HOST}/predict"
curl -sS -f -X POST "${HOST}/predict" \
  -H "Content-Type: application/json" \
  -d '{"tasks":[{"id":"task-1","file_path":"s3://bucket/img.jpg"}]}'
echo

echo
echo "✓ echo-backend 全部端点 200。把 ${HOST} 填进项目 ML Backends 即可走通预标注链路。"
