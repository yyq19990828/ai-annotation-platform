# 商业平台速览

> 拆分自《AI标注平台深度调研报告》§2.5

## 2.5.1 Roboflow

- **Label Assist**:用同项目下你训练过的模型 / Universe 上的公开模型做预标
- **Smart Polygon**:基于 SAM2,一键画多边形
- 强项:从标注 → 训练 → 部署 一条龙（自家 Universe + Hosted Inference）
- 弱项:数据隐私差,默认数据上 Universe

## 2.5.2 Encord

- 整合 SAM2 + GPT-4o + Gemini Pro 做预标
- **Encord Active**:数据策展模块（找异常 / 重复 / 难例）,可独立买
- 强项:面向数据团队,有完整的"曲面/点云/医学影像"流水线
- 弱项:贵

## 2.5.3 V7 Darwin

- 2025 年 Q4 集成 SAM3,支持**文本驱动批量类别检测**（全图所有该类对象一次画完）
- 医疗影像（DICOM）是杀手锏
- 视频标注体验业界第一档

## 2.5.4 Refuel Autolabel

```yaml
# Python 库,3 步:
1. 写 JSON config(任务类型 + LLM + prompt + 标签)
2. dry-run 看 prompt 输出
3. 跑 dataset
```

- 主要做 NLP 文本标注
- 内置 few-shot / chain-of-thought / 多 LLM 投票
- 跟 Adala 重合度高,但 **Adala 更"框架",Refuel 更"开箱即用"**

## 2.5.5 Argilla（Hugging Face）

- 主战场是 LLM 数据（SFT / RLHF preference / NLP）
- 整合到 HF Hub,可以直接 push 标注结果到数据集 repo
- CV 较弱,跟你的目标关联不大
