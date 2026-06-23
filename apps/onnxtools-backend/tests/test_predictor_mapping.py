"""Unit tests for predictor result mapping (no onnxtools / model / GPU needed).

只测纯映射 detections_to_results；不触发 onnxtools / httpx（http 分支才导入）。
依赖 cv2（predictor 顶部导入）+ numpy —— 用带 opencv 的环境（如 onnxtools 的 .venv）跑。
"""

from predictor import detections_to_results


class TestDetectionsToResults:
    """Tests for detections_to_results — pipeline output → 协议 v2 result[]."""

    def test_motor_vehicle_maps_to_rectanglelabels_with_attributes(self):
        """机动车检测 → rectanglelabels + 百分比坐标 + attributes{vehicle_type,color}."""
        output = [
            {"type": "car", "box2d": [50.0, 100.0, 150.0, 300.0], "score": 0.9,
             "vehicle_type": "school_bus", "color": "blue"}
        ]
        items = detections_to_results(output, img_w=500, img_h=1000)

        assert len(items) == 1
        it = items[0]
        assert it["type"] == "rectanglelabels"
        # 50/500*100=10, 100/1000*100=10, (150-50)/500*100=20, (300-100)/1000*100=20
        assert it["value"]["x"] == 10.0
        assert it["value"]["y"] == 10.0
        assert it["value"]["width"] == 20.0
        assert it["value"]["height"] == 20.0
        assert it["value"]["rectanglelabels"] == ["car"]
        assert it["score"] == 0.9
        assert it["attributes"] == {"vehicle_type": "school_bus", "color": "blue"}

    def test_non_motor_vehicle_has_no_attributes(self):
        """非机动车 → 只有几何 + score，无 attributes 键."""
        output = [{"type": "pedestrian", "box2d": [0.0, 0.0, 10.0, 20.0], "score": 0.7}]
        items = detections_to_results(output, img_w=100, img_h=100)

        assert items[0]["type"] == "rectanglelabels"
        assert items[0]["value"]["rectanglelabels"] == ["pedestrian"]
        assert "attributes" not in items[0]

    def test_empty_output(self):
        """空检测 → 空结果."""
        assert detections_to_results([], img_w=100, img_h=100) == []

    def test_missing_score_defaults_zero(self):
        """缺 score → 0.0."""
        output = [{"type": "plate", "box2d": [1.0, 2.0, 3.0, 4.0]}]
        items = detections_to_results(output, img_w=10, img_h=10)
        assert items[0]["score"] == 0.0
