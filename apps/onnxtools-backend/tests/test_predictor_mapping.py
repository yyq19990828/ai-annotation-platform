"""Unit tests for predictor result mapping (no onnxtools / model / GPU needed).

只测纯映射 detections_to_results；不触发 onnxtools / httpx（http 分支才导入）。
依赖 cv2（predictor 顶部导入）+ numpy —— 用带 opencv 的环境（如 onnxtools 的 .venv）跑。
"""

from predictor import classification_to_result, detections_to_results


class TestDetectionsToResults:
    """Tests for detections_to_results — pipeline output → 协议 v2 result[]."""

    def test_motor_vehicle_maps_to_rectanglelabels_with_attributes(self):
        """机动车检测 → rectanglelabels + 百分比坐标 + attributes{vehicle_type,color}."""
        output = [
            {
                "type": "car",
                "box2d": [50.0, 100.0, 150.0, 300.0],
                "score": 0.9,
                "vehicle_type": "school_bus",
                "color": "blue",
            }
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


class TestClassificationToResult:
    """Tests for classification_to_result — 纯分类(下游阶段)→ 单条协议 result."""

    def test_classify_maps_to_whole_image_box_with_attributes(self):
        """纯分类 → 整图框 rectanglelabels + attributes{vehicle_type,color}, 车型作标签."""
        item = classification_to_result(
            "school_bus", "blue", vehicle_type_conf=0.93, color_conf=0.88
        )
        assert item["type"] == "rectanglelabels"
        # 整图框: 几何占位, 平台 merge 丢弃只取 attributes
        assert item["value"]["x"] == 0.0
        assert item["value"]["y"] == 0.0
        assert item["value"]["width"] == 100.0
        assert item["value"]["height"] == 100.0
        assert item["value"]["rectanglelabels"] == ["school_bus"]
        assert item["attributes"] == {"vehicle_type": "school_bus", "color": "blue"}

    def test_score_is_min_of_branch_confs(self):
        """score 取车型/颜色置信度较小者(弱环节)."""
        item = classification_to_result(
            "car", "red", vehicle_type_conf=0.9, color_conf=0.6
        )
        assert item["score"] == 0.6

    def test_conf_defaults_zero(self):
        """缺置信度 → score 0.0."""
        item = classification_to_result("truck", "white")
        assert item["score"] == 0.0
