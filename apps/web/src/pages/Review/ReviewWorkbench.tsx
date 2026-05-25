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
import styles from "./ReviewWorkbench.module.css";

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
  // 评论卡片绑定 chip 用：annotation_id → class_name。
  const annotationClassById = useMemo(
    () => Object.fromEntries((annotationsData ?? []).map((a) => [a.id, a.class_name])),
    [annotationsData],
  );
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
    <div className={styles.root}>
    <div className={styles.main}>
      <ReviewerMiniPanel />
      {claimInfo && !claimInfo.is_self && (
        <div className={styles.claimBanner}>
          <Icon name="warning" size={13} />
          已被其他审核员认领（{new Date(claimInfo.reviewer_claimed_at).toLocaleString("zh-CN")}），仍可接力处理
        </div>
      )}
      {task?.skip_reason && (
        <div
          className={styles.skipBanner}
          data-testid="reviewer-skip-banner"
        >
          <Icon name="warning" size={13} />
          标注员跳过此题：<strong>{skipReasonLabel(task.skip_reason)}</strong>
          <span className={styles.skipHint}>
            可通过（无目标即视为完成）或退回重派
          </span>
        </div>
      )}
      <div className={styles.toolbar}>
        <div className={styles.taskInfo}>
          <span className={`mono ${styles.taskId}`}>{task?.display_id ?? "—"}</span>
          <span className={styles.fileName}>{task?.file_name}</span>
          {task?.skip_reason && (
            <span
              className={styles.skipBadge}
              data-testid="reviewer-skip-badge"
            >
              SKIP
            </span>
          )}
        </div>
        <div className={styles.modeGroup}>
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
        <div className={styles.actions}>
          <Button size="sm" onClick={() => setFitTick((n) => n + 1)} className={styles.fitButton}>适应</Button>
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
        className={styles.statusBar}
      >
        <div className={styles.statusItems}>
          <span><span className="mono">{userBoxes.length}</span> 标注</span>
          <span>
            <Icon name="sparkles" size={11} className={styles.aiIcon} />
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
      <aside className={styles.commentsPanel}>
        <CommentsPanel
          annotationId={selectedAnnotation.id}
          projectId={selectedAnnotation.project_id}
          currentUserId={meUserId}
          backgroundUrl={task?.file_url ?? null}
          enableCanvasDrawing
          annotationClassById={annotationClassById}
          onSelectAnnotation={setSelectedId}
        />
      </aside>
    )}
    </div>
  );
}
