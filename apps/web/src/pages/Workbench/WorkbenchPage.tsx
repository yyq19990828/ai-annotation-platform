import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { Icon } from "@/components/ui/Icon";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { useToastStore } from "@/components/ui/Toast";
import { useAppStore } from "@/stores/appStore";
import { useTaskList, useAnnotations, useCreateAnnotation, useDeleteAnnotation, useSubmitTask } from "@/hooks/useTasks";
import { usePredictions, useAcceptPrediction } from "@/hooks/usePredictions";
import { usePreannotationProgress, useTriggerPreannotation } from "@/hooks/usePreannotation";
import { useTaskLock } from "@/hooks/useTaskLock";
import type { Annotation, TaskResponse, PredictionResponse, AnnotationResponse } from "@/types";

const CLASS_COLORS: Record<string, string> = {
  商品: "oklch(0.62 0.18 252)",
  价签: "oklch(0.65 0.18 152)",
  标识牌: "oklch(0.68 0.16 75)",
  缺货位: "oklch(0.62 0.20 25)",
  促销贴: "oklch(0.60 0.20 295)",
};

function annotationToBox(a: AnnotationResponse): Annotation {
  return {
    id: a.id,
    x: a.geometry.x,
    y: a.geometry.y,
    w: a.geometry.w,
    h: a.geometry.h,
    cls: a.class_name,
    conf: a.confidence ?? 1,
    source: a.source as Annotation["source"],
    parent_prediction_id: a.parent_prediction_id,
    lead_time: a.lead_time,
  };
}

function predictionsToBoxes(predictions: PredictionResponse[]): (Annotation & { predictionId: string })[] {
  return predictions.flatMap((p) =>
    p.result.map((shape, i) => ({
      id: `pred-${p.id}-${i}`,
      predictionId: p.id,
      x: shape.geometry.x,
      y: shape.geometry.y,
      w: shape.geometry.w,
      h: shape.geometry.h,
      cls: shape.class_name,
      conf: shape.confidence,
      source: "prediction_based" as const,
    })),
  );
}

function ImageBackdrop({ url, seed = 0 }: { url: string | null; seed: number }) {
  if (url) {
    return (
      <img
        src={url}
        alt="task"
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain", display: "block" }}
        draggable={false}
      />
    );
  }
  const items: { x: number; y: number; w: number; h: number; hue: number }[] = [];
  for (let r = 0; r < 2; r++) {
    for (let c = 0; c < 6; c++) {
      items.push({
        x: 60 + c * 140 + (seed % 3) * 4,
        y: 120 + r * 280,
        w: 110,
        h: 240,
        hue: (c * 37 + r * 71 + seed * 13) % 360,
      });
    }
  }
  return (
    <svg viewBox="0 0 900 600" preserveAspectRatio="xMidYMid slice" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block" }}>
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#e9eaee" />
          <stop offset="1" stopColor="#cfd2d8" />
        </linearGradient>
      </defs>
      <rect width="900" height="600" fill="url(#bg)" />
      <rect x="20" y="80" width="860" height="500" fill="#d6d8de" />
      <rect x="20" y="80" width="860" height="14" fill="#9ea2aa" />
      <rect x="20" y="360" width="860" height="10" fill="#a4a8b0" />
      <rect x="20" y="566" width="860" height="14" fill="#9ea2aa" />
      {items.map((it, i) => (
        <g key={i}>
          <rect x={it.x} y={it.y} width={it.w} height={it.h} fill={`oklch(0.7 0.10 ${it.hue})`} stroke={`oklch(0.45 0.12 ${it.hue})`} strokeWidth="1.5" rx="3" />
          <rect x={it.x + 8} y={it.y + 30} width={it.w - 16} height={36} fill={`oklch(0.92 0.05 ${it.hue})`} opacity="0.8" />
        </g>
      ))}
      <rect x="20" y="442" width="860" height="32" fill="#f4f1e8" stroke="#bcb8a8" />
      <text x="40" y="50" fill="#6b6f78" fontSize="13" fontFamily="ui-monospace, monospace">
        CAM-02 · AISLE-03 · {new Date().toISOString().slice(0, 19).replace("T", " ")}
      </text>
    </svg>
  );
}

