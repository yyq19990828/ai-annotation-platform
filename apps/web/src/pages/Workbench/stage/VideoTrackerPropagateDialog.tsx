import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/Button";
import type {
  VideoTrackerDirection,
  VideoTrackerPropagatePayload,
} from "@/api/videoTracker";
import styles from "./VideoTrackerPropagateDialog.module.css";

const SPAN_PRESETS = ["10", "30", "60"] as const;
const RANGE_PRESETS = [
  ...SPAN_PRESETS,
  "next-keyframe",
  "end",
] as const;

type RangePresetValue = (typeof RANGE_PRESETS)[number];

// 采样开启 (step>1) 时数字预设以网格格子为单位, 标签显示如「10 格 (≈100 帧)」;
// 关闭时维持「N 帧」。next-keyframe / end 与单位无关, 标签固定。
function presetLabel(value: RangePresetValue, step: number): string {
  if (value === "next-keyframe") return "到下一关键帧";
  if (value === "end") return "到结尾";
  const n = Number(value);
  return step > 1 ? `${n} 格 (≈${n * step} 帧)` : `${n} 帧`;
}

const MODELS: Array<{ value: string; label: string; note?: string }> = [
  { value: "mock_bbox", label: "mock_bbox", note: "测试用 (不依赖 ML backend)" },
  { value: "sam2_video", label: "sam2_video", note: "需项目绑定 ML backend" },
  { value: "sam3_video", label: "sam3_video", note: "需项目绑定 ML backend" },
];

// v0.10.36: SAM 模型尺寸 (tracker 不用 DINO, 只选 SAM 尺寸)。空 = 默认/tiny。
const SAM_VARIANTS: Array<{ value: string; label: string }> = [
  { value: "", label: "默认 (tiny)" },
  { value: "tiny", label: "tiny" },
  { value: "small", label: "small" },
  { value: "base_plus", label: "base_plus" },
  { value: "large", label: "large" },
];

function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

interface VideoTrackerPropagateDialogProps {
  open: boolean;
  frameIndex: number;
  maxFrame: number;
  nextKeyframeAfter: number | null;
  /** 采样网格步长 (源帧). >1 时数字预设以网格格子为单位; 缺省 1 = 现状 (按源帧). */
  samplingStep?: number;
  submitting: boolean;
  onCancel: () => void;
  onSubmit: (payload: VideoTrackerPropagatePayload) => Promise<void>;
}

export function VideoTrackerPropagateDialog({
  open,
  frameIndex,
  maxFrame,
  nextKeyframeAfter,
  samplingStep = 1,
  submitting,
  onCancel,
  onSubmit,
}: VideoTrackerPropagateDialogProps) {
  const [direction, setDirection] = useState<VideoTrackerDirection>("forward");
  const [rangePreset, setRangePreset] = useState<RangePresetValue>("30");
  const [modelKey, setModelKey] = useState<string>("mock_bbox");
  // v0.10.36: SAM 模型尺寸; 空 = 默认 (tiny)。
  const [samVariant, setSamVariant] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setDirection("forward");
      setRangePreset("30");
      setModelKey("mock_bbox");
      setSamVariant("");
      setError(null);
    }
  }, [open]);

  const grid = Math.max(1, Math.round(samplingStep));

  const range = useMemo(() => {
    if (rangePreset === "next-keyframe") {
      if (nextKeyframeAfter !== null && nextKeyframeAfter > frameIndex) {
        return { from: frameIndex, to: nextKeyframeAfter };
      }
      return { from: frameIndex, to: Math.min(maxFrame, frameIndex + 30) };
    }
    if (rangePreset === "end") {
      return direction === "backward"
        ? { from: 0, to: frameIndex }
        : { from: frameIndex, to: maxFrame };
    }
    // 数字预设是网格格子数; 采样开启时换算成源帧跨度 (span * grid)。
    const span = Number(rangePreset) * grid;
    if (direction === "backward") {
      return { from: Math.max(0, frameIndex - span), to: frameIndex };
    }
    if (direction === "bidirectional") {
      return {
        from: Math.max(0, frameIndex - span),
        to: Math.min(maxFrame, frameIndex + span),
      };
    }
    return { from: frameIndex, to: Math.min(maxFrame, frameIndex + span) };
  }, [direction, frameIndex, grid, maxFrame, nextKeyframeAfter, rangePreset]);

  if (!open) return null;

  const handleSubmit = async () => {
    if (range.from > range.to) {
      setError("起止帧无效");
      return;
    }
    try {
      await onSubmit({
        from_frame: range.from,
        to_frame: range.to,
        model_key: modelKey,
        direction,
        sam_variant: samVariant || undefined,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "提交失败");
    }
  };

  return (
    <div
      role="dialog"
      aria-label="AI 传播"
      data-testid="video-tracker-propagate-dialog"
      className={styles.backdrop}
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className={styles.dialog}>
        <div className={styles.header}>
          <b className={styles.title}>AI 传播 (Shift+T)</b>
          <button
            type="button"
            onClick={onCancel}
            className={styles.closeButton}
          >
            ✕
          </button>
        </div>

        <label className={styles.field}>
          方向
          <div className={styles.segmented}>
            {(["forward", "backward", "bidirectional"] as VideoTrackerDirection[]).map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDirection(d)}
                className={cn(styles.optionButton, direction === d && styles.optionButtonSelected)}
              >
                {d === "forward" ? "向后" : d === "backward" ? "向前" : "双向"}
              </button>
            ))}
          </div>
        </label>

        <label className={styles.field}>
          范围
          <select
            value={rangePreset}
            onChange={(e) => setRangePreset(e.target.value as RangePresetValue)}
            className={styles.select}
          >
            {RANGE_PRESETS.map((preset) => (
              <option key={preset} value={preset}>
                {presetLabel(preset, grid)}
              </option>
            ))}
          </select>
          <span className={cn("mono", styles.rangeHint)}>
            {grid > 1 ? (
              <>
                G{Math.round(range.from / grid)} → G{Math.round(range.to / grid)} (F
                {range.from} → F{range.to})
              </>
            ) : (
              <>
                F{range.from} → F{range.to}
              </>
            )}
          </span>
        </label>

        <label className={styles.field}>
          模型
          <select
            value={modelKey}
            onChange={(e) => setModelKey(e.target.value)}
            className={styles.select}
          >
            {MODELS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
          <span className={styles.modelNote}>
            {MODELS.find((m) => m.value === modelKey)?.note}
          </span>
        </label>

        {modelKey !== "mock_bbox" && (
          <label className={styles.field}>
            模型尺寸
            <select
              value={samVariant}
              onChange={(e) => setSamVariant(e.target.value)}
              className={styles.select}
            >
              {SAM_VARIANTS.map((v) => (
                <option key={v.value} value={v.value}>
                  {v.label}
                </option>
              ))}
            </select>
            <span className={styles.modelNote}>
              更大尺寸更准但更慢/更吃显存; 默认 tiny。
            </span>
          </label>
        )}

        {error && (
          <div className={styles.error}>{error}</div>
        )}

        <div className={styles.actions}>
          <Button variant="ghost" size="sm" onClick={onCancel} disabled={submitting}>
            取消
          </Button>
          <Button size="sm" onClick={handleSubmit} disabled={submitting}>
            {submitting ? "发起中…" : "发起传播"}
          </Button>
        </div>
      </div>
    </div>
  );
}
