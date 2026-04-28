# 参考资料与总结

> 拆分自《AI标注平台深度调研报告》§8-§9

## 8. 关键参考资料

### 8.1 源码（已 clone 到 /tmp/research/）

- **Label Studio**:https://github.com/HumanSignal/label-studio
  - 重点读:`label_studio/projects/functions/next_task.py`、`label_studio/ml/`、`label_studio/tasks/models.py`
- **CVAT**:https://github.com/cvat-ai/cvat
  - 重点读:`cvat/apps/lambda_manager/`、`cvat/apps/quality_control/`、`serverless/pytorch/facebookresearch/sam/nuclio/function.yaml`
- **Adala**:https://github.com/HumanSignal/Adala
  - 重点读:`adala/skills/_base.py`、`adala/skills/collection/label_studio.py`、`server/app.py`
- **X-AnyLabeling**:https://github.com/CVHub520/X-AnyLabeling
  - 重点读:`anylabeling/services/auto_labeling/model_manager.py`、`grounding_sam2.py`、`segment_anything_2.py`、`remote_server.py`

### 8.2 关键文档

- LS Active Learning:https://docs.humansignal.com/guide/active_learning.html
- LS ML Pipeline:https://labelstud.io/guide/ml.html
- CVAT Auto-Annotation:https://docs.cvat.ai/docs/annotation/auto-annotation/automatic-annotation/
- CVAT AI Agents 公告:https://www.cvat.ai/resources/changelog/announcing-cvat-ai-agents
- Adala README + Examples:`/tmp/research/adala/examples/`
- Refuel Autolabel:https://github.com/refuel-ai/autolabel

### 8.3 商业平台对比文章（2026 年）

- Encord 2026 Top Annotation Platforms:https://encord.com/blog/ai-annotation-platforms-with-the-best-data-curation/
- Lightly 12 Best Tools:https://www.lightly.ai/blog/data-annotation-tools

---

## 9. 一句话总结

> 你 v0.2.0 的工程底座（FastAPI + 异步 SQLAlchemy + Vite + 设计系统）做得**比 LS / CVAT 第一版当年更扎实**。但是 **AI 这块和数据模型层级**,你要么抄 LS（通用）要么抄 CVAT（CV 专用）的成熟设计,千万别自己从零想——他们俩的模型几乎是踩了 5 年坑积累出来的。直接照着 v0.3 路线图改造,**两周内就能从"前后端联通的标注 demo"变成"能接 GroundingSAM2 跑预标的可用平台"**。