interface BoxOverlayProps {
  b: Annotation;
  isAi?: boolean;
  selected: boolean;
  onClick: () => void;
  onAccept?: () => void;
  onReject?: () => void;
  onDelete?: () => void;
}

function BoxOverlay({ b, isAi, selected, onClick, onAccept, onReject, onDelete }: BoxOverlayProps) {
  const color = CLASS_COLORS[b.cls] || "var(--color-accent)";
  return (
    <div
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      style={{
        position: "absolute",
        left: b.x * 100 + "%", top: b.y * 100 + "%",
        width: b.w * 100 + "%", height: b.h * 100 + "%",
        border: `${selected ? 2 : 1.5}px ${isAi ? "dashed" : "solid"} ${color}`,
        background: isAi ? color + "15" : color + "12",
        boxShadow: selected ? `0 0 0 1px ${color}, 0 4px 12px ${color}40` : "none",
        cursor: "pointer",
        zIndex: selected ? 5 : 1,
      }}
    >
      <div style={{
        position: "absolute", top: -22, left: -1,
        background: color, color: "white", fontSize: 10.5,
        padding: "2px 6px", borderRadius: 3, whiteSpace: "nowrap",
        display: "flex", alignItems: "center", gap: 4,
      }}>
        {isAi && <Icon name="sparkles" size={9} />}
        {b.cls}
        {b.conf !== undefined && <span style={{ opacity: 0.85, fontFamily: "var(--font-mono)" }}>{(b.conf * 100).toFixed(0)}</span>}
      </div>
      {isAi && selected && (
        <div style={{ position: "absolute", bottom: -28, right: 0, display: "flex", gap: 4, background: "white", borderRadius: 4, padding: 2, boxShadow: "var(--shadow-md)" }}>
          <Button variant="primary" size="sm" onClick={(e) => { e.stopPropagation(); onAccept?.(); }}>
            <Icon name="check" size={10} />采纳
          </Button>
          <Button variant="danger" size="sm" onClick={(e) => { e.stopPropagation(); onReject?.(); }}>
            <Icon name="x" size={10} />驳回
          </Button>
        </div>
      )}
      {!isAi && selected && (
        <div style={{ position: "absolute", bottom: -28, right: 0, display: "flex", gap: 4, background: "white", borderRadius: 4, padding: 2, boxShadow: "var(--shadow-md)" }}>
          <Button variant="danger" size="sm" onClick={(e) => { e.stopPropagation(); onDelete?.(); }}>
            <Icon name="trash" size={10} />删除
          </Button>
        </div>
      )}
    </div>
  );
}

