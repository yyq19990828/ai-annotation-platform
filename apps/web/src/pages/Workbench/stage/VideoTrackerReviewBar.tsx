import { Bot, Check, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/Button";

export interface VideoTrackerReviewBarProps {
  /** 有待审候选时显示。 */
  open: boolean;
  /** 候选覆盖的帧数。 */
  frameCount: number;
  /** 候选目标数 (distinct instance); >1 显示「M 目标」。 */
  targetCount: number;
  /** 接受/丢弃进行中 (禁用按钮)。 */
  submitting?: boolean;
  /** 接受: 把候选落库。 */
  onAccept: () => void;
  /** 丢弃: 弃用候选, annotation 零改动。 */
  onDiscard: () => void;
}

/**
 * v0.21.28 · 视频 AI 追踪「候选/接受」审阅条。
 *
 * 追踪完成后结果先暂存为候选 (画布以候选框叠加预览), 此条给「接受」(落库) /「丢弃」(弃用)。
 * 接受前 committed 标注零改动。顶部居中悬浮, 与 AI 追踪对话框互斥 (对话框提交后才出此条)。
 */
export function VideoTrackerReviewBar({
  open,
  frameCount,
  targetCount,
  submitting = false,
  onAccept,
  onDiscard,
}: VideoTrackerReviewBarProps) {
  if (!open) return null;
  return (
    <div
      role="dialog"
      aria-label="AI 追踪候选审阅"
      aria-live="polite"
      data-testid="video-tracker-review-bar"
      className="absolute left-1/2 top-3 z-workbench-modal w-[min(38rem,calc(100%-1.5rem))] -translate-x-1/2 overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-xl"
    >
      <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-status-info-soft text-status-info">
            <Bot className="size-4" />
          </span>
          <div className="flex min-w-0 flex-col gap-1">
            <h2 className="text-sm font-semibold tracking-tight">AI 追踪候选</h2>
            <p className="text-xs leading-relaxed text-muted-foreground">
              已生成 {frameCount} 帧{targetCount > 1 ? `，${targetCount} 个目标` : ""}，确认后才会写入轨迹。
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center justify-end gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={onDiscard}
            disabled={submitting}
            data-testid="tracker-review-discard"
          >
            <Trash2 data-icon="inline-start" />
            丢弃
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={onAccept}
            disabled={submitting}
            data-testid="tracker-review-accept"
          >
            <Check data-icon="inline-start" />
            接受
          </Button>
        </div>
      </div>
      <div className="border-t border-border bg-muted/30 px-4 py-2 text-2xs leading-relaxed text-muted-foreground">
        画布中已显示候选结果。丢弃不会改动原有标注。
      </div>
    </div>
  );
}
