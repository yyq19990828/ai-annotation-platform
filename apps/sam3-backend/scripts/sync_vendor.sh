#!/usr/bin/env bash
# 同步 facebookresearch/sam3 到 vendor/sam3/, 固定到指定 commit.
#
# Usage:
#   bash sam3-backend/scripts/sync_vendor.sh <commit-sha>
#
# 默认 commit 见 sam3-backend/README.md "Vendor & 固定 commit" 段;
# 升级 commit 时务必跑 5-clicks 集成验收, 复核 predictor._snapshot_sam /
# _restore_sam 引用的内部字段名 (_features / _orig_hw / _is_image_set / _is_batch)
# 是否仍然存在.

set -euo pipefail

UPSTREAM_REPO="https://github.com/facebookresearch/sam3.git"
COMMIT_SHA="${1:-}"

if [[ -z "${COMMIT_SHA}" ]]; then
    echo "ERROR: commit sha required. Usage: bash sam3-backend/scripts/sync_vendor.sh <commit-sha>" >&2
    exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(dirname "${SCRIPT_DIR}")"
VENDOR_DIR="${BACKEND_DIR}/vendor/sam3"
TMP_DIR="$(mktemp -d)"

echo "==> cloning ${UPSTREAM_REPO} into ${TMP_DIR}"
git clone --filter=blob:none "${UPSTREAM_REPO}" "${TMP_DIR}/sam3"
git -C "${TMP_DIR}/sam3" checkout "${COMMIT_SHA}"

echo "==> wiping previous vendor copy at ${VENDOR_DIR}"
rm -rf "${VENDOR_DIR}"
mkdir -p "${VENDOR_DIR}"

echo "==> rsyncing (excluding .git)"
rsync -a --exclude='.git' "${TMP_DIR}/sam3/" "${VENDOR_DIR}/"

rm -rf "${TMP_DIR}"

echo "==> recording commit:"
echo "${COMMIT_SHA}" > "${VENDOR_DIR}/.commit"

echo "[ok] vendor synced to commit ${COMMIT_SHA}"
echo "    next step: review diff, commit changes, update sam3-backend/README.md commit reference."
