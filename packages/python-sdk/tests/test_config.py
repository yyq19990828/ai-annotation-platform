from ai_annotation.config import config_path, load_config, save_config


def _isolate_home(monkeypatch, tmp_path):
    monkeypatch.setenv("HOME", str(tmp_path))
    monkeypatch.delenv("AAP_BASE_URL", raising=False)
    monkeypatch.delenv("AAP_API_KEY", raising=False)


def test_load_config_priority(monkeypatch, tmp_path):
    _isolate_home(monkeypatch, tmp_path)
    cfg_dir = tmp_path / ".config" / "ai-annotation"
    cfg_dir.mkdir(parents=True)
    (cfg_dir / "config.toml").write_text(
        'base_url = "http://file"\napi_key = "ak_file"\n'
    )

    # 1. 仅文件
    assert load_config() == ("http://file", "ak_file")

    # 2. env 覆盖文件
    monkeypatch.setenv("AAP_BASE_URL", "http://env")
    monkeypatch.setenv("AAP_API_KEY", "ak_env")
    assert load_config() == ("http://env", "ak_env")

    # 3. 显式参数最高
    assert load_config(base_url="http://arg", api_key="ak_arg") == ("http://arg", "ak_arg")


def test_load_config_missing_file(monkeypatch, tmp_path):
    _isolate_home(monkeypatch, tmp_path)
    assert load_config() == (None, None)


def test_load_config_broken_toml(monkeypatch, tmp_path):
    _isolate_home(monkeypatch, tmp_path)
    cfg = config_path()
    cfg.parent.mkdir(parents=True)
    cfg.write_text("not [valid toml")
    assert load_config() == (None, None)


def test_save_config_writes_0600(monkeypatch, tmp_path):
    _isolate_home(monkeypatch, tmp_path)
    p = save_config("http://h", "ak_x")
    assert p == config_path()
    assert p.read_text() == 'base_url = "http://h"\napi_key = "ak_x"\n'
    assert (p.stat().st_mode & 0o777) == 0o600
    # 写完即可被 load_config 读回
    assert load_config() == ("http://h", "ak_x")
