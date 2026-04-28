# X-AnyLabeling:桌面端 SAM 工厂

> 拆分自《AI标注平台深度调研报告》§2.4

**仓库**:`CVHub520/X-AnyLabeling`（Star 6k+,周活跃,中文社区氛围浓）

## 2.4.1 不是平台,是"模型集成器"

X-AnyLabeling 是 PyQt6 桌面应用（LabelMe 的 fork 演化）。**它对你最有参考价值的不是架构,是模型适配代码**。

`anylabeling/services/auto_labeling/` 下塞了 **184 个模型 yaml 配置 + ~50 个适配类**:

```
SAM 系列:    segment_anything / segment_anything_2 / segment_anything_2_video
            segment_anything_3 / sam_hq / sam_med2d / sam_onnx
            edge_sam / efficientvit_sam
GroundingX:  grounding_dino / grounding_sam / grounding_sam2 / grounding_dino_api
检测/分割:   damo_yolo / dfine / deimv2 / rtdetr / rtdetrv2 / u_rtdetr / rfdetr
            doclayout_yolo / clrnet
分类/属性:   internimage_cls / pulc_attribute / ram
深度估计:    depth_anything / depth_anything_v2
姿态:        rtmdet_pose / pose/...
OCR:         ppocr_v4 / ppocr_v5
追踪:        trackers/...
多模态/通用: florence2 / open_vision / upn / geco / rmbg
远程 API:    grounding_dino_api / remote_server
```

## 2.4.2 ModelManager 抽象——值得抄

```python
class ModelManager(QObject):
    # 信号(事件)
    new_model_status / model_loaded / new_auto_labeling_result
    auto_segmentation_model_selected / unselected
    prediction_started / finished
    download_progress / download_finished

    # 能力标志位(每个模型自己声明)
    _AUTO_LABELING_MARKS_MODELS         # 支持点 / 框作为 prompt
    _AUTO_LABELING_API_TOKEN_MODELS     # 需要 API token
    _AUTO_LABELING_RESET_TRACKER_MODELS # 支持 tracker reset
    _AUTO_LABELING_CONF_MODELS          # 支持置信度阈值
    _AUTO_LABELING_IOU_MODELS
    _AUTO_LABELING_MASK_FINENESS_MODELS
    _AUTO_LABELING_CROPPING_MODE_MODELS
    _AUTO_LABELING_PREFER_EXISTING_ANNO
    _AUTO_LABELING_PROMPT_MODELS        # 支持文本 prompt
    _ON_NEXT_FILES_CHANGED_MODELS       # 跨文件追踪需要预热

    def predict_shapes(self, image, ...):
        """统一入口,根据当前模型路由到具体实现"""
```

**精华**:把"模型可以做什么"用**能力位**而不是 if-else 表达,前端 UI 根据当前模型的能力位**动态显示/隐藏控件**（置信度滑块、IoU 滑块、prompt 输入框）。

## 2.4.3 远程模式:RemoteServer

```python
class RemoteServer(Model):
    server_url = settings.get("server_url", env "XANYLABELING_SERVER_URL")
    predict_url = f"{server_url}/v1/predict"
    headers = {"Token": api_key}

    # POST {predict_url} { image: base64, marks: [...], ... }
```

桌面端不一定要本地装 PyTorch,可以连远程推理服务。**这套协议比 LS 的 ML Backend 更简单**（没有训练、没有 webhook）,适合"只做推理"的场景。
