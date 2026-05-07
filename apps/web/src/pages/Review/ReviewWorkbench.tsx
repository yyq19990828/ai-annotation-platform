import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { useTask, useAnnotations, useReviewClaim } from "@/hooks/useTasks";
import { usePredictions } from "@/hooks/usePredictions";
import { ImageStage } from "@/pages/Workbench/stage/ImageStage";
import {
  annotationToBox, predictionsToBoxes,
} from "@/pages/Workbench/state/transforms";
import { useViewportTransform } from "@/pages/Workbench/state/useViewportTransform";
import { CommentsPanel } from "@/pages/Workbench/shell/CommentsPanel";
import { ReviewerMiniPanel } from "./ReviewerMiniPanel";
import { useAuthStore } from "@/stores/authStore";
import type { ReviewClaimResponse } from "@/types";

type DiffMode = "final" | "raw" | "diff";

// v0.8.8 · skip_reason 枚举到中文标签
function skipReasonLabel(reason: string): string {
  switch (reason) {
    case "image_corrupt":
      return "图片损坏";
    case "no_target":
      return "无标注目标";
    case "unclear":
      return "标注规则不清";
    case "other":
      return "其他";
    default:
      return reason;
  }
}

interface ReviewWorkbenchProps {
  taskId: string;
  onApprove: () => void;
  onReject: () => void;
  onPrev?: () => void;
  onNext?: () => void;
}

