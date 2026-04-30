import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { useToastStore } from "@/components/ui/Toast";
import { useProject } from "@/hooks/useProjects";
import {
  useTaskList, useAnnotations, useCreateAnnotation, useDeleteAnnotation,
  useUpdateAnnotation, useSubmitTask,
} from "@/hooks/useTasks";
import { usePredictions, useAcceptPrediction } from "@/hooks/usePredictions";
import { usePreannotationProgress, useTriggerPreannotation } from "@/hooks/usePreannotation";
import { useTaskLock } from "@/hooks/useTaskLock";
import { tasksApi } from "@/api/tasks";
import { predictionsApi } from "@/api/predictions";
import type { TaskResponse, AnnotationResponse } from "@/types";

import { useWorkbenchState } from "../state/useWorkbenchState";
import { useViewportTransform } from "../state/useViewportTransform";
import { useAnnotationHistory } from "../state/useAnnotationHistory";
import { useRecentClasses } from "../state/useRecentClasses";
import { annotationToBox, predictionsToBoxes, type AiBox } from "../state/transforms";
import { ImageStage } from "../stage/ImageStage";
import { Topbar } from "./Topbar";
import { TaskQueuePanel } from "./TaskQueuePanel";
import { AIInspectorPanel } from "./AIInspectorPanel";
import { StatusBar } from "./StatusBar";
import { HotkeyCheatSheet } from "./HotkeyCheatSheet";
import { ClassPickerPopover } from "./ClassPickerPopover";
import { Minimap } from "../stage/Minimap";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { WorkbenchSkeleton } from "./WorkbenchSkeleton";

type Geom = { x: number; y: number; w: number; h: number };

