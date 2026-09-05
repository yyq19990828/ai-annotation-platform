"""Run with python3 scripts/test-orca-worktree-setup.py (no installs or services)."""

import os
from pathlib import Path
import subprocess
import tempfile
import tomllib


script = Path(__file__).with_name("orca-worktree-setup.sh").resolve()
# Workspace startup must not compile legacy FreeType on Python 3.12 / Apple Silicon.
lock = tomllib.loads((script.parent.parent / "apps/api/uv.lock").read_text())
matplotlib = next(
    package for package in lock["package"] if package["name"] == "matplotlib"
)
assert any(
    "cp312-cp312-macosx_" in wheel["url"]
    and wheel["url"].endswith(("_arm64.whl", "_universal2.whl"))
    for wheel in matplotlib.get("wheels", [])
), f"Matplotlib {matplotlib['version']} has no Python 3.12 macOS ARM64 wheel in uv.lock"

with tempfile.TemporaryDirectory(prefix="orca setup ") as temporary:
    base = Path(temporary)
    root, worktree, binaries = (base / name for name in ("primary", "worktree", "bin"))
    for directory in (root, worktree, binaries):
        directory.mkdir()
    dependencies = ("node_modules", "apps/web/node_modules", "docs-site/node_modules")
    manifests = (
        "pnpm-lock.yaml",
        "pnpm-workspace.yaml",
        "package.json",
        "apps/web/package.json",
        "docs-site/package.json",
    )
    for directory in (root, worktree):
        for name in manifests:
            path = directory / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("same\n")
        (directory / "apps/api").mkdir()
    for name in dependencies:
        (root / name).mkdir(exist_ok=True)
    calls = base / "calls"
    for name in ("pnpm", "uv"):
        executable = binaries / name
        executable.write_text(
            '#!/bin/sh\nprintf "%s %s\\n" "${0##*/}" "$*" >> "$CALLS"\n'
        )
        executable.chmod(0o755)
    env = dict(
        os.environ,
        PATH=f"{binaries}:{os.environ['PATH']}",
        ORCA_ROOT_PATH=str(root),
        ORCA_WORKTREE_PATH=str(worktree),
        CALLS=str(calls),
    )

    def run():
        return subprocess.run(
            ["bash", str(script)], env=env, capture_output=True, text=True
        )

    result = run()
    assert result.returncode == 0, result.stderr
    for name in (".env", *dependencies):
        assert (worktree / name).is_symlink()
        assert (worktree / name).resolve() == (root / name).resolve()
    assert calls.read_text().splitlines() == [
        "uv sync --project apps/api --locked --extra test",
        "pnpm codegen",
    ]
    (root / ".env").write_text("LOCAL_VALUE=preserve\n")
    assert run().returncode == 0
    assert (root / ".env").read_text() == "LOCAL_VALUE=preserve\n"

    (worktree / ".env").unlink()
    (worktree / ".env").write_text("WORKTREE_VALUE=preserve\n")
    assert run().returncode == 0
    assert (worktree / ".env").read_text() == "WORKTREE_VALUE=preserve\n"

    # A dependency change must never install through shared node_modules.
    (worktree / "pnpm-lock.yaml").write_text("different\n")
    previous_calls = calls.read_text()
    assert run().returncode != 0
    assert calls.read_text() == previous_calls
    for name in dependencies:
        (worktree / name).unlink()
    assert run().returncode == 0
    assert "pnpm install --frozen-lockfile" in calls.read_text()

    # Even a dangling venv link must not let uv touch another checkout.
    (worktree / "pnpm-lock.yaml").write_text("same\n")
    (worktree / "apps/api/.venv").symlink_to(root / "apps/api/.venv")
    previous_calls = calls.read_text()
    assert run().returncode != 0
    assert calls.read_text() == previous_calls

print("Orca setup: symlinks, repeat runs, local files and dependency isolation passed.")
