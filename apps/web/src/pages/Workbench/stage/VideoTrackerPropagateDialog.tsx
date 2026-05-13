import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/Button";
import type {
  VideoTrackerDirection,
  VideoTrackerPropagatePayload,
} from "@/api/videoTracker";

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
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.4)",
        display: "grid",
        placeItems: "center",
        zIndex: 1000,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        style={{
          width: 360,
          background: "var(--color-bg-elev)",
          border: "1px solid var(--color-border)",
          borderRadius: 10,
          padding: 16,
          display: "grid",
          gap: 12,
          boxShadow: "0 24px 64px rgba(0,0,0,0.32)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <b style={{ fontSize: 14 }}>AI 传播 (Shift+T)</b>
          <button
            type="button"
            onClick={onCancel}
            style={{
              border: 0,
              background: "transparent",
              color: "var(--color-fg-muted)",
              cursor: "pointer",
              fontSize: 13,
            }}
          >
            ✕
          </button>
        </div>

        <label style={{ display: "grid", gap: 4, fontSize: 12, color: "var(--color-fg-muted)" }}>
          方向
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 4 }}>
            {(["forward", "backward", "bidirectional"] as VideoTrackerDirection[]).map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDirection(d)}
                style={{
                  padding: "5px 0",
                  borderRadius: 6,
                  border: `1px solid ${direction === d ? "var(--color-accent)" : "var(--color-border)"}`,
                  background: direction === d ? "color-mix(in oklab, var(--color-accent) 12%, var(--color-bg))" : "var(--color-bg)",
                  color: "var(--color-fg)",
                  fontSize: 12,
                  cursor: "pointer",
                }}
              >
                {d === "forward" ? "向后" : d === "backward" ? "向前" : "双向"}
              </button>
            ))}
          </div>
        </label>

        <label style={{ display: "grid", gap: 4, fontSize: 12, color: "var(--color-fg-muted)" }}>
          范围
          <select
            value={rangePreset}
            onChange={(e) => setRangePreset(e.target.value as RangePresetValue)}
            style={{
              border: "1px solid var(--color-border)",
              borderRadius: 6,
              background: "var(--color-bg)",
              color: "var(--color-fg)",
              fontSize: 13,
              padding: "5px 8px",
            }}
          >
            {RANGE_PRESETS.map((preset) => (
              <option key={preset.value} value={preset.value}>
                {preset.label}
              </option>
            ))}
          </select>
          <span className="mono" style={{ fontSize: 11, color: "var(--color-fg-subtle)" }}>
            F{range.from} → F{range.to}
          </span>
        </label>

        <label style={{ display: "grid", gap: 4, fontSize: 12, color: "var(--color-fg-muted)" }}>
          模型
          <select
            value={modelKey}
            onChange={(e) => setModelKey(e.target.value)}
            style={{
              border: "1px solid var(--color-border)",
              borderRadius: 6,
              background: "var(--color-bg)",
              color: "var(--color-fg)",
              fontSize: 13,
              padding: "5px 8px",
            }}
          >
            {MODELS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
          <span style={{ fontSize: 11, color: "var(--color-fg-subtle)" }}>
            {MODELS.find((m) => m.value === modelKey)?.note}
          </span>
        </label>

        {error && (
          <div style={{ color: "var(--color-danger)", fontSize: 12 }}>{error}</div>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
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