export function WorkbenchShell() {
  const { id: routeId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const onBack = useCallback(() => navigate("/dashboard"), [navigate]);
  const pushToast = useToastStore((s) => s.push);

  const { data: currentProject, isLoading: isProjectLoading } = useProject(routeId ?? "");
  const projectId = currentProject?.id;
  const classes: string[] = currentProject?.classes ?? [];
  const projectName = currentProject?.name ?? "标注工作台";
  const projectDisplayId = currentProject?.display_id ?? "—";
  const aiModel = currentProject?.ai_model ?? "GroundingDINO + SAM";

  const { data: taskListData, hasNextPage, isFetchingNextPage, fetchNextPage } = useTaskList(projectId);
  const tasks = taskListData?.pages.flatMap((p) => p.items) ?? [];

  const s = useWorkbenchState();
  const { vp, setVp } = useViewportTransform();
  const [fitTick, setFitTick] = useState(0);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [spacePan, setSpacePan] = useState(false);
  const [showHotkeys, setShowHotkeys] = useState(false);
  const [stageGeom, setStageGeom] = useState<{ imgW: number; imgH: number; vpSize: { w: number; h: number } }>({ imgW: 0, imgH: 0, vpSize: { w: 0, h: 0 } });
  const isNarrow = useMediaQuery("(max-width: 1024px)");
  const { recent: recentClasses, record: recordRecentClass } = useRecentClasses(routeId);

  // 阈值防抖：滑动时前端即时过滤，300ms 后触发服务端查询
  const [debouncedConf, setDebouncedConf] = useState(s.confThreshold);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedConf(s.confThreshold), 300);
    return () => clearTimeout(t);
  }, [s.confThreshold]);

  const task: TaskResponse | undefined = useMemo(
    () => tasks.find((t) => t.id === s.currentTaskId) ?? tasks[0],
    [tasks, s.currentTaskId],
  );
  const taskId = task?.id;
  const taskIdx = tasks.findIndex((t) => t.id === taskId);
  const imageWidth = task?.image_width ?? null;
  const imageHeight = task?.image_height ?? null;

  useEffect(() => {
    if (tasks.length > 0 && !s.currentTaskId) {
      s.setCurrentTaskId(tasks[0].id);
    }
  }, [tasks, s.currentTaskId]);

  useEffect(() => {
    // 默认选最近使用过的类（如果该项目存在），否则取首个
    if (classes.length > 0) {
      const fallback = recentClasses.find((c) => classes.includes(c)) ?? classes[0];
      s.setActiveClass(fallback);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const { data: annotationsData } = useAnnotations(taskId);
  const annotationsRef = useRef<AnnotationResponse[]>([]);
  annotationsRef.current = annotationsData ?? [];
  const predictionsInfinite = usePredictions(taskId, undefined, debouncedConf);
  const predictionsPages = predictionsInfinite.data?.pages ?? [];
  const predictionsData = useMemo(
    () => predictionsPages.flatMap((p) => p),
    [predictionsPages],
  );

  const userBoxes = useMemo(
    () => (annotationsData ?? []).map(annotationToBox),
    [annotationsData],
  );
  const allAiBoxes = useMemo(
    () => predictionsToBoxes(predictionsData),
    [predictionsData],
  );
  const aiBoxes = useMemo(
    () => allAiBoxes.filter((b) => b.conf >= s.confThreshold),
    [allAiBoxes, s.confThreshold],
  );

  const aiTakeoverRate = useMemo(() => {
    if (!annotationsData || annotationsData.length === 0) return 0;
    const aiDerived = annotationsData.filter((a) => a.parent_prediction_id).length;
    return Math.round((aiDerived / annotationsData.length) * 100);
  }, [annotationsData]);

  const createAnnotation = useCreateAnnotation(taskId);
  const deleteAnnotationMut = useDeleteAnnotation(taskId);
  const updateAnnotationMut = useUpdateAnnotation(taskId);
  const submitTaskMut = useSubmitTask();
  const acceptPredictionMut = useAcceptPrediction(taskId ?? "");
  const triggerPreannotation = useTriggerPreannotation(projectId);
  const { progress: preannotationProgress, connection: preannotationConn, retries: preannotationRetries } =
    usePreannotationProgress(projectId);
  const { lockError } = useTaskLock(taskId);

  const queryClient = useQueryClient();

  // 预取相邻题的 annotations / 第一页 predictions / 图像
  useEffect(() => {
    const idx = tasks.findIndex((t) => t.id === taskId);
    const prefetch = (t: TaskResponse | undefined) => {
      if (!t) return;
      queryClient.prefetchQuery({ queryKey: ["annotations", t.id], queryFn: () => tasksApi.getAnnotations(t.id) });
      queryClient.prefetchInfiniteQuery({
        queryKey: ["predictions", t.id, undefined, debouncedConf, 100],
        initialPageParam: 0,
        queryFn: () => predictionsApi.listByTask(t.id, undefined, debouncedConf, 100, 0),
      });
      if (t.file_url) {
        const img = new Image();
        img.src = t.file_url;
      }
    };
    prefetch(tasks[idx + 1]);
    prefetch(tasks[idx - 1]);
  }, [taskId, tasks, queryClient, debouncedConf]);

  const aiRunning = preannotationProgress?.status === "running" || triggerPreannotation.isPending;

  const history = useAnnotationHistory(taskId, {
    createAnnotation: (payload) => createAnnotation.mutateAsync(payload),
    deleteAnnotation: (id) => deleteAnnotationMut.mutateAsync(id),
    updateAnnotation: (id, payload) =>
      updateAnnotationMut.mutateAsync({ annotationId: id, payload }),
  });

  const navigateTask = useCallback((direction: "next" | "prev") => {
    if (tasks.length === 0) return;
    const idx = tasks.findIndex((t) => t.id === taskId);
    const newIdx = direction === "next"
      ? Math.min(idx + 1, tasks.length - 1)
      : Math.max(0, idx - 1);
    // 距末页 10 条时预加载下一页
    if (direction === "next" && newIdx >= tasks.length - 10 && hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
    s.setCurrentTaskId(tasks[newIdx].id);
    s.setSelectedId(null);
  }, [tasks, taskId, s, hasNextPage, isFetchingNextPage, fetchNextPage]);

  const handleDeleteBox = useCallback((id: string) => {
    const target = annotationsRef.current.find((a) => a.id === id);
    if (target) {
      deleteAnnotationMut.mutate(id, {
        onSuccess: () => {
          history.push({ kind: "delete", annotation: target });
          pushToast({ msg: "已删除标注", kind: "success" });
        },
      });
    }
    s.setSelectedId(null);
  }, [deleteAnnotationMut, history, pushToast, s]);

  const handleAcceptPrediction = useCallback((box: AiBox) => {
    if (!box.predictionId) return;
    acceptPredictionMut.mutate(box.predictionId, {
      onSuccess: (created) => {
        const ids = created.map((a) => a.id);
        history.push({ kind: "acceptPrediction", predictionId: box.predictionId, createdAnnotationIds: ids });
        pushToast({ msg: "已采纳 AI 标注", sub: `${box.cls} · 置信度 ${(box.conf * 100).toFixed(0)}%`, kind: "success" });
      },
    });
  }, [acceptPredictionMut, history, pushToast]);

  const handleAcceptAll = useCallback(() => {
    const uniquePredictionIds = [...new Set(aiBoxes.map((b) => b.predictionId))];
    if (uniquePredictionIds.length === 0) return;
    let succeeded = 0;
    let failed = 0;
    let pending = uniquePredictionIds.length;
    uniquePredictionIds.forEach((pid) => {
      acceptPredictionMut.mutate(pid, {
        onSuccess: (created) => {
          succeeded++;
          history.push({
            kind: "acceptPrediction",
            predictionId: pid,
            createdAnnotationIds: created.map((a) => a.id),
          });
        },
        onError: () => { failed++; },
        onSettled: () => {
          pending--;
          if (pending === 0) {
            const totalBoxes = aiBoxes.length;
            pushToast({
              msg: `采纳 ${succeeded}/${uniquePredictionIds.length} 项预测（共 ${totalBoxes} 框）`,
              sub: failed ? `${failed} 项失败` : undefined,
              kind: failed ? "error" : "success",
            });
          }
        },
      });
    });
  }, [aiBoxes, acceptPredictionMut, history, pushToast]);

  const handleRunAi = useCallback(() => {
    if (!projectId) return;
    pushToast({ msg: "AI 正在分析图像...", sub: aiModel });
    triggerPreannotation.mutate(
      { ml_backend_id: "", task_ids: taskId ? [taskId] : undefined },
      {
        onError: (err) => pushToast({ msg: "AI 预标注失败", sub: String(err) }),
      },
    );
  }, [projectId, aiModel, taskId, triggerPreannotation, pushToast]);

  // 画完框 → 进入待选类别 pending 态。class 由 ClassPickerPopover 选定后才落库。
  const handleCommitDrawing = useCallback((geo: Geom) => {
    s.setPendingDrawing({ geom: geo });
  }, [s]);

  const handlePickPendingClass = useCallback((cls: string) => {
    const pending = s.pendingDrawing;
    if (!pending || !cls) return;
    const payload = {
      annotation_type: "bbox",
      class_name: cls,
      geometry: pending.geom,
      confidence: 1,
    };
    s.setPendingDrawing(null);
    s.setActiveClass(cls);
    recordRecentClass(cls);
    createAnnotation.mutate(payload, {
      onSuccess: (newAnnotation) => {
        s.setSelectedId(newAnnotation.id);
        history.push({ kind: "create", annotationId: newAnnotation.id, payload });
      },
    });
  }, [s, createAnnotation, history, recordRecentClass]);

  const handleCancelPending = useCallback(() => {
    s.setPendingDrawing(null);
  }, [s]);

  // 已落库 user 框 → 改类别
  const handleStartChangeClass = useCallback((annotationId: string) => {
    const ann = annotationsRef.current.find((a) => a.id === annotationId);
    if (!ann) return;
    s.setEditingClass({
      annotationId,
      geom: ann.geometry as Geom,
      currentClass: ann.class_name,
    });
  }, [s]);

  const handleCommitChangeClass = useCallback((cls: string) => {
    const editing = s.editingClass;
    if (!editing || !cls || cls === editing.currentClass) {
      s.setEditingClass(null);
      return;
    }
    const before = { class_name: editing.currentClass };
    const after = { class_name: cls };
    s.setEditingClass(null);
    s.setActiveClass(cls);
    recordRecentClass(cls);
    updateAnnotationMut.mutate(
      { annotationId: editing.annotationId, payload: after },
      {
        onSuccess: () => {
          history.push({
            kind: "update", annotationId: editing.annotationId,
            before, after,
          });
          pushToast({ msg: `已改为 ${cls}`, kind: "success" });
        },
      },
    );
  }, [s, updateAnnotationMut, history, pushToast, recordRecentClass]);

  const handleCancelChangeClass = useCallback(() => {
    s.setEditingClass(null);
  }, [s]);

  const handleCommitMove = useCallback((id: string, before: Geom, after: Geom) => {
    updateAnnotationMut.mutate({ annotationId: id, payload: { geometry: after } }, {
      onSuccess: () => {
        history.push({
          kind: "update", annotationId: id,
          before: { geometry: before }, after: { geometry: after },
        });
      },
    });
  }, [updateAnnotationMut, history]);

  const handleCommitResize = useCallback((id: string, before: Geom, after: Geom) => {
    if (after.w < 0.005 || after.h < 0.005) {
      pushToast({ msg: "框太小未保存", sub: "拖动到至少 0.5% × 0.5%", kind: "error" });
      return;
    }
    updateAnnotationMut.mutate({ annotationId: id, payload: { geometry: after } }, {
      onSuccess: () => {
        history.push({
          kind: "update", annotationId: id,
          before: { geometry: before }, after: { geometry: after },
        });
      },
    });
  }, [updateAnnotationMut, history, pushToast]);

  const handleSubmitTask = useCallback(() => {
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
  }, [taskId, submitTaskMut, pushToast, task?.display_id, userBoxes.length, navigateTask]);

  // ── 键盘快捷键 ──────────────────────────────────────────────────────────
  useEffect(() => {
    const isInput = (el: EventTarget | null) =>
      el instanceof HTMLElement && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);

    const onKey = (e: KeyboardEvent) => {
      if (isInput(e.target)) return;

      // 系统级（带修饰）
      if (e.ctrlKey || e.metaKey) {
        if (e.key === "z" || e.key === "Z") {
          e.preventDefault();
          if (e.shiftKey) history.redo(); else history.undo();
          return;
        }
        if (e.key === "y" || e.key === "Y") { e.preventDefault(); history.redo(); return; }
        if (e.key === "0") { e.preventDefault(); setFitTick((n) => n + 1); return; }
        if (e.key === "ArrowRight") { e.preventDefault(); navigateTask("next"); return; }
        if (e.key === "ArrowLeft") { e.preventDefault(); navigateTask("prev"); return; }
        return;
      }

      // 单键
      if (e.key === " ") { e.preventDefault(); setSpacePan(true); return; }
      if (e.key === "?") { setShowHotkeys(true); return; }
      if (e.key === "Escape") {
        if (showHotkeys) { setShowHotkeys(false); return; }
        if (s.pendingDrawing) { s.setPendingDrawing(null); return; }
        if (s.editingClass) { s.setEditingClass(null); return; }
        s.setSelectedId(null);
        return;
      }
      // pendingDrawing / editingClass 时类别按键由 popover 自己消费，不再切换 default
      if (s.pendingDrawing || s.editingClass) return;
      // C 键：选中 user 框时 → 改类别
      if ((e.key === "c" || e.key === "C") && s.selectedId) {
        const ann = annotationsRef.current.find((a) => a.id === s.selectedId);
        if (ann) { handleStartChangeClass(s.selectedId); return; }
      }
      if (e.key === "v" || e.key === "V") { s.setTool("hand"); return; }
      if (e.key === "b" || e.key === "B") { s.setTool("box"); return; }
      if (e.key >= "1" && e.key <= "9") {
        const idx = parseInt(e.key) - 1;
        if (classes[idx]) { s.setActiveClass(classes[idx]); recordRecentClass(classes[idx]); }
        return;
      }
      // 字母 a-z 切换默认类别（第 10 类起）
      if (/^[a-z]$/i.test(e.key) && !["v", "V", "b", "B", "a", "A", "d", "D", "e", "E"].includes(e.key)) {
        const letterIdx = e.key.toLowerCase().charCodeAt(0) - "a".charCodeAt(0);
        const idx = 9 + letterIdx;
        if (classes[idx]) { s.setActiveClass(classes[idx]); recordRecentClass(classes[idx]); return; }
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        if (s.selectedId) handleDeleteBox(s.selectedId);
        return;
      }
      if (e.key === "e" || e.key === "E") { handleSubmitTask(); return; }

      // 选中 AI 框时的 a/d
      if ((e.key === "a" || e.key === "A") && s.selectedId) {
        const aiBox = aiBoxes.find((b) => b.id === s.selectedId);
        if (aiBox) handleAcceptPrediction(aiBox);
        return;
      }
      if ((e.key === "d" || e.key === "D") && s.selectedId) {
        const aiBox = aiBoxes.find((b) => b.id === s.selectedId);
        if (aiBox) s.setSelectedId(null);
        return;
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === " ") setSpacePan(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [
    classes, s, history, navigateTask, handleDeleteBox, handleSubmitTask,
    handleAcceptPrediction, aiBoxes, showHotkeys, recordRecentClass, handleStartChangeClass,
  ]);

  if (isProjectLoading) {
    return <WorkbenchSkeleton />;
  }

  if (!currentProject) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", flexDirection: "column", gap: 12, color: "var(--color-fg-muted)" }}>
        <Icon name="warning" size={40} />
        <div style={{ fontSize: 15 }}>项目不存在或无访问权限</div>
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

  // 窄屏强制收两侧
  const leftOpen = isNarrow ? false : s.leftOpen;
  const rightOpen = isNarrow ? false : s.rightOpen;

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `${leftOpen ? "260px" : "32px"} 1fr ${rightOpen ? "280px" : "32px"}`,
        height: "100%", overflow: "hidden", background: "var(--color-bg-sunken)",
      }}
    >
      <TaskQueuePanel
        open={leftOpen}
        projectName={projectName}
        projectDisplayId={projectDisplayId}
        classes={classes}
        activeClass={s.activeClass}
        recentClasses={recentClasses}
        tasks={tasks}
        taskId={taskId}
        taskIdx={taskIdx}
        hasNextPage={hasNextPage}
        isFetchingNextPage={isFetchingNextPage}
        onFetchNextPage={fetchNextPage}
        onBack={onBack}
        onToggle={() => s.setLeftOpen(!s.leftOpen)}
        onSetActiveClass={(c) => { s.setActiveClass(c); recordRecentClass(c); }}
        onSelectTask={(id) => { s.setCurrentTaskId(id); s.setSelectedId(null); }}
      />

      <div style={{ display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {lockError && (
          <div
            style={{
              padding: "6px 14px",
              background: "oklch(0.95 0.05 25)",
              borderBottom: "1px solid oklch(0.85 0.10 25)",
              fontSize: 12, color: "oklch(0.45 0.15 25)",
              display: "flex", alignItems: "center", gap: 6,
            }}
          >
            <Icon name="warning" size={13} />
            {lockError === "Lock expired" ? "任务锁已过期，请刷新页面" : "该任务正被其他用户编辑"}
          </div>
        )}

        <Topbar
          task={task}
          tool={s.tool}
          scale={vp.scale}
          aiRunning={aiRunning}
          isSubmitting={submitTaskMut.isPending}
          canUndo={history.canUndo}
          canRedo={history.canRedo}
          onSetTool={s.setTool}
          onZoomOut={() => setVp((cur) => ({ ...cur, scale: Math.max(0.2, cur.scale / 1.2) }))}
          onZoomIn={() => setVp((cur) => ({ ...cur, scale: Math.min(8, cur.scale * 1.2) }))}
          onFit={() => setFitTick((n) => n + 1)}
          onUndo={history.undo}
          onRedo={history.redo}
          onShowHotkeys={() => setShowHotkeys(true)}
          onRunAi={handleRunAi}
          onPrev={() => navigateTask("prev")}
          onNext={() => navigateTask("next")}
          onSubmit={handleSubmitTask}
        />

        <ImageStage
          fileUrl={task?.file_url ?? null}
          blurhash={task?.blurhash ?? null}
          tool={s.tool}
          activeClass={s.activeClass}
          selectedId={s.selectedId}
          userBoxes={userBoxes}
          aiBoxes={aiBoxes}
          spacePan={spacePan}
          vp={vp}
          setVp={setVp}
          fitTick={fitTick}
          pendingDrawing={s.pendingDrawing}
          onSelectBox={s.setSelectedId}
          onAcceptPrediction={handleAcceptPrediction}
          onDeleteUserBox={handleDeleteBox}
          onCommitDrawing={handleCommitDrawing}
          onCommitMove={handleCommitMove}
          onCommitResize={handleCommitResize}
          onCursorMove={setCursor}
          onChangeUserBoxClass={handleStartChangeClass}
          onStageGeometry={setStageGeom}
          overlay={
            <>
              {s.pendingDrawing && stageGeom.imgW > 0 && (
                <ClassPickerPopover
                  geom={s.pendingDrawing.geom}
                  imgW={stageGeom.imgW}
                  imgH={stageGeom.imgH}
                  vp={vp}
                  classes={classes}
                  recent={recentClasses}
                  defaultClass={s.activeClass}
                  onPick={handlePickPendingClass}
                  onCancel={handleCancelPending}
                />
              )}
              {s.editingClass && stageGeom.imgW > 0 && !s.pendingDrawing && (
                <ClassPickerPopover
                  geom={s.editingClass.geom}
                  imgW={stageGeom.imgW}
                  imgH={stageGeom.imgH}
                  vp={vp}
                  classes={classes}
                  recent={recentClasses}
                  defaultClass={s.editingClass.currentClass}
                  title={`改类别 (当前: ${s.editingClass.currentClass})`}
                  onPick={handleCommitChangeClass}
                  onCancel={handleCancelChangeClass}
                />
              )}
              {stageGeom.imgW > 0 && stageGeom.vpSize.w > 0 && (
                <Minimap
                  imgW={stageGeom.imgW}
                  imgH={stageGeom.imgH}
                  vpSize={stageGeom.vpSize}
                  vp={vp}
                  setVp={setVp}
                  thumbnailUrl={task?.thumbnail_url ?? null}
                  fileUrl={task?.file_url ?? null}
                />
              )}
            </>
          }
        />

        <StatusBar
          userBoxesCount={userBoxes.length}
          aiBoxesCount={aiBoxes.length}
          activeClass={s.activeClass}
          imageWidth={imageWidth}
          imageHeight={imageHeight}
          cursor={cursor}
          preannotationProgress={preannotationProgress}
          preannotationConn={preannotationConn}
          preannotationRetries={preannotationRetries}
        />
      </div>

      <AIInspectorPanel
        open={rightOpen}
        aiModel={aiModel}
        aiRunning={aiRunning}
        aiBoxes={aiBoxes}
        userBoxes={userBoxes}
        selectedId={s.selectedId}
        confThreshold={s.confThreshold}
        aiTakeoverRate={aiTakeoverRate}
        imageWidth={imageWidth}
        imageHeight={imageHeight}
        hasMorePredictions={!!predictionsInfinite.hasNextPage}
        isFetchingMorePredictions={predictionsInfinite.isFetchingNextPage}
        onFetchMorePredictions={() => predictionsInfinite.fetchNextPage()}
        onToggle={() => s.setRightOpen(!s.rightOpen)}
        onRunAi={handleRunAi}
        onAcceptAll={handleAcceptAll}
        onSetConfThreshold={s.setConfThreshold}
        onSelect={s.setSelectedId}
        onAcceptPrediction={handleAcceptPrediction}
        onClearSelection={() => s.setSelectedId(null)}
        onDeleteUserBox={handleDeleteBox}
        onChangeUserBoxClass={handleStartChangeClass}
      />

      <HotkeyCheatSheet open={showHotkeys} onClose={() => setShowHotkeys(false)} />
    </div>
  );
}
