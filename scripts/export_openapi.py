"""Export FastAPI OpenAPI schema to a versioned snapshot.

用法：
    cd apps/api && uv run python ../../scripts/export_openapi.py            # 写入 snapshot
    cd apps/api && uv run python ../../scripts/export_openapi.py --check    # CI 用，不一致即 fail

输出：
    apps/api/openapi.snapshot.json    # 仓库内的版本化契约
    docs-site/api/openapi.json        # 文档站构建源（若 docs-site 存在）
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

# 当 `uv run python ../../scripts/export_openapi.py` 时，cwd=apps/api，
# 但 sys.path 不会自动包含 cwd；显式添加确保 `from app.main` 能解析。
_API_DIR = Path(__file__).resolve().parents[1] / "apps" / "api"
if str(_API_DIR) not in sys.path:
    sys.path.insert(0, str(_API_DIR))


def main() -> int:
    parser = argparse.ArgumentParser(description="Export FastAPI OpenAPI snapshot")
    parser.add_argument(
        "--check",
        action="store_true",
        help="不写文件，仅比对当前 schema 是否与 snapshot 一致；不一致返回非零退出码",
    )
    args = parser.parse_args()

    # 必须在 apps/api 目录下执行（uv 会从该目录解析依赖）
    from app.main import app  # noqa: E402  延迟导入

    schema = app.openapi()
    schema_str = json.dumps(schema, indent=2, sort_keys=True, ensure_ascii=False) + "\n"

    repo_root = Path(__file__).resolve().parents[1]
    snapshot_path = repo_root / "apps" / "api" / "openapi.snapshot.json"
    docs_target = repo_root / "docs-site" / "api" / "openapi.json"

    if args.check:
        if not snapshot_path.exists():
            print(f"::error::snapshot 不存在：{snapshot_path}")
            print("先运行：cd apps/api && uv run python ../../scripts/export_openapi.py")
            return 1
        current = snapshot_path.read_text(encoding="utf-8")
        if current.strip() != schema_str.strip():
            print("::error::OpenAPI snapshot 与当前路由不一致。")
            print("请运行：cd apps/api && uv run python ../../scripts/export_openapi.py")
            print("然后把 apps/api/openapi.snapshot.json 一并提交。")
            return 1
        print("✓ openapi snapshot 与当前路由一致")
        return 0

    snapshot_path.write_text(schema_str, encoding="utf-8")
    print(f"✓ wrote {snapshot_path.relative_to(repo_root)}")

    if docs_target.parent.exists():
        docs_target.write_text(schema_str, encoding="utf-8")
        print(f"✓ wrote {docs_target.relative_to(repo_root)}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