function BoxListItem({ b, isAi, selected, onSelect, onAccept, onReject, onDelete }: {
  b: Annotation; isAi?: boolean; selected: boolean; onSelect: () => void;
  onAccept?: () => void; onReject?: () => void; onDelete?: () => void;
}) {
  const color = CLASS_COLORS[b.cls] || "var(--color-accent)";
  return (
    <div onClick={onSelect} style={{
      padding: "6px 8px", borderRadius: "var(--radius-md)", cursor: "pointer",
      background: selected ? "var(--color-bg-sunken)" : "transparent",
      border: "1px solid " + (selected ? "var(--color-border-strong)" : "transparent"),
      marginBottom: 2,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
        <span style={{ width: 8, height: 8, borderRadius: 2, background: color, flex: "0 0 8px" }} />
        <span style={{ fontWeight: 500 }}>{b.cls}</span>
        {isAi ? (
          <Badge variant="ai" style={{ fontSize: 9.5, padding: "1px 5px", marginLeft: "auto" }}>
            <Icon name="sparkles" size={8} />{(b.conf * 100).toFixed(0)}%
          </Badge>
        ) : (
          <Badge variant={b.source === "prediction_based" ? "default" : "accent"} style={{ fontSize: 9.5, padding: "1px 5px", marginLeft: "auto" }}>
            {b.source === "prediction_based" ? "AI 采纳" : "手动"}
          </Badge>
        )}
      </div>
      <div className="mono" style={{ fontSize: 10, color: "var(--color-fg-subtle)", marginTop: 3, paddingLeft: 14 }}>
        ({(b.x * 1920).toFixed(0)}, {(b.y * 1280).toFixed(0)}) · {(b.w * 1920).toFixed(0)}×{(b.h * 1280).toFixed(0)}
      </div>
      {selected && (
        <div style={{ display: "flex", gap: 4, marginTop: 6, paddingLeft: 14 }}>
          {isAi ? (
            <>
              <Button variant="primary" size="sm" onClick={(e) => { e.stopPropagation(); onAccept?.(); }} style={{ flex: 1 }}>采纳</Button>
              <Button variant="danger" size="sm" onClick={(e) => { e.stopPropagation(); onReject?.(); }} style={{ flex: 1 }}>驳回</Button>
            </>
          ) : (
            <Button variant="danger" size="sm" onClick={(e) => { e.stopPropagation(); onDelete?.(); }} style={{ flex: 1 }}>
              <Icon name="trash" size={10} />删除
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

export function WorkbenchPage({ onBack }: { onBack: () => void }) {
  const currentProject = useAppStore((s) => s.currentProject);
  const pushToast = useToastStore((s) => s.push);

  const projectId = currentProject?.id;
  const classes: string[] = currentProject?.classes ?? [];
  const projectName = currentProject?.name ?? "标注工作台";
  const projectDisplayId = currentProject?.display_id ?? "—";
  const aiModel = currentProject?.ai_model ?? "GroundingDINO + SAM";

  const { data: taskListData } = useTaskList(projectId);
  const tasks = taskListData?.items ?? [];

  const [currentTaskId, setCurrentTaskId] = useState<string | null>(null);
  const [tool, setTool] = useState<"box" | "hand">("box");
  const [activeClass, setActiveClass] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drawing, setDrawing] = useState<{ x: number; y: number; w: number; h: number; sx: number; sy: number } | null>(null);
  const [confThreshold, setConfThreshold] = useState(0.5);
  const [zoom, setZoom] = useState(1);
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const canvasRef = useRef<HTMLDivElement>(null);

  const task: TaskResponse | undefined = useMemo(
    () => tasks.find((t) => t.id === currentTaskId) ?? tasks[0],
    [tasks, currentTaskId],
  );
  const taskId = task?.id;

  useEffect(() => {
    if (tasks.length > 0 && !currentTaskId) {
      setCurrentTaskId(tasks[0].id);
    }
  }, [tasks, currentTaskId]);

  useEffect(() => {
    if (classes.length > 0) setActiveClass(classes[0]);
  }, [projectId]);

  const { data: annotationsData } = useAnnotations(taskId);
  const { data: predictionsData } = usePredictions(taskId);

  const userBoxes: Annotation[] = useMemo(
    () => (annotationsData ?? []).map(annotationToBox),
    [annotationsData],
  );

  const allAiBoxes = useMemo(
    () => predictionsToBoxes(predictionsData ?? []),
    [predictionsData],
  );
  const aiBoxes = useMemo(
    () => allAiBoxes.filter((b) => b.conf >= confThreshold),
    [allAiBoxes, confThreshold],
  );

  const aiTakeoverRate = useMemo(() => {
    if (!annotationsData || annotationsData.length === 0) return 0;
    const aiDerived = annotationsData.filter((a) => a.parent_prediction_id).length;
    return Math.round((aiDerived / annotationsData.length) * 100);
  }, [annotationsData]);

  const createAnnotation = useCreateAnnotation(taskId);
  const deleteAnnotationMut = useDeleteAnnotation(taskId);
  const submitTaskMut = useSubmitTask();
  const acceptPredictionMut = useAcceptPrediction(taskId ?? "");
  const triggerPreannotation = useTriggerPreannotation(projectId);
  const preannotationProgress = usePreannotationProgress(projectId);
  const { lockError } = useTaskLock(taskId);

  const aiRunning = preannotationProgress?.status === "running" || triggerPreannotation.isPending;

  const taskIdx = tasks.findIndex((t) => t.id === taskId);

  const navigateTask = useCallback((direction: "next" | "prev") => {
    if (tasks.length === 0) return;
    const idx = tasks.findIndex((t) => t.id === taskId);
    const newIdx = direction === "next"
      ? Math.min(idx + 1, tasks.length - 1)
      : Math.max(0, idx - 1);
    setCurrentTaskId(tasks[newIdx].id);
    setSelectedId(null);
  }, [tasks, taskId]);

  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === "INPUT") return;
      if (e.key === "v" || e.key === "V") setTool("hand");
      if (e.key === "b" || e.key === "B") setTool("box");
      if (e.key >= "1" && e.key <= "5") setActiveClass(classes[parseInt(e.key) - 1] || activeClass);
      if (e.key === "Delete" || e.key === "Backspace") {
        if (selectedId) handleDeleteBox(selectedId);
      }
      if (e.key === "ArrowRight" && (e.metaKey || e.ctrlKey)) navigateTask("next");
      if (e.key === "ArrowLeft" && (e.metaKey || e.ctrlKey)) navigateTask("prev");
    };
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, [selectedId, activeClass, classes, navigateTask]);

  const handleDeleteBox = (id: string) => {
    const isUserBox = userBoxes.some((b) => b.id === id);
    if (isUserBox) {
      deleteAnnotationMut.mutate(id, {
        onSuccess: () => pushToast({ msg: "已删除标注", kind: "success" }),
      });
    }
    setSelectedId(null);
  };

  const handleAcceptPrediction = (box: Annotation & { predictionId?: string }) => {
    if (!box.predictionId) return;
    acceptPredictionMut.mutate(box.predictionId, {
      onSuccess: () => {
        pushToast({ msg: "已采纳 AI 标注", sub: `${box.cls} · 置信度 ${(box.conf * 100).toFixed(0)}%`, kind: "success" });
      },
    });
  };

  const handleAcceptAll = () => {
    const uniquePredictionIds = [...new Set(aiBoxes.map((b) => b.predictionId))];
    let accepted = 0;
    uniquePredictionIds.forEach((pid) => {
      acceptPredictionMut.mutate(pid, {
        onSuccess: () => {
          accepted++;
          if (accepted === uniquePredictionIds.length) {
            pushToast({ msg: `已批量采纳 ${aiBoxes.length} 个 AI 标注`, kind: "success" });
          }
        },
      });
    });
  };

  const handleRunAi = () => {
    if (!projectId) return;
    pushToast({ msg: "AI 正在分析图像...", sub: aiModel });
    triggerPreannotation.mutate(
      { ml_backend_id: "", task_ids: taskId ? [taskId] : undefined },
      {
        onError: (err) => pushToast({ msg: "AI 预标注失败", sub: String(err) }),
      },
    );
  };

  const onCanvasMouseDown = (e: React.MouseEvent) => {
    if (tool !== "box" || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    setDrawing({ x, y, w: 0, h: 0, sx: x, sy: y });
    setSelectedId(null);
  };
  const onCanvasMouseMove = (e: React.MouseEvent) => {
    if (!drawing || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    setDrawing((d) => d ? ({
      ...d,
      x: Math.min(d.sx, x), y: Math.min(d.sy, y),
      w: Math.abs(x - d.sx), h: Math.abs(y - d.sy),
    }) : null);
  };
  const onCanvasMouseUp = () => {
    if (drawing && drawing.w > 0.005 && drawing.h > 0.005) {
      createAnnotation.mutate(
        {
          annotation_type: "bbox",
          class_name: activeClass,
          geometry: { x: drawing.x, y: drawing.y, w: drawing.w, h: drawing.h },
          confidence: 1,
        },
        {
          onSuccess: (newAnnotation) => {
            setSelectedId(newAnnotation.id);
          },
        },
      );
    }
    setDrawing(null);
  };

  const handleSubmitTask = () => {
    if (!taskId) return;
    submitTaskMut.mutate(taskId, {
      onSuccess: () => {
        pushToast({
          msg: `已提交 ${task?.display_id} 至质检`,
          sub: `共 ${userBoxes.length} 个标注`,
          kind: "success",
        });
        navigateTask("next");
      },
    });
  };

  if (!currentProject) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", flexDirection: "column", gap: 12, color: "var(--color-fg-muted)" }}>
        <Icon name="layers" size={40} />
        <div style={{ fontSize: 15 }}>请先从项目总览选择一个项目</div>
        <Button onClick={onBack}><Icon name="chevLeft" size={12} />返回总览</Button>
      </div>
    );
  }

  if (tasks.length === 0) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", flexDirection: "column", gap: 12, color: "var(--color-fg-muted)" }}>
        <Icon name="inbox" size={40} />
        <div style={{ fontSize: 15 }}>该项目暂无任务</div>
        <Button onClick={onBack}><Icon name="chevLeft" size={12} />返回总览</Button>
      </div>
    );
  }

  const panelStripStyle: React.CSSProperties = {
    display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
    height: "100%", gap: 8, cursor: "pointer", userSelect: "none",
    background: "var(--color-bg-elev)", border: "none", width: "100%", padding: 0,
    color: "var(--color-fg-muted)",
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: `${leftOpen ? "260px" : "32px"} 1fr ${rightOpen ? "280px" : "32px"}`, height: "100%", overflow: "hidden", background: "var(--color-bg-sunken)" }}>
      {/* Left: Task Queue */}
      {!leftOpen ? (
        <div style={{ borderRight: "1px solid var(--color-border)", overflow: "hidden" }}>
          <button onClick={() => setLeftOpen(true)} title="展开任务列表" style={panelStripStyle}>
            <Icon name="chevRight" size={13} />
            <span style={{ fontSize: 10, writingMode: "vertical-rl", letterSpacing: 1, opacity: 0.6 }}>任务列表</span>
          </button>
        </div>
      ) : (
        <div style={{ background: "var(--color-bg-elev)", borderRight: "1px solid var(--color-border)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--color-border)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
              <Button variant="ghost" size="sm" onClick={onBack} style={{ padding: "2px 6px" }}>
                <Icon name="chevLeft" size={11} />返回总览
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setLeftOpen(false)} title="收起任务列表" style={{ padding: "2px 6px" }}>
                <Icon name="chevLeft" size={11} />
              </Button>
            </div>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>{projectName}</div>
            <div style={{ fontSize: 11, color: "var(--color-fg-muted)" }}>
              <span className="mono">{projectDisplayId}</span> · {classes.length} 个类别
            </div>
          </div>

          <div style={{ padding: "10px 14px 6px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ fontSize: 12, fontWeight: 600 }}>任务队列</div>
            <span className="mono" style={{ fontSize: 11, color: "var(--color-fg-subtle)" }}>{taskIdx + 1} / {tasks.length}</span>
          </div>

          <div style={{ flex: 1, overflowY: "auto", padding: "0 8px 10px" }}>
            {tasks.map((t) => {
              const isActive = t.id === taskId;
              const statusLabel = t.status === "completed" ? "已完成" : t.status === "review" ? "待审核" : t.total_annotations > 0 ? "进行中" : t.total_predictions > 0 ? "AI 已预标" : "未开始";
              return (
                <div
                  key={t.id}
                  onClick={() => { setCurrentTaskId(t.id); setSelectedId(null); }}
                  style={{
                    padding: "8px 10px", margin: "2px 0",
                    borderRadius: "var(--radius-md)",
                    background: isActive ? "var(--color-accent-soft)" : "transparent",
                    border: "1px solid " + (isActive ? "oklch(0.85 0.06 252)" : "transparent"),
                    cursor: "pointer",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span className="mono" style={{ fontSize: 11.5, fontWeight: 500 }}>{t.display_id}</span>
                    {t.total_annotations > 0 && <Badge variant="accent" style={{ fontSize: 10, padding: "1px 6px" }}>{t.total_annotations}</Badge>}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--color-fg-muted)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.file_name}</div>
                  <div style={{ fontSize: 10.5, color: isActive ? "var(--color-accent-fg)" : "var(--color-fg-subtle)", marginTop: 2 }}>{statusLabel}</div>
                </div>
              );
            })}
          </div>

          <div style={{ borderTop: "1px solid var(--color-border)", padding: "10px 14px" }}>
            <div style={{ fontSize: 11, color: "var(--color-fg-muted)", marginBottom: 6 }}>类别 (按数字键切换)</div>
            {classes.map((c, i) => (
              <div
                key={c}
                onClick={() => setActiveClass(c)}
                style={{
                  display: "flex", alignItems: "center", gap: 8,
                  padding: "5px 8px", borderRadius: "var(--radius-sm)", cursor: "pointer",
                  background: activeClass === c ? "var(--color-bg-sunken)" : "transparent",
                  fontSize: 12.5,
                }}
              >
                <span style={{ width: 10, height: 10, borderRadius: 2, background: CLASS_COLORS[c] || "var(--color-accent)" }} />
                <span style={{ flex: 1 }}>{c}</span>
                <span style={{
                  display: "inline-block", padding: "1px 5px",
                  background: "var(--color-bg-sunken)", border: "1px solid var(--color-border)",
                  borderBottomWidth: 2, borderRadius: 3,
                  fontFamily: "var(--font-mono)", fontSize: 10.5, color: "var(--color-fg-muted)", lineHeight: 1,
                }}>{i + 1}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Center: Canvas */}
      <div style={{ display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {lockError && (
          <div style={{ padding: "6px 14px", background: "oklch(0.95 0.05 25)", borderBottom: "1px solid oklch(0.85 0.10 25)", fontSize: 12, color: "oklch(0.45 0.15 25)", display: "flex", alignItems: "center", gap: 6 }}>
            <Icon name="warning" size={13} />
            {lockError === "Lock expired" ? "任务锁已过期，请刷新页面" : "该任务正被其他用户编辑"}
          </div>
        )}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 14px", background: "var(--color-bg-elev)", borderBottom: "1px solid var(--color-border)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <Button variant={tool === "hand" ? "primary" : "ghost"} size="sm" onClick={() => setTool("hand")} title="平移 (V)">
              <Icon name="move" size={13} />
            </Button>
            <Button variant={tool === "box" ? "primary" : "ghost"} size="sm" onClick={() => setTool("box")} title="画框 (B)">
              <Icon name="rect" size={13} />矩形框
            </Button>
            <div style={{ width: 1, height: 20, background: "var(--color-border)", margin: "0 6px" }} />
            <Button variant="ghost" size="sm" onClick={() => setZoom((z) => Math.max(0.5, z - 0.1))}>
              <Icon name="zoomOut" size={13} />
            </Button>
            <span className="mono" style={{ fontSize: 11.5, color: "var(--color-fg-muted)", minWidth: 42, textAlign: "center" }}>{Math.round(zoom * 100)}%</span>
            <Button variant="ghost" size="sm" onClick={() => setZoom((z) => Math.min(2, z + 0.1))}>
              <Icon name="zoomIn" size={13} />
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setZoom(1)} style={{ fontSize: 11 }}>适应</Button>
          </div>
          <span className="mono" style={{ fontSize: 12, color: "var(--color-fg-muted)" }}>{task?.display_id} · {task?.file_name}</span>
          <div style={{ display: "flex", gap: 6 }}>
            <Button variant="ai" size="sm" onClick={handleRunAi} disabled={aiRunning}>
              <Icon name="sparkles" size={13} />{aiRunning ? "AI 推理中..." : "AI 一键预标"}
            </Button>
            <div style={{ width: 1, height: 20, background: "var(--color-border)" }} />
            <Button size="sm" onClick={() => navigateTask("prev")}><Icon name="chevLeft" size={13} />上一</Button>
            <Button variant="primary" size="sm" onClick={handleSubmitTask} disabled={submitTaskMut.isPending}>
              <Icon name="check" size={13} />提交质检
            </Button>
            <Button size="sm" onClick={() => navigateTask("next")}>下一<Icon name="chevRight" size={13} /></Button>
          </div>
        </div>

        <div style={{
          flex: 1, overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center",
          background: "repeating-conic-gradient(#e9e9ec 0% 25%, #f3f3f5 0% 50%) 0 0/16px 16px",
        }}>
          <div
            ref={canvasRef}
            onMouseDown={onCanvasMouseDown}
            onMouseMove={onCanvasMouseMove}
            onMouseUp={onCanvasMouseUp}
            onMouseLeave={() => setDrawing(null)}
            style={{
              position: "relative", width: 900 * zoom, height: 600 * zoom,
              background: "#fff", boxShadow: "var(--shadow-lg)",
              cursor: tool === "box" ? "crosshair" : "grab",
              userSelect: "none", overflow: "hidden",
            }}
          >
            <ImageBackdrop url={task?.file_url ?? null} seed={taskIdx} />
            {aiBoxes.map((b) => (
              <BoxOverlay key={b.id} b={b} isAi selected={selectedId === b.id}
                onClick={() => setSelectedId(b.id)}
                onAccept={() => handleAcceptPrediction(b)}
                onReject={() => setSelectedId(null)}
              />
            ))}
            {userBoxes.map((b) => (
              <BoxOverlay key={b.id} b={b} selected={selectedId === b.id}
                onClick={() => setSelectedId(b.id)}
                onDelete={() => handleDeleteBox(b.id)}
              />
            ))}
            {drawing && drawing.w > 0 && (
              <div style={{
                position: "absolute",
                left: drawing.x * 100 + "%", top: drawing.y * 100 + "%",
                width: drawing.w * 100 + "%", height: drawing.h * 100 + "%",
                border: "1.5px dashed " + (CLASS_COLORS[activeClass] || "var(--color-accent)"),
                background: (CLASS_COLORS[activeClass] || "var(--color-accent)") + "20",
              }} />
            )}
          </div>
        </div>

        <div style={{
          padding: "6px 14px", background: "var(--color-bg-elev)", borderTop: "1px solid var(--color-border)",
          display: "flex", justifyContent: "space-between", fontSize: 11.5, color: "var(--color-fg-muted)",
        }}>
          <div style={{ display: "flex", gap: 16 }}>
            <span><span className="mono">{userBoxes.length}</span> 已确认</span>
            <span><Icon name="sparkles" size={11} style={{ color: "var(--color-ai)", verticalAlign: "-2px" }} /> <span className="mono">{aiBoxes.length}</span> AI 待审</span>
            <span>当前类别: <span style={{ color: "var(--color-fg)", fontWeight: 500 }}>{activeClass}</span></span>
          </div>
          <div style={{ display: "flex", gap: 16 }}>
            <span>分辨率 1920×1280</span>
            {preannotationProgress && (
              <span style={{ color: "var(--color-ai)" }}>
                预标注 {preannotationProgress.current}/{preannotationProgress.total}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Right: AI Panel */}
      {!rightOpen ? (
        <div style={{ borderLeft: "1px solid var(--color-border)", overflow: "hidden" }}>
          <button onClick={() => setRightOpen(true)} title="展开 AI 助手" style={panelStripStyle}>
            <Icon name="chevLeft" size={13} />
            <span style={{ fontSize: 10, writingMode: "vertical-rl", letterSpacing: 1, opacity: 0.6 }}>AI 助手</span>
          </button>
        </div>
      ) : (
      <div style={{ background: "var(--color-bg-elev)", borderLeft: "1px solid var(--color-border)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--color-border)", background: "linear-gradient(180deg, var(--color-ai-soft), transparent)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <Icon name="sparkles" size={14} style={{ color: "var(--color-ai)" }} />
              <b style={{ fontSize: 13 }}>AI 助手</b>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <Badge variant="ai" dot style={{ fontSize: 10 }}>{aiRunning ? "推理中" : "在线"}</Badge>
              <Button variant="ghost" size="sm" onClick={() => setRightOpen(false)} title="收起 AI 助手" style={{ padding: "2px 6px" }}>
                <Icon name="chevRight" size={11} />
              </Button>
            </div>
          </div>
          <div style={{ fontSize: 11.5, color: "var(--color-fg-muted)", marginBottom: 8 }}>
            模型: <span style={{ color: "var(--color-fg)", fontWeight: 500 }}>{aiModel}</span>
          </div>
          <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
            <Button variant="ai" size="sm" onClick={handleRunAi} disabled={aiRunning} style={{ flex: 1 }}>
              <Icon name="sparkles" size={11} />一键预标
            </Button>
            <Button size="sm" onClick={handleAcceptAll} disabled={aiBoxes.length === 0} style={{ flex: 1 }}>
              <Icon name="check" size={11} />全部采纳
            </Button>
          </div>
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 4 }}>
              <span style={{ color: "var(--color-fg-muted)" }}>置信度阈值</span>
              <span className="mono" style={{ fontWeight: 500 }}>{(confThreshold * 100).toFixed(0)}%</span>
            </div>
            <input
              type="range" min="0" max="1" step="0.05" value={confThreshold}
              onChange={(e) => setConfThreshold(+e.target.value)}
              style={{ width: "100%", accentColor: "var(--color-ai)" }}
            />
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "var(--color-fg-subtle)", marginTop: -2 }}>
              <span>显示更多</span><span>更精准</span>
            </div>
          </div>
        </div>

        <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--color-border)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 600 }}>AI 待审</span>
            <span className="mono" style={{ fontSize: 11, color: "var(--color-fg-subtle)" }}>{aiBoxes.length} 项</span>
          </div>
          {aiBoxes.length === 0 && (
            <div style={{ fontSize: 11.5, color: "var(--color-fg-subtle)", padding: "4px 0" }}>暂无,点击"一键预标"开始</div>
          )}
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "4px 8px" }}>
          {aiBoxes.map((b) => (
            <BoxListItem key={b.id} b={b} isAi selected={selectedId === b.id}
              onSelect={() => setSelectedId(b.id)} onAccept={() => handleAcceptPrediction(b)} onReject={() => setSelectedId(null)} />
          ))}
          {userBoxes.length > 0 && (
            <div style={{ fontSize: 11, fontWeight: 600, color: "var(--color-fg-muted)", padding: "10px 6px 4px", textTransform: "uppercase", letterSpacing: 0.5 }}>
              已确认 ({userBoxes.length})
            </div>
          )}
          {userBoxes.map((b) => (
            <BoxListItem key={b.id} b={b} selected={selectedId === b.id}
              onSelect={() => setSelectedId(b.id)} onDelete={() => handleDeleteBox(b.id)} />
          ))}
        </div>

        <div style={{ borderTop: "1px solid var(--color-border)", padding: "10px 14px", background: "var(--color-bg-sunken)" }}>
          <div style={{ fontSize: 11, color: "var(--color-fg-muted)", marginBottom: 6 }}>本次效率</div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
            <span>AI 接管率</span>
            <span className="mono" style={{ fontWeight: 600, color: "var(--color-ai)" }}>{aiTakeoverRate}%</span>
          </div>
          <ProgressBar value={aiTakeoverRate} color="var(--color-ai)" />
        </div>
      </div>
      )}
    </div>
  );
}
