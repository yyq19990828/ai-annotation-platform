import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { useTask, useAnnotations } from "@/hooks/useTasks";
import { usePredictions } from "@/hooks/usePredictions";
import { ImageStage } from "@/pages/Workbench/stage/ImageStage";
import {
  annotationToBox, predictionsToBoxes,
} from "@/pages/Workbench/state/transforms";
import { useViewportTransform } from "@/pages/Workbench/state/useViewportTransform";
import { CommentsPanel } from "@/pages/Workbench/shell/CommentsPanel";
import { useAuthStore } from "@/stores/authStore";

type DiffMode = "final" | "raw" | "diff";

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
          <Button variant="primary" size="sm" onClick={onApprove}>
            <Icon name="check" size={12} />通过
          </Button>
          <Button variant="danger" size="sm" onClick={onReject}>
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
