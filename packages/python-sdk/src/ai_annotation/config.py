"""配置加载与保存, 供 SDK / CLI / TUI 共用。

读取顺序: 显式参数 > 环境变量 AAP_BASE_URL / AAP_API_KEY > ~/.config/ai-annotation/config.toml。
"""

from __future__ import annotations

import os
import tomllib
from pathlib import Path

ENV_BASE_URL = "AAP_BASE_URL"
ENV_API_KEY = "AAP_API_KEY"


def config_path() -> Path:
    return Path.home() / ".config" / "ai-annotation" / "config.toml"


def _read_file_config() -> dict:
    p = config_path()
    if not p.is_file():
        return {}
    try:
        with p.open("rb") as f:
            return tomllib.load(f)
    except (tomllib.TOMLDecodeError, OSError):
        return {}


def load_config(
    base_url: str | None = None, api_key: str | None = None
) -> tuple[str | None, str | None]:
    """按优先级解析 (base_url, api_key); 任一项可能为 None。"""
    file_cfg = _read_file_config()
    base_url = base_url or os.environ.get(ENV_BASE_URL) or file_cfg.get("base_url")
    api_key = api_key or os.environ.get(ENV_API_KEY) or file_cfg.get("api_key")
    return base_url, api_key


def save_config(base_url: str, api_key: str) -> Path:
    """写 config.toml (chmod 0600, api_key 是敏感凭据)。"""
    p = config_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    # 手写两行 toml, 避免引入写依赖; 值为 URL / token, 无需转义
    p.write_text(f'base_url = "{base_url}"\napi_key = "{api_key}"\n', encoding="utf-8")
    p.chmod(0o600)
    return p
