import { useLayoutEffect, useRef, useState, type ChangeEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { useCreateFeedback } from "@/hooks/useFeedbacks";
import type { FeedbackSeverity, ListFeedbacksParams } from "@/api/feedbacks";
import type { IssuePinAnchor } from "../state/useIssuePins";
import { validIssueFrameRange } from "../state/videoIssueContext";

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
  /** The clicked normalized point and, for video, its confirmed source frame. */
  prefilledAnchor?: IssuePinAnchor | null;
  /** Task-only video entry cannot promote unverified coordinates into a pixel Issue. */
  anchorMode?: "pixel" | "task";
  onClose: () => void;
}

export function IssueCreateModal(props: Props) {
  if (!props.open) return null;
  return <IssueCreateSession key={JSON.stringify([props.projectId, props.taskId])} {...props} />;
}

function IssueCreateSession({
  projectId,
  taskId,
  listParams,
  prefilledAnchor,
  anchorMode = "pixel",
  onClose,
}: Props) {
  // Each opening/task owns its form and mutation observer, including A → B → A.
  const [snapshot] = useState(() => ({
    projectId,
    taskId,
    listParams: { ...listParams },
    anchor: anchorMode === "pixel" && prefilledAnchor ? structuredClone(prefilledAnchor) : null,
    anchorMode,
  }));
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [severity, setSeverity] = useState<FeedbackSeverity>("warn");
  const [x, setX] = useState(() => snapshot.anchor?.x.toFixed(3) ?? "");
  const [y, setY] = useState(() => snapshot.anchor?.y.toFixed(3) ?? "");
  const [rangeEnabled, setRangeEnabled] = useState(false);
  const [rangeFrom, setRangeFrom] = useState(() => String(snapshot.anchor?.frame ?? 0));
  const [rangeTo, setRangeTo] = useState(() => String(snapshot.anchor?.frame ?? 0));
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const createMut = useCreateFeedback(snapshot.listParams);
  const mountedRef = useRef(true);
  const closedRef = useRef(false);
  const requestRef = useRef<object | null>(null);

  useLayoutEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestRef.current = null;
    };
  }, []);

  const parsedX = parseFloat(x);
  const parsedY = parseFloat(y);
  const hasValidPixel =
    Number.isFinite(parsedX) &&
    Number.isFinite(parsedY) &&
    parsedX >= 0 &&
    parsedX <= 1 &&
    parsedY >= 0 &&
    parsedY <= 1;
  const pixelMode = snapshot.anchorMode === "pixel" && (x !== "" || y !== "");
  const pixelInvalid = pixelMode && !hasValidPixel;
  const frame = snapshot.anchor?.frame;
  const videoContext = snapshot.anchor?.videoContext;
  const rangeInvalid =
    pixelMode &&
    !!videoContext &&
    rangeEnabled &&
    (frame === undefined ||
      !validIssueFrameRange(rangeFrom, rangeTo, frame, snapshot.anchor?.maxFrame));

  const canSubmit =
    body.trim().length > 0 && !pixelInvalid && !rangeInvalid && !submitting && !createMut.isPending;

  const handleClose = () => {
    closedRef.current = true;
    requestRef.current = null;
    onClose();
  };

  const handleSubmit = () => {
    if (!canSubmit || closedRef.current || requestRef.current) return;
    const request = {};
    requestRef.current = request;
    setSubmitting(true);
    setSubmitError(null);
    const isCurrent = () =>
      mountedRef.current && !closedRef.current && requestRef.current === request;
    createMut.mutate(
      {
        kind: "issue",
        anchor_type: pixelMode ? "pixel" : "task",
        project_id: snapshot.projectId,
        task_id: snapshot.taskId,
        ...(pixelMode && snapshot.anchor?.annotationId
          ? { annotation_id: snapshot.anchor.annotationId }
          : {}),
        anchor_position: pixelMode
          ? {
              x: parsedX,
              y: parsedY,
              ...(frame !== undefined ? { frame } : {}),
              ...(videoContext && frame !== undefined
                ? {
                    video_context: {
                      ...videoContext,
                      ...(rangeEnabled
                        ? {
                            frame_range: {
                              from_frame: Number(rangeFrom),
                              to_frame: Number(rangeTo),
                            },
                          }
                        : {}),
                    },
                  }
                : {}),
            }
          : null,
        severity,
        title: title.trim() || null,
        body: body.trim(),
      },
      {
        onSuccess: () => {
          if (!isCurrent()) return;
          requestRef.current = null;
          setSubmitting(false);
          setTitle("");
          setBody("");
          setX("");
          setY("");
          handleClose();
        },
        onError: (error) => {
          if (!isCurrent()) return;
          requestRef.current = null;
          setSubmitting(false);
          setSubmitError(error instanceof Error ? error.message : "创建失败，请重试");
        },
      },
    );
  };

  return (
    <div
      className="fixed inset-0 z-workbench-modal flex items-center justify-center bg-black/40"
      onClick={handleClose}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || event.nativeEvent.isComposing) return;
        event.preventDefault();
        event.stopPropagation();
        handleClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label="标记问题"
      data-workbench-issue-create
      data-state="open"
    >
      <div
        className="flex max-h-[88vh] w-[min(480px,92vw)] flex-col gap-3 overflow-auto rounded-lg border border-border bg-card p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border pb-2">
          <b className="inline-flex items-center gap-1.5 text-sm text-foreground">
            <Icon name="flag" size={14} /> 标记问题 (Issue)
          </b>
          <Button variant="ghost" size="sm" onClick={handleClose} title="关闭">
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

        {snapshot.anchorMode === "pixel" ? (
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-muted-foreground">像素锚点（可选, 0-1 相对坐标）</label>
            {pixelMode && frame !== undefined && (
              <span className="text-xs text-muted-foreground" data-testid="issue-create-frame">
                源帧 F {frame}
              </span>
            )}
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
        ) : (
          <p className="m-0 text-xs text-muted-foreground">
            任务级问题不绑定画面位置；标记位置请关闭表单后在视频画面落点。
          </p>
        )}

        {pixelMode && videoContext && frame !== undefined && (
          <div className="flex flex-col gap-2 rounded border border-border bg-muted p-2 text-xs">
            <span data-testid="issue-context-object" className="text-muted-foreground">
              {snapshot.anchor?.annotationId
                ? `对象：${snapshot.anchor.annotationLabel ?? snapshot.anchor.annotationId}${videoContext.annotation_version ? ` · 版本 ${videoContext.annotation_version}` : ""}`
                : "未关联对象"}{" "}
              · 已记录画布视图和时间窗
            </span>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={rangeEnabled}
                data-testid="issue-frame-range-enabled"
                onChange={(event) => setRangeEnabled(event.target.checked)}
              />
              记录源帧范围
            </label>
            {rangeEnabled && (
              <div className="flex items-center gap-2">
                <input
                  className={cn(FIELD_BASE, "min-w-0 flex-1")}
                  type="number"
                  step="1"
                  min="0"
                  max={snapshot.anchor?.maxFrame}
                  aria-label="起始源帧"
                  data-testid="issue-frame-range-from"
                  value={rangeFrom}
                  onChange={(event) => setRangeFrom(event.target.value)}
                />
                <span>至</span>
                <input
                  className={cn(FIELD_BASE, "min-w-0 flex-1")}
                  type="number"
                  step="1"
                  min="0"
                  max={snapshot.anchor?.maxFrame}
                  aria-label="结束源帧"
                  data-testid="issue-frame-range-to"
                  value={rangeTo}
                  onChange={(event) => setRangeTo(event.target.value)}
                />
              </div>
            )}
            {rangeInvalid && (
              <span className="text-status-danger" role="alert">
                范围须为视频内的源帧整数闭区间，且包含 F {frame}。
              </span>
            )}
          </div>
        )}

        {submitError && (
          <p className="m-0 text-xs text-status-danger" role="alert">
            {submitError}
          </p>
        )}

        <div className="flex justify-end gap-2 border-t border-border pt-2.5">
          <Button variant="ghost" size="sm" onClick={handleClose}>
            取消
          </Button>
          <Button size="sm" disabled={!canSubmit} onClick={handleSubmit}>
            {submitting || createMut.isPending ? "提交中…" : "提交"}
          </Button>
        </div>
      </div>
    </div>
  );
}