export function ReviewWorkbench({ taskId, onApprove, onReject, onPrev, onNext }: ReviewWorkbenchProps) {
  const { data: task } = useTask(taskId);
  const { data: annotationsData } = useAnnotations(taskId);
  const predictionsInfinite = usePredictions(taskId);
  const predictionsData = useMemo(
    () => (predictionsInfinite.data?.pages ?? []).flatMap((p) => p),
    [predictionsInfinite.data],
  );

  const [mode, setMode] = useState<DiffMode>("diff");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const { vp, setVp } = useViewportTransform();
  const [fitTick, setFitTick] = useState(0);
  const meUserId = useAuthStore((s) => s.user?.id);

  // v0.6.5: 进入审核页时调 claim（幂等），冻结标注员的 withdraw 入口；
  // 仅在 status=review 时调用，避免对 completed/rejected 任务多余请求。
  const claimMut = useReviewClaim();
  const [claimInfo, setClaimInfo] = useState<ReviewClaimResponse | null>(null);
  useEffect(() => {
    if (!taskId || task?.status !== "review") return;
    claimMut.mutate(taskId, {
      onSuccess: (data) => setClaimInfo(data),
      onError: () => {},
    });
    // claimMut intentionally omitted to keep effect single-fire per task
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId, task?.status]);

  const selectedAnnotation = useMemo(
    () => (annotationsData ?? []).find((a) => a.id === selectedId) ?? null,
    [annotationsData, selectedId],
  );

  const userBoxes = useMemo(() => (annotationsData ?? []).map(annotationToBox), [annotationsData]);
  const allAi = useMemo(() => predictionsToBoxes(predictionsData), [predictionsData]);

  // 已被采纳的 prediction id 集合
  const acceptedPredIds = useMemo(() => {
    const s = new Set<string>();
    for (const a of annotationsData ?? []) {
      if (a.parent_prediction_id) s.add(a.parent_prediction_id);
    }
    return s;
  }, [annotationsData]);

  const fadedAiIds = useMemo(() => {
    const s = new Set<string>();
    for (const b of allAi) if (acceptedPredIds.has(b.predictionId)) s.add(b.id);
    return s;
  }, [allAi, acceptedPredIds]);

  const renderUser = mode !== "raw";
  const renderAi = mode !== "final";

  return (
    <div style={{ display: "flex", flexDirection: "row", height: "100%", overflow: "hidden" }}>
    <div style={{ display: "flex", flexDirection: "column", flex: 1, overflow: "hidden" }}>
      <ReviewerMiniPanel />
      {claimInfo && !claimInfo.is_self && (
        <div
          style={{
            padding: "6px 14px",
            background: "oklch(0.95 0.05 70)",
            borderBottom: "1px solid oklch(0.85 0.10 70)",
            fontSize: 12, color: "oklch(0.40 0.15 70)",
            display: "flex", alignItems: "center", gap: 6,
          }}
        >
          <Icon name="warning" size={13} />
          已被其他审核员认领（{new Date(claimInfo.reviewer_claimed_at).toLocaleString("zh-CN")}），仍可接力处理
        </div>
      )}
      {task?.skip_reason && (
        <div
          style={{
            padding: "6px 14px",
            background: "oklch(0.94 0.06 300)",
            borderBottom: "1px solid oklch(0.78 0.12 300)",
            fontSize: 12,
            color: "oklch(0.35 0.18 300)",
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
          data-testid="reviewer-skip-banner"
        >
          <Icon name="warning" size={13} />
          标注员跳过此题：<strong>{skipReasonLabel(task.skip_reason)}</strong>
          <span style={{ marginLeft: 8, color: "oklch(0.45 0.10 300)" }}>
            可通过（无目标即视为完成）或退回重派
          </span>
        </div>
      )}
      <div
        style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "8px 14px",
          background: "var(--color-bg-elev)", borderBottom: "1px solid var(--color-border)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span className="mono" style={{ fontSize: 12, fontWeight: 600 }}>{task?.display_id ?? "—"}</span>
          <span style={{ fontSize: 12, color: "var(--color-fg-muted)" }}>{task?.file_name}</span>
          {task?.skip_reason && (
            <span
              style={{
                marginLeft: 4,
                padding: "1px 6px",
                fontSize: 10,
                fontWeight: 600,
                borderRadius: 3,
                background: "oklch(0.45 0.18 300)",
                color: "white",
                textTransform: "uppercase",
                letterSpacing: 0.4,
              }}
              data-testid="reviewer-skip-badge"
            >
              SKIP
            </span>
          )}
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          {(["final", "raw", "diff"] as const).map((m) => (
            <Button
              key={m}
              variant={mode === m ? "primary" : "ghost"} size="sm"
              onClick={() => setMode(m)}
            >
              {m === "final" ? "仅最终" : m === "raw" ? "仅 AI 原始" : "叠加 diff"}
            </Button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <Button size="sm" onClick={() => setFitTick((n) => n + 1)} style={{ fontSize: 11 }}>适应</Button>
          <Button
            size="sm"
            variant={commentsOpen ? "primary" : "ghost"}
            onClick={() => setCommentsOpen((v) => !v)}
            disabled={!selectedAnnotation}
            title={selectedAnnotation ? "查看 / 留下批注（含画布批注）" : "先选中一个标注"}
          >
            <Icon name="bell" size={12} />评论
          </Button>
          {onPrev && <Button size="sm" onClick={onPrev}><Icon name="chevLeft" size={12} />上一</Button>}
          {onNext && <Button size="sm" onClick={onNext}>下一<Icon name="chevRight" size={12} /></Button>}
          <Button
            variant="primary"
            size="sm"
            onClick={onApprove}
            data-testid="review-approve"
          >
            <Icon name="check" size={12} />通过
          </Button>
          <Button
            variant="danger"
            size="sm"
            onClick={onReject}
            data-testid="review-reject"
          >
            <Icon name="x" size={12} />退回
          </Button>
        </div>
      </div>

      <ImageStage
        fileUrl={task?.file_url ?? null}
        tool="hand"
        activeClass=""
        selectedId={selectedId}
        userBoxes={renderUser ? userBoxes : []}
        aiBoxes={renderAi ? allAi : []}
        spacePan={false}
        vp={vp}
        setVp={setVp}
        fitTick={fitTick}
        readOnly
        fadedAiIds={mode === "diff" ? fadedAiIds : undefined}
        onSelectBox={setSelectedId}
        onCursorMove={() => {}}
      />

      <div
        style={{
          padding: "6px 14px",
          background: "var(--color-bg-elev)", borderTop: "1px solid var(--color-border)",
          display: "flex", justifyContent: "space-between",
          fontSize: 11.5, color: "var(--color-fg-muted)",
        }}
      >
        <div style={{ display: "flex", gap: 16 }}>
          <span><span className="mono">{userBoxes.length}</span> 标注</span>
          <span>
            <Icon name="sparkles" size={11} style={{ color: "var(--color-ai)", verticalAlign: "-2px" }} />
            {" "}<span className="mono">{allAi.length}</span> AI 预测（{acceptedPredIds.size} 已采纳）
          </span>
        </div>
        <div className="mono">
          {task?.image_width && task?.image_height
            ? `${task.image_width}×${task.image_height}`
            : "—"}
        </div>
      </div>
    </div>
    {commentsOpen && selectedAnnotation && (
      <aside
        style={{
          width: 320,
          borderLeft: "1px solid var(--color-border)",
          background: "var(--color-bg-elev)",
          overflowY: "auto",
        }}
      >
        <CommentsPanel
          annotationId={selectedAnnotation.id}
          projectId={selectedAnnotation.project_id}
          currentUserId={meUserId}
          backgroundUrl={task?.file_url ?? null}
          enableCanvasDrawing
        />
      </aside>
    )}
    </div>
  );
}
