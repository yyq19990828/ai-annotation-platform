import { useEffect, useState } from "react";

import { Button } from "@/components/ui/Button";
import type { VideoPropagateDirection } from "../state/videoTrackCommands";
import { readDialogMemory, writeDialogMemory } from "../state/videoDialogMemory";
import styles from "./VideoKeyframesPropagateDialog.module.css";

const COUNT_PRESETS = [1, 5, 10, 30] as const;

function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function validateKeyframesMemory(value: unknown): VideoKeyframesPropagateSubmit | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<VideoKeyframesPropagateSubmit>;
  const direction =
    raw.direction === "forward" || raw.direction === "backward"
      ? raw.direction
      : null;
  const count =
    typeof raw.count === "number" && Number.isFinite(raw.count) && raw.count > 0
      ? Math.floor(raw.count)
      : null;
  if (!direction || !count || typeof raw.overwrite !== "boolean") return null;
  return { direction, count, overwrite: raw.overwrite };
}

export interface VideoKeyframesPropagateSubmit {
  direction: VideoPropagateDirection;
  count: number;
  overwrite: boolean;
}

interface VideoKeyframesPropagateDialogProps {
  open: boolean;
  frameIndex: number;
  userId?: string | null;
  /** 采样网格步长 (源帧). >1 时 count 以网格格子为单位; 缺省 1 = 现状 (按源帧). */
  samplingStep?: number;
  overwriteOverride?: boolean | null;
  onCancel: () => void;
  onSubmit: (payload: VideoKeyframesPropagateSubmit) => void;
}

/**
 * v0.10.30 · 2.6 关键帧 Propagate 对话框 (纯前端, 区别于 AI 版 VideoTrackerPropagateDialog)。
 * 把当前帧的框复制到后续 / 向前 N 帧, overwrite 控制是否覆盖目标帧已有关键帧。
 *
 * v0.10.35 · §A: 采样开启 (samplingStep>1) 时, count 以网格格子为单位, 与 ←/→ 网格导航统一;
 * 提交时换算回源帧 count (count * samplingStep), 底层 D2 (propagateKeyframes) 仍逐源帧不变。
 */
export function VideoKeyframesPropagateDialog({
  open,
  frameIndex,
  userId,
  samplingStep = 1,
  overwriteOverride = null,
  onCancel,
  onSubmit,
}: VideoKeyframesPropagateDialogProps) {
  const [direction, setDirection] = useState<VideoPropagateDirection>("forward");
  const [count, setCount] = useState<number>(10);
  const [overwrite, setOverwrite] = useState<boolean>(false);

  useEffect(() => {
    if (open) {
      const remembered = readDialogMemory(
        userId,
        "kfPropagate",
        validateKeyframesMemory,
      );
      setDirection(remembered?.direction ?? "forward");
      setCount(remembered?.count ?? 10);
      setOverwrite(overwriteOverride ?? remembered?.overwrite ?? false);
    }
  }, [open, overwriteOverride, userId]);

  if (!open) return null;

  const grid = Math.max(1, Math.round(samplingStep));
  const dir = direction === "backward" ? -1 : 1;
  // count 是网格格子数; 采样开启时换算成源帧跨度。
  const sourceCount = count * grid;
  const target = Math.max(0, frameIndex + dir * sourceCount);
  const overwriteLocked = overwriteOverride !== null && overwriteOverride !== undefined;
  const effectiveOverwrite = overwriteLocked ? overwriteOverride === true : overwrite;

  const handleSubmit = () => {
    if (count <= 0) return;
    onSubmit({ direction, count: sourceCount, overwrite: effectiveOverwrite });
    if (!overwriteLocked) {
      writeDialogMemory(userId, "kfPropagate", { direction, count, overwrite });
    }
  };

  return (
    <div
      role="dialog"
      aria-label="复制到后续帧"
      data-testid="video-keyframes-propagate-dialog"
      className={styles.backdrop}
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className={styles.dialog}>
        <div className={styles.header}>
          <b className={styles.title}>复制框到后续帧</b>
          <button type="button" onClick={onCancel} className={styles.closeButton}>
            ✕
          </button>
        </div>

        <label className={styles.field}>
          方向
          <div className={styles.segmented}>
            {(["forward", "backward"] as VideoPropagateDirection[]).map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDirection(d)}
                className={cn(styles.optionButton, direction === d && styles.optionButtonSelected)}
              >
                {d === "forward" ? "向后" : "向前"}
              </button>
            ))}
          </div>
        </label>

        <label className={styles.field}>
          {grid > 1 ? "格数" : "帧数"}
          <div className={styles.segmented}>
            {COUNT_PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => setCount(preset)}
                className={cn(styles.optionButton, count === preset && styles.optionButtonSelected)}
              >
                {preset}
              </button>
            ))}
          </div>
          <input
            type="number"
            min={1}
            value={count}
            onChange={(e) => setCount(Math.max(1, Math.floor(Number(e.target.value) || 0)))}
            className={styles.numberInput}
          />
          <span className={cn("mono", styles.rangeHint)}>
            {grid > 1 ? (
              <>
                G{Math.round(frameIndex / grid)} → G{Math.round(target / grid)} (F
                {frameIndex} → F{target})
              </>
            ) : (
              <>
                F{frameIndex} → F{target}
              </>
            )}
          </span>
        </label>

        <label className={styles.checkboxField}>
          <input
            type="checkbox"
            checked={effectiveOverwrite}
            disabled={overwriteLocked}
            onChange={(e) => setOverwrite(e.target.checked)}
          />
          {overwriteLocked ? "覆盖目标帧已有关键帧（项目锁定）" : "覆盖目标帧已有关键帧"}
        </label>

        <div className={styles.actions}>
          <Button variant="ghost" size="sm" onClick={onCancel}>
            取消
          </Button>
          <Button size="sm" onClick={handleSubmit} disabled={count <= 0}>
            复制
          </Button>
        </div>
      </div>
    </div>
  );
}
