#!/usr/bin/env bash
# Auto-install pre-commit git hooks on `pnpm install`.
# 静默跳过 CI / 没装 pre-commit / 非 git 仓库的情况，绝不阻塞 install。

set -u

# CI 不需要本地 git hook
if [ -n "${CI:-}" ]; then
  exit 0
fi

# 不在 git 仓库（例如打包 tarball 安装）
if [ ! -d ".git" ] && ! git rev-parse --git-dir >/dev/null 2>&1; then
  exit 0
fi

# 已经装过就不重复装
if [ -f ".git/hooks/pre-commit" ] && grep -q "pre-commit" ".git/hooks/pre-commit" 2>/dev/null; then
  exit 0
fi

if command -v pre-commit >/dev/null 2>&1; then
  pre-commit install >/dev/null 2>&1 && \
    echo "✓ pre-commit hooks installed (ruff / eslint / tsc / openapi-snapshot)"
else
  cat <<'EOF' >&2
⚠ pre-commit 未安装，建议执行：
    pip install pre-commit && pre-commit install
  否则修改 apps/api/app/api 或 schemas 时需要手动跑：
    pnpm openapi:export
EOF
fi

exit 0
