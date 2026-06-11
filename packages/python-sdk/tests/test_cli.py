from typer.testing import CliRunner

from ai_annotation import __version__
from ai_annotation.cli.main import app

runner = CliRunner()


def test_version():
    result = runner.invoke(app, ["--version"])
    assert result.exit_code == 0
    assert __version__ in result.output


def test_tui_not_implemented_hint():
    # v0.15.2 ai_annotation.tui.app 尚不存在 → lazy import 失败给安装提示
    result = runner.invoke(app, ["tui"])
    assert result.exit_code == 1
    assert "ai-annotation-sdk[tui]" in result.output
