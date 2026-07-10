import { Button } from "@/components/ui/Button";
// v0.21.28 · 候选/接受流审阅条: 与 AI 追踪对话框 / SAM 交互工具条同款顶部悬浮 chrome。
import {
  TOOLBAR_CHROME_CLASS,
  TOOLBAR_DIVIDER,
} from "../shell/workbenchToolbarChrome";

function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

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
      data-testid="video-tracker-review-bar"
      className={cn(
        "fixed left-1/2 top-16 z-workbench-modal max-w-[calc(100%-1.5rem)] -translate-x-1/2",
        TOOLBAR_CHROME_CLASS,
      )}
    >
      <div className="flex items-center gap-2.5">
        <b className="whitespace-nowrap text-xs">AI 追踪候选</b>
        <span className="whitespace-nowrap text-2xs text-muted-foreground">
          {frameCount} 帧{targetCount > 1 ? ` · ${targetCount} 目标` : ""} · 审阅后落库
        </span>
        {TOOLBAR_DIVIDER}
        <div className="flex shrink-0 items-center gap-1.5">
          <Button
            variant="ghost"
            size="sm"
            onClick={onDiscard}
            disabled={submitting}
            data-testid="tracker-review-discard"
          >
            丢弃
          </Button>
          <Button
            size="sm"
            onClick={onAccept}
            disabled={submitting}
            data-testid="tracker-review-accept"
          >
            接受
          </Button>
        </div>
      </div>
      <div className="text-2xs text-muted-foreground">
        画布以候选框预览; 接受落库、丢弃则标注零改动。
      </div>
    </div>
  );
}
