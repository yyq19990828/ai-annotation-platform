"""Guard tests: attribute_schema options 必须与 onnxtools 枚举严格对齐（防漂移）。

若环境未装 onnxtools（如纯映射测试机），对齐校验自动 skip；options 结构校验始终运行。
"""

import pytest

from attribute_schema import COLOR_OPTIONS, OUTPUT_ATTRIBUTE_SCHEMA, VEHICLE_TYPE_OPTIONS


class TestOptionsStructure:
    """Structural checks that do not require onnxtools."""

    def test_counts(self):
        """13 车型 + 11 颜色（与 va 模型输出维度一致）."""
        assert len(VEHICLE_TYPE_OPTIONS) == 13
        assert len(COLOR_OPTIONS) == 11

    def test_option_shape(self):
        """每个 option 有 value + label."""
        for opt in VEHICLE_TYPE_OPTIONS + COLOR_OPTIONS:
            assert set(opt) == {"value", "label"}
            assert opt["value"] and opt["label"]

    def test_output_attribute_schema_keys(self):
        """协议③ schema 两字段 vehicle_type / color，均 select 带 options."""
        keys = {f["key"]: f for f in OUTPUT_ATTRIBUTE_SCHEMA}
        assert set(keys) == {"vehicle_type", "color"}
        for f in OUTPUT_ATTRIBUTE_SCHEMA:
            assert f["type"] == "select"
            assert f["options"]


class TestAlignmentWithOnnxtools:
    """value 顺序必须严格等于 onnxtools 模型输出索引顺序."""

    def test_vehicle_type_values_match_onnxtools(self):
        cfg = pytest.importorskip("onnxtools.config")
        expected = [cfg.VEHICLE_TYPE_MAP[i] for i in range(len(cfg.VEHICLE_TYPE_MAP))]
        assert [o["value"] for o in VEHICLE_TYPE_OPTIONS] == expected

    def test_color_values_match_onnxtools(self):
        cfg = pytest.importorskip("onnxtools.config")
        expected = [cfg.VEHICLE_COLOR_MAP[i] for i in range(len(cfg.VEHICLE_COLOR_MAP))]
        assert [o["value"] for o in COLOR_OPTIONS] == expected
