/**
 * I18 · 创建 pixel-anchored issue 的简易 modal.
 *
 * v0.10.19 形态:
 * - 输入 title / severity / body
 * - anchor 默认走 task 级 (anchor_type='task'); 用户可选填 x/y (0-1 相对坐标) 升级为 pixel anchor
 * - 不挂截图 / 不挂图上单击落点 (留 v0.10.20 接 ImageStage 时做)
 *
 * 提交成功后调用 onSuccess 让 useFeedbacks 失效重拉.
 */
import { useEffect, useState, type ChangeEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { useCreateFeedback } from "@/hooks/useFeedbacks";
import type { FeedbackSeverity, ListFeedbacksParams } from "@/api/feedbacks";

// UA-safe 文本输入基线(无全局 preflight 期间)。
const FIELD_BASE =
  "appearance-none rounded border border-border bg-muted px-2 py-1.5 text-xs text-foreground outline-none [font:inherit] focus:border-brand";

// 严重度语义色:提示=sky / 警告=amber / 阻断=rose。激活态用 brand 实心填充。
const SEVERITY_TEXT: Record<FeedbackSeverity, string> = {
  info: "text-status-info-alt",
  warn: "text-status-caution",
  blocker: "text-status-danger",
};

function cn(...xs: Array<string | false | null | undefined>): string {
  return xs.filter(Boolean).join(" ");
}

interface Props {
  open: boolean;
  projectId: string;
  taskId: string;
  /** useFeedbacks 当前订阅的 params; 提交后 invalidate 这个 key. */
  listParams: ListFeedbacksParams;
  /** v0.10.20 · I18 · drop-arm 单击图像落点后预填的相对坐标 (0-1). 传入时自动设到 x/y 输入框. */
  prefilledAnchor?: { x: number; y: number } | null;
  onClose: () => void;
}

export function IssueCreateModal({
  open,
  projectId,
  taskId,
  listParams,
  prefilledAnchor,
  onClose,
}: Props) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [severity, setSeverity] = useState<FeedbackSeverity>("warn");
  const [x, setX] = useState<string>("");
  const [y, setY] = useState<string>("");
  const createMut = useCreateFeedback(listParams);

  // v0.10.20 · 打开 modal 且 prefilledAnchor 非空时, 自动填入 x/y (保留 2 位小数, 用户仍可调整).
  useEffect(() => {
    if (open && prefilledAnchor) {
      setX(prefilledAnchor.x.toFixed(3));
      setY(prefilledAnchor.y.toFixed(3));
    }
  }, [open, prefilledAnchor]);

  if (!open) return null;

  const parsedX = parseFloat(x);
  const parsedY = parseFloat(y);
  const hasValidPixel =
    Number.isFinite(parsedX) &&
    Number.isFinite(parsedY) &&
    parsedX >= 0 &&
    parsedX <= 1 &&
    parsedY >= 0 &&
    parsedY <= 1;
  const pixelMode = x !== "" || y !== "";
  const pixelInvalid = pixelMode && !hasValidPixel;

  const canSubmit = body.trim().length > 0 && !pixelInvalid && !createMut.isPending;

  const handleSubmit = () => {
    if (!canSubmit) return;
    createMut.mutate(
      {
        kind: "issue",
        anchor_type: pixelMode ? "pixel" : "task",
        project_id: projectId,
        task_id: taskId,
        anchor_position: pixelMode ? { x: parsedX, y: parsedY } : null,
        severity,
        title: title.trim() || null,
        body: body.trim(),
      },
      {
        onSuccess: () => {
          setTitle("");
          setBody("");
          setX("");
          setY("");
          onClose();
        },
      },
    );
  };

  return (
    <div
      className="fixed inset-0 z-workbench-modal flex items-center justify-center bg-black/40"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="flex max-h-[88vh] w-[min(480px,92vw)] flex-col gap-3 overflow-auto rounded-lg border border-border bg-card p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border pb-2">
          <b className="inline-flex items-center gap-1.5 text-sm text-foreground">
            <Icon name="flag" size={14} /> 标记问题 (Issue)
          </b>
          <Button variant="ghost" size="sm" onClick={onClose} title="关闭">
            <Icon name="x" size={12} />
          </Button>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-muted-foreground">标题（可选）</label>
          <input
            className={FIELD_BASE}
            value={title}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setTitle(e.target.value)}
            placeholder="一句话概括"
            maxLength={500}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-muted-foreground">严重度</label>
          <div className="flex gap-1.5">
            {(["info", "warn", "blocker"] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSeverity(s)}
                className={cn(
                  "cursor-pointer appearance-none rounded-xl border px-2.5 py-1 text-xs [font:inherit]",
                  severity === s
                    ? "border-brand bg-brand text-brand-foreground"
                    : cn("border-border bg-muted", SEVERITY_TEXT[s]),
                )}
                data-severity={s}
              >
                {s === "info" ? "提示" : s === "warn" ? "警告" : "阻断"}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-muted-foreground">
            详情 <span className="text-status-danger">*</span>
          </label>
          <textarea
            className={cn(FIELD_BASE, "min-h-[60px] resize-y")}
            value={body}
            onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setBody(e.target.value)}
            placeholder="描述问题位置 / 现象 / 期望行为"
            rows={4}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-muted-foreground">像素锚点（可选, 0-1 相对坐标）</label>
          <div className="flex gap-2">
            <input
              className={cn(FIELD_BASE, "min-w-0 flex-1")}
              value={x}
              onChange={(e) => setX(e.target.value)}
              placeholder="x (0-1)"
              type="number"
              step="0.01"
              min="0"
              max="1"
            />
            <input
              className={cn(FIELD_BASE, "min-w-0 flex-1")}
              value={y}
              onChange={(e) => setY(e.target.value)}
              placeholder="y (0-1)"
              type="number"
              step="0.01"
              min="0"
              max="1"
            />
          </div>
          {pixelInvalid && (
            <span className="text-xs text-status-danger">
              x/y 必须在 0-1 范围;留空则按任务级 issue 创建
            </span>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-border pt-2.5">
          <Button variant="ghost" size="sm" onClick={onClose}>
            取消
          </Button>
          <Button size="sm" disabled={!canSubmit} onClick={handleSubmit}>
            {createMut.isPending ? "提交中…" : "提交"}
          </Button>
        </div>
      </div>
    </div>
  );
}
