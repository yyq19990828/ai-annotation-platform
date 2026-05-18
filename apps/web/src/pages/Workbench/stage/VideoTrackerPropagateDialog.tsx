import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/Button";
import type {
  VideoTrackerDirection,
  VideoTrackerPropagatePayload,
} from "@/api/videoTracker";
import styles from "./VideoTrackerPropagateDialog.module.css";

const RANGE_PRESETS = [
  { value: "10", label: "10 帧" },
  { value: "30", label: "30 帧" },
  { value: "60", label: "60 帧" },
  { value: "next-keyframe", label: "到下一关键帧" },
  { value: "end", label: "到结尾" },
] as const;

type RangePresetValue = (typeof RANGE_PRESETS)[number]["value"];

const MODELS: Array<{ value: string; label: string; note?: string }> = [
  { value: "mock_bbox", label: "mock_bbox", note: "测试用 (不依赖 ML backend)" },
  { value: "sam2_video", label: "sam2_video", note: "需项目绑定 ML backend" },
  { value: "sam3_video", label: "sam3_video", note: "需项目绑定 ML backend" },
];

function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

interface VideoTrackerPropagateDialogProps {
  open: boolean;
  frameIndex: number;
  maxFrame: number;
  nextKeyframeAfter: number | null;
  submitting: boolean;
  onCancel: () => void;
  onSubmit: (payload: VideoTrackerPropagatePayload) => Promise<void>;
}

export function VideoTrackerPropagateDialog({
  open,
  frameIndex,
  maxFrame,
  nextKeyframeAfter,
  submitting,
  onCancel,
  onSubmit,
}: VideoTrackerPropagateDialogProps) {
  const [direction, setDirection] = useState<VideoTrackerDirection>("forward");
  const [rangePreset, setRangePreset] = useState<RangePresetValue>("30");
  const [modelKey, setModelKey] = useState<string>("mock_bbox");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setDirection("forward");
      setRangePreset("30");
      setModelKey("mock_bbox");
      setError(null);
    }
  }, [open]);

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
    const span = Number(rangePreset);
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
  }, [direction, frameIndex, maxFrame, nextKeyframeAfter, rangePreset]);

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
              <option key={preset.value} value={preset.value}>
                {preset.label}
              </option>
            ))}
          </select>
          <span className={cn("mono", styles.rangeHint)}>
            F{range.from} → F{range.to}
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
