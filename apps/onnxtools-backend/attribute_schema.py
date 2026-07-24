"""车辆属性 select options —— 协议③ ``output_attribute_schema`` 的取值域自描述。

``value`` 与 onnxtools 的 ``VEHICLE_TYPE_MAP`` / ``VEHICLE_COLOR_MAP`` 严格对齐（顺序即
模型输出索引），``label`` 为中文展示文案。平台 ``/setup`` 暴露后，项目可一键导入成
``attribute_schema`` 的两个 select 字段，免去手抄 options 与 key 对齐。

> 改 onnxtools 的枚举时，本文件须同步（tests/test_attribute_schema.py 防漂移）。
"""

# 车型 13 类（onnxtools VEHICLE_TYPE_MAP，index 0..12）
VEHICLE_TYPE_OPTIONS = [
    {"value": "car", "label": "小车"},
    {"value": "truck", "label": "卡车"},
    {"value": "bus", "label": "公交"},
    {"value": "tanker", "label": "油罐车"},
    {"value": "slagcar", "label": "渣土车"},
    {"value": "fire_engine", "label": "消防车"},
    {"value": "mixer", "label": "混凝土搅拌车"},
    {"value": "ambulance", "label": "救护车"},
    {"value": "police_car", "label": "警车"},
    {"value": "engineering_truck", "label": "工程车"},
    {"value": "hazardous_goods_vehicle", "label": "危险品运输车"},
    {"value": "manned_sweeping_vehicle", "label": "有人扫路车"},
    {"value": "school_bus", "label": "校车"},
]

# 车辆颜色 11 类（onnxtools VEHICLE_COLOR_MAP，index 0..10）
COLOR_OPTIONS = [
    {"value": "black", "label": "黑色"},
    {"value": "white", "label": "白色"},
    {"value": "gray", "label": "灰色"},
    {"value": "red", "label": "红色"},
    {"value": "yellow", "label": "黄色"},
    {"value": "green", "label": "绿色"},
    {"value": "blue", "label": "蓝色"},
    {"value": "purple", "label": "紫色"},
    {"value": "brown", "label": "棕色"},
    {"value": "pink", "label": "粉色"},
    {"value": "other", "label": "其他"},
]

# 协议③：/setup model 条目自报的属性 schema（含 select options）
OUTPUT_ATTRIBUTE_SCHEMA = [
    {
        "key": "vehicle_type",
        "label": "车型",
        "type": "select",
        "options": VEHICLE_TYPE_OPTIONS,
    },
    {"key": "color", "label": "颜色", "type": "select", "options": COLOR_OPTIONS},
]
