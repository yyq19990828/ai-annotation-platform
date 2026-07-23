from typer.testing import CliRunner

from ai_annotation import __version__
from ai_annotation.cli.main import app

runner = CliRunner()


def test_version():
    result = runner.invoke(app, ["--version"])
    assert result.exit_code == 0
    assert __version__ in result.output


def test_tui_unconfigured_exits_with_login_hint(monkeypatch, tmp_path):
    # 未配置 base_url/api_key 时 tui 不进 app, 提示先 login
    monkeypatch.delenv("AAP_BASE_URL", raising=False)
    monkeypatch.delenv("AAP_API_KEY", raising=False)
    monkeypatch.setattr(
        "ai_annotation.config.config_path", lambda: tmp_path / "config.toml"
    )
    result = runner.invoke(app, ["tui"])
    assert result.exit_code == 1
    assert "aap login" in result.output + str(result.exception or "")
