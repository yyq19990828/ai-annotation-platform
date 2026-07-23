import { useEffect, useMemo, useState } from "react";

import { Bot, Check, RefreshCw, ShieldAlert, X } from "lucide-react";

import type { VideoTrackerJobPreview } from "@/api/videoTracker";
import type {
  TrackerReviewDecision,
  TrackerReviewDecisionOutcome,
} from "@/hooks/useVideoTrackerJobs";
import { Button } from "@/components/ui/Button";

export interface VideoTrackerReviewBarProps {
  open: boolean;
  preview: VideoTrackerJobPreview | null;
  submitting?: boolean;
  onDecide: (selection: TrackerReviewDecision) => Promise<TrackerReviewDecisionOutcome>;
  onRefresh: () => void;
}

function instanceKey(value: string | null | undefined): string {
  return value ?? "1";
}

function directionLabel(direction: VideoTrackerJobPreview["direction"]): string {
  if (direction === "backward") return "向更早帧";
  if (direction === "forward") return "向更晚帧";
  if (direction === "bidirectional") return "双向";
  return "指定窗口";
}

export function VideoTrackerReviewBar({
  open,
  preview,
  submitting = false,
  onDecide,
  onRefresh,
}: VideoTrackerReviewBarProps) {
  const instances = useMemo(
    () =>
      [...new Set((preview?.results ?? []).map((item) => instanceKey(item.instance_id)))].sort(),
    [preview?.results],
  );
  const frames = (preview?.results ?? []).map((item) => item.frame_index);
  const minFrame = frames.length > 0 ? Math.min(...frames) : 0;
  const maxFrame = frames.length > 0 ? Math.max(...frames) : 0;
  const [selectedInstances, setSelectedInstances] = useState<string[]>([]);
  const [fromFrame, setFromFrame] = useState(0);
  const [toFrame, setToFrame] = useState(0);

  useEffect(() => {
    setSelectedInstances(instances);
    setFromFrame(minFrame);
    setToFrame(maxFrame);
  }, [instances, maxFrame, minFrame, preview?.job_id, preview?.job_revision]);

  const selected = (preview?.results ?? []).filter(
    (item) =>
      selectedInstances.includes(instanceKey(item.instance_id)) &&
      item.frame_index >= fromFrame &&
      item.frame_index <= toFrame,
  );
  const manualCount = selected.filter((item) => item.manual_protected).length;
  const total =
    preview?.candidate_total ??
    (preview?.results.length ?? 0) +
      (preview?.candidate_accepted ?? 0) +
      (preview?.candidate_rejected ?? 0);
  const resolved = (preview?.candidate_accepted ?? 0) + (preview?.candidate_rejected ?? 0);
  const disabled = submitting || selected.length === 0 || fromFrame > toFrame;
  const isCorrection = preview?.job_kind === "correction";

  const submit = async (decision: "accept" | "reject") => {
    const selection: TrackerReviewDecision = {
      instance_ids: selectedInstances,
      from_frame: fromFrame,
      to_frame: toFrame,
      decision,
      override_manual: false,
    };
    await onDecide(selection);
  };

  if (!open || !preview) return null;
  return (
    <div
      role="dialog"
      aria-label={isCorrection ? "Mask 纠错候选审阅" : "AI 追踪候选审阅"}
      aria-live="polite"
      data-testid="video-tracker-review-bar"
      className="absolute left-1/2 top-3 z-workbench-modal w-[min(46rem,calc(100%-1.5rem))] -translate-x-1/2 overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-xl"
    >
      <div className="flex flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-status-info-soft text-status-info">
              <Bot className="size-4" />
            </span>
            <div className="flex min-w-0 flex-col gap-1">
              <h2 className="text-sm font-semibold tracking-tight">
                {isCorrection ? "Mask 纠错传播候选" : "AI 追踪候选"}
              </h2>
              <p className="text-xs leading-relaxed text-muted-foreground">
                已审 {resolved}/{total}，当前选区 {selected.length} 个候选；确认后才写入轨迹。
              </p>
              {isCorrection ? (
                <p
                  className="text-xs leading-relaxed text-muted-foreground"
                  data-testid="tracker-review-correction-summary"
                >
                  F{preview.correction_frame} 人工纠错帧 · 窗口 F{preview.from_frame}–F
                  {preview.to_frame} · {directionLabel(preview.direction)} ·
                  {preview.seed_mode === "native_mask" ? " 原生 Mask seed" : " bbox seed 降级"}
                  {preview.protect_manual ? " · 保护人工帧" : ""}
                </p>
              ) : null}
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={onRefresh} disabled={submitting}>
            <RefreshCw data-icon="inline-start" />
            刷新
          </Button>
        </div>

        <div className="grid gap-3 rounded-lg border border-border bg-muted/20 p-3 sm:grid-cols-[1fr_auto]">
          <fieldset className="flex min-w-0 flex-wrap gap-x-3 gap-y-2">
            <legend className="mb-2 text-2xs font-medium text-muted-foreground">目标</legend>
            {instances.map((instanceId) => (
              <label key={instanceId} className="flex items-center gap-1.5 text-xs">
                <input
                  type="checkbox"
                  checked={selectedInstances.includes(instanceId)}
                  onChange={(event) =>
                    setSelectedInstances((current) =>
                      event.target.checked
                        ? [...current, instanceId]
                        : current.filter((item) => item !== instanceId),
                    )
                  }
                  data-testid={`tracker-review-instance-${instanceId}`}
                />
                {instanceId}
              </label>
            ))}
          </fieldset>
          <div className="flex items-end gap-2">
            <label className="grid gap-1 text-2xs text-muted-foreground">
              起始帧
              <input
                type="number"
                min={minFrame}
                max={maxFrame}
                value={fromFrame}
                onChange={(event) => setFromFrame(Number(event.target.value))}
                data-testid="tracker-review-from-frame"
                className="h-8 w-20 rounded-md border border-border bg-background px-2 text-xs text-foreground"
              />
            </label>
            <label className="grid gap-1 text-2xs text-muted-foreground">
              结束帧
              <input
                type="number"
                min={minFrame}
                max={maxFrame}
                value={toFrame}
                onChange={(event) => setToFrame(Number(event.target.value))}
                data-testid="tracker-review-to-frame"
                className="h-8 w-20 rounded-md border border-border bg-background px-2 text-xs text-foreground"
              />
            </label>
          </div>
        </div>

        {manualCount > 0 ? (
          <div
            className="flex items-center gap-2 text-xs text-status-warning"
            data-testid="tracker-review-manual-warning"
          >
            <ShieldAlert className="size-4" />
            选区包含 {manualCount} 个受保护的人工关键帧，审阅条不会覆盖这些帧。
          </div>
        ) : null}

        {isCorrection && preview.fallback_reason ? (
          <div
            className="flex items-center gap-2 text-xs text-status-warning"
            data-testid="tracker-review-fallback-warning"
          >
            <ShieldAlert className="size-4" />
            当前候选使用 bbox seed 降级：{preview.fallback_reason}。输出仍为 Mask。
          </div>
        ) : null}

        <div className="flex items-center justify-end gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void submit("reject")}
            disabled={disabled}
            data-testid="tracker-review-discard"
          >
            <X data-icon="inline-start" />
            拒绝所选
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => void submit("accept")}
            disabled={disabled || manualCount > 0}
            data-testid="tracker-review-accept"
          >
            <Check data-icon="inline-start" />
            接受所选
          </Button>
        </div>
      </div>
      <div className="border-t border-border bg-muted/30 px-4 py-2 text-2xs leading-relaxed text-muted-foreground">
        窗口外、未选目标和未决候选保持不变。拒绝不会修改已保存标注。
      </div>
    </div>
  );
}
