#!/usr/bin/env bash
# 同步 IDEA-Research/Grounded-SAM-2 到 vendor/grounded-sam-2/, 固定到指定 commit.
#
# Usage:
#   bash scripts/sync_vendor.sh <commit-sha>
#
# 默认 commit 见 README.md "Vendor & 固定 commit" 段; M0 选定后更新 ROADMAP/[archived]0.9.x.md.

set -euo pipefail

UPSTREAM_REPO="https://github.com/IDEA-Research/Grounded-SAM-2.git"
COMMIT_SHA="${1:-}"

if [[ -z "${COMMIT_SHA}" ]]; then
    echo "ERROR: commit sha required. Usage: bash scripts/sync_vendor.sh <commit-sha>" >&2
    exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(dirname "${SCRIPT_DIR}")"
VENDOR_DIR="${BACKEND_DIR}/vendor/grounded-sam-2"
TMP_DIR="$(mktemp -d)"

echo "==> cloning ${UPSTREAM_REPO} into ${TMP_DIR}"
git clone --filter=blob:none "${UPSTREAM_REPO}" "${TMP_DIR}/grounded-sam-2"
git -C "${TMP_DIR}/grounded-sam-2" checkout "${COMMIT_SHA}"

echo "==> wiping previous vendor copy at ${VENDOR_DIR}"
rm -rf "${VENDOR_DIR}"
mkdir -p "${VENDOR_DIR}"

echo "==> rsyncing (excluding .git)"
rsync -a --exclude='.git' "${TMP_DIR}/grounded-sam-2/" "${VENDOR_DIR}/"

rm -rf "${TMP_DIR}"

echo "==> recording commit:"
echo "${COMMIT_SHA}" > "${VENDOR_DIR}/.commit"

echo "[ok] vendor synced to commit ${COMMIT_SHA}"
echo "    next step: review diff, commit changes, update README.md commit reference."
