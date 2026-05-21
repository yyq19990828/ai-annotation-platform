import { useEffect, useState } from "react";

import { Button } from "@/components/ui/Button";
import styles from "./VideoTrackComposeDialog.module.css";

export type VideoTrackGapMode = "interpolate" | "outside";

function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

const GAP_MODE_OPTIONS: { value: VideoTrackGapMode; label: string; hint: string }[] = [
  {
    value: "interpolate",
    label: "插值过渡",
    hint: "两段之间靠现有线性插值平滑过渡（gap 区视为可见）。",
  },
  {
    value: "outside",
    label: "标记消失",
    hint: "把两段之间的 gap 区标为消失（outside）后再合并。",
  },
];

interface VideoTrackComposeDialogProps {
  open: boolean;
  onCancel: () => void;
  onSubmit: (gapMode: VideoTrackGapMode) => void;
}

/**
 * v0.10.30 · 2.5 Track Join 对话框：选中两条同类且帧号不重叠的轨迹跳连前，
 * 选择 gap 区填充模式（interpolate / outside）。merge / split 走各自既有路径，
 * 本对话框只覆盖 join 的 gap_mode 选择。
 */
export function VideoTrackComposeDialog({
  open,
  onCancel,
  onSubmit,
}: VideoTrackComposeDialogProps) {
  const [gapMode, setGapMode] = useState<VideoTrackGapMode>("interpolate");

  useEffect(() => {
    if (open) setGapMode("interpolate");
  }, [open]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-label="跳连轨迹"
      data-testid="video-track-compose-dialog"
      className={styles.backdrop}
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className={styles.dialog}>
        <div className={styles.header}>
          <b className={styles.title}>跳连两条轨迹</b>
          <button type="button" onClick={onCancel} className={styles.closeButton}>
            ✕
          </button>
        </div>

        <fieldset className={styles.field}>
          <legend className={styles.legend}>gap 填充模式</legend>
          <div className={styles.options}>
            {GAP_MODE_OPTIONS.map((option) => (
              <label
                key={option.value}
                className={cn(styles.optionRow, gapMode === option.value && styles.optionRowSelected)}
              >
                <input
                  type="radio"
                  name="video-track-gap-mode"
                  value={option.value}
                  checked={gapMode === option.value}
                  onChange={() => setGapMode(option.value)}
                />
                <span className={styles.optionText}>
                  <b className={styles.optionLabel}>{option.label}</b>
                  <span className={styles.optionHint}>{option.hint}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className={styles.actions}>
          <Button variant="ghost" size="sm" onClick={onCancel}>
            取消
          </Button>
          <Button size="sm" onClick={() => onSubmit(gapMode)}>
            跳连
          </Button>
        </div>
      </div>
    </div>
  );
}
