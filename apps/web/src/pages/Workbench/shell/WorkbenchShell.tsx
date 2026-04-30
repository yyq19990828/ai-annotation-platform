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
import { useSessionStats } from "../state/useSessionStats";
import { useClipboard } from "../state/useClipboard";
import { annotationToBox, predictionsToBoxes, type AiBox } from "../state/transforms";
import { iou } from "../stage/iou";
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

  // 会话级 ETA：基于切题间隔
  const { avgMs } = useSessionStats(taskId ?? null);
  const remainingTaskCount = useMemo(() => {
    if (!tasks.length) return 0;
    return tasks.filter((t) => t.status !== "completed" && t.id !== taskId).length;
  }, [tasks, taskId]);

  // 剪贴板
  const clipboard = useClipboard({
    userBoxes,
    selectedIds: s.selectedIds,
    clipboard: s.clipboard,
    setClipboard: s.setClipboard,
    createAnnotation: (payload) => createAnnotation.mutateAsync(payload),
    pushBatch: history.pushBatch,
    setSelectedIds: (ids) => s.replaceSelected(ids),
    imgW: stageGeom.imgW,
    imgH: stageGeom.imgH,
  });

  // IoU 视觉去重：与已确认 user 框 IoU > 0.7 且 class 相同的 AI 框 → 淡化
  const dimmedAiIds = useMemo(() => {
    const out = new Set<string>();
    if (userBoxes.length === 0 || aiBoxes.length === 0) return out;
    for (const a of aiBoxes) {
      const sameClass = userBoxes.filter((u) => u.cls === a.cls);
      if (sameClass.some((u) => iou(u, a) > 0.7)) out.add(a.id);
    }
    return out;
  }, [userBoxes, aiBoxes]);

  // 方向键 nudge：临时几何 override，松开方向键时一次性 batch 提交
  const [nudgeMap, setNudgeMap] = useState<Map<string, Geom>>(new Map());
  const nudgeOrigRef = useRef<Map<string, Geom>>(new Map());
  // 切题清空 nudge
  useEffect(() => { setNudgeMap(new Map()); nudgeOrigRef.current = new Map(); }, [taskId]);

  // 批量改类 popover：anchor 到 selectedIds 第一个 user 框的 geom
  const [batchChanging, setBatchChanging] = useState(false);

  const flushNudges = useCallback(() => {
    if (nudgeMap.size === 0) return;
    const cmds: { kind: "update"; annotationId: string; before: { geometry: Geom }; after: { geometry: Geom } }[] = [];
    nudgeMap.forEach((after, id) => {
      const before = nudgeOrigRef.current.get(id);
      if (!before) return;
      // 真有变化才 commit
      if (before.x === after.x && before.y === after.y && before.w === after.w && before.h === after.h) return;
      updateAnnotationMut.mutate({ annotationId: id, payload: { geometry: after } });
      cmds.push({ kind: "update", annotationId: id, before: { geometry: before }, after: { geometry: after } });
    });
    if (cmds.length > 0) history.pushBatch(cmds);
    setNudgeMap(new Map());
    nudgeOrigRef.current = new Map();
  }, [nudgeMap, updateAnnotationMut, history]);

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

  /** Shift+click 多选；普通 click 单选；点 AI 框始终单选。 */
  const handleSelectBox = useCallback((id: string | null, opts?: { shift?: boolean }) => {
    if (!id) { s.setSelectedId(null); return; }
    const isUserBox = annotationsRef.current.some((a) => a.id === id);
    if (opts?.shift && isUserBox) {
      s.toggleSelected(id);
    } else {
      s.setSelectedId(id);
    }
  }, [s]);

  /** N（下一未标注）/ U（下一最不确定，total_predictions desc）。 */
  const smartNext = useCallback((mode: "open" | "uncertain") => {
    if (tasks.length === 0) return;
    const idx = tasks.findIndex((t) => t.id === taskId);
    const after = tasks.slice(idx + 1);
    const target = mode === "open"
      ? after.find((t) => t.status !== "completed" && t.total_annotations === 0)
      : [...after]
          .filter((t) => t.total_predictions > 0 && t.total_annotations === 0)
          .sort((a, b) => b.total_predictions - a.total_predictions)[0];
    if (!target) {
      if (hasNextPage && !isFetchingNextPage) {
        fetchNextPage();
        pushToast({ msg: "正在加载下一页任务…", kind: "warning" });
      } else {
        pushToast({
          msg: mode === "open" ? "前方已无未标注题目" : "前方已无不确定题目",
          kind: "warning",
        });
      }
      return;
    }
    s.setCurrentTaskId(target.id);
    s.setSelectedId(null);
  }, [tasks, taskId, hasNextPage, isFetchingNextPage, fetchNextPage, s, pushToast]);

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

  /** 批量删除当前选中的所有 user 框：成功后聚合 1 条 batch 命令进 history。 */
  const handleBatchDelete = useCallback(() => {
    const ids = s.selectedIds.filter((id) => annotationsRef.current.some((a) => a.id === id));
    if (ids.length === 0) return;
    const targets = ids
      .map((id) => annotationsRef.current.find((a) => a.id === id))
      .filter(Boolean) as AnnotationResponse[];
    let pending = ids.length;
    let succeeded = 0, failed = 0;
    const cmds: { kind: "delete"; annotation: AnnotationResponse }[] = [];
    targets.forEach((ann) => {
      deleteAnnotationMut.mutate(ann.id, {
        onSuccess: () => { succeeded++; cmds.push({ kind: "delete", annotation: ann }); },
        onError: () => { failed++; },
        onSettled: () => {
          pending--;
          if (pending === 0) {
            if (cmds.length > 0) history.pushBatch(cmds);
            pushToast({
              msg: `已删除 ${succeeded}/${targets.length} 个标注`,
              sub: failed ? `${failed} 项失败` : undefined,
              kind: failed ? "error" : "success",
            });
            s.setSelectedId(null);
          }
        },
      });
    });
  }, [s, deleteAnnotationMut, history, pushToast]);

  /** 触发批量改类弹窗（实际批量更新由 popover commit 触发）。 */
  const handleStartBatchChangeClass = useCallback(() => {
    const ids = s.selectedIds.filter((id) => annotationsRef.current.some((a) => a.id === id));
    if (ids.length === 0) return;
    setBatchChanging(true);
  }, [s.selectedIds]);

  const handleCommitBatchChangeClass = useCallback((cls: string) => {
    setBatchChanging(false);
    if (!cls) return;
    const ids = s.selectedIds.filter((id) => annotationsRef.current.some((a) => a.id === id));
    if (ids.length === 0) return;
    let pending = ids.length;
    let succeeded = 0, failed = 0;
    const cmds: { kind: "update"; annotationId: string; before: { class_name: string }; after: { class_name: string } }[] = [];
    ids.forEach((id) => {
      const ann = annotationsRef.current.find((a) => a.id === id);
      if (!ann || ann.class_name === cls) { pending--; return; }
      const before = { class_name: ann.class_name };
      const after = { class_name: cls };
      updateAnnotationMut.mutate(
        { annotationId: id, payload: after },
        {
          onSuccess: () => { succeeded++; cmds.push({ kind: "update", annotationId: id, before, after }); },
          onError: () => { failed++; },
          onSettled: () => {
            pending--;
            if (pending === 0) {
              if (cmds.length > 0) history.pushBatch(cmds);
              s.setActiveClass(cls);
              recordRecentClass(cls);
              pushToast({
                msg: `${succeeded} 个标注已改为 ${cls}`,
                sub: failed ? `${failed} 项失败` : undefined,
                kind: failed ? "error" : "success",
              });
            }
          },
        },
      );
    });
    if (pending === 0) setBatchChanging(false);
  }, [s, updateAnnotationMut, history, pushToast, recordRecentClass]);

  const handleCancelBatchChange = useCallback(() => setBatchChanging(false), []);

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

    const ARROW_KEYS = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);

    const applyArrowNudge = (dx: number, dy: number) => {
      if (s.selectedIds.length === 0) return;
      const userTargets = s.selectedIds
        .map((id) => annotationsRef.current.find((a) => a.id === id))
        .filter(Boolean) as AnnotationResponse[];
      if (userTargets.length === 0) return;
      // 1px / 10px → 归一化
      const w = stageGeom.imgW || 1;
      const h = stageGeom.imgH || 1;
      const ndx = dx / w;
      const ndy = dy / h;
      setNudgeMap((prev) => {
        const next = new Map(prev);
        for (const ann of userTargets) {
          const orig = nudgeOrigRef.current.get(ann.id) ?? (ann.geometry as Geom);
          if (!nudgeOrigRef.current.has(ann.id)) nudgeOrigRef.current.set(ann.id, orig);
          const cur = next.get(ann.id) ?? orig;
          next.set(ann.id, {
            x: Math.max(0, Math.min(1 - cur.w, cur.x + ndx)),
            y: Math.max(0, Math.min(1 - cur.h, cur.y + ndy)),
            w: cur.w, h: cur.h,
          });
        }
        return next;
      });
    };

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
        if (e.key === "a" || e.key === "A") {
          e.preventDefault();
          if (annotationsRef.current.length > 0) {
            s.replaceSelected(annotationsRef.current.map((a) => a.id));
          }
          return;
        }
        if (e.key === "c" || e.key === "C") {
          e.preventDefault();
          const n = clipboard.copySelection();
          if (n > 0) pushToast({ msg: `已复制 ${n} 个标注`, kind: "success" });
          return;
        }
        if (e.key === "v" || e.key === "V") {
          e.preventDefault();
          if (clipboard.hasClipboard) {
            clipboard.paste().then((ids) => {
              if (ids.length > 0) pushToast({ msg: `已粘贴 ${ids.length} 个标注`, kind: "success" });
            });
          }
          return;
        }
        if (e.key === "d" || e.key === "D") {
          e.preventDefault();
          if (s.selectedIds.length > 0) {
            clipboard.duplicateSelection().then((ids) => {
              if (ids.length > 0) pushToast({ msg: `已复制 ${ids.length} 个标注`, kind: "success" });
            });
          }
          return;
        }
        return;
      }

      // 方向键 nudge（无 Ctrl）
      if (ARROW_KEYS.has(e.key) && s.selectedIds.length > 0) {
        // 只对 user 框 nudge
        const hasUser = s.selectedIds.some((id) =>
          annotationsRef.current.some((a) => a.id === id),
        );
        if (hasUser) {
          e.preventDefault();
          const step = e.shiftKey ? 10 : 1;
          const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
          const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
          applyArrowNudge(dx, dy);
          return;
        }
      }

      // 单键
      if (e.key === " ") { e.preventDefault(); setSpacePan(true); return; }
      if (e.key === "?") { setShowHotkeys(true); return; }
      if (e.key === "Escape") {
        if (showHotkeys) { setShowHotkeys(false); return; }
        if (batchChanging) { setBatchChanging(false); return; }
        if (s.pendingDrawing) { s.setPendingDrawing(null); return; }
        if (s.editingClass) { s.setEditingClass(null); return; }
        s.setSelectedId(null);
        return;
      }
      // pendingDrawing / editingClass / batchChanging 时类别按键由 popover 自己消费，不再切换 default
      if (s.pendingDrawing || s.editingClass || batchChanging) return;

      // [ / ] 调阈值（clamp 到 [0, 1]，step 0.05）
      if (e.key === "[") {
        e.preventDefault();
        s.setConfThreshold(Math.max(0, +(s.confThreshold - 0.05).toFixed(2)));
        return;
      }
      if (e.key === "]") {
        e.preventDefault();
        s.setConfThreshold(Math.min(1, +(s.confThreshold + 0.05).toFixed(2)));
        return;
      }

      // Tab / Shift+Tab / J / K：在 user 框间循环
      if (e.key === "Tab" || e.key === "j" || e.key === "J" || e.key === "k" || e.key === "K") {
        const list = annotationsRef.current;
        if (list.length === 0) return;
        e.preventDefault();
        const dir = (e.key === "Tab" && !e.shiftKey) || e.key === "j" || e.key === "J" ? 1 : -1;
        const idxNow = s.selectedId ? list.findIndex((a) => a.id === s.selectedId) : -1;
        let next: number;
        if (e.key === "Tab") {
          next = (idxNow + dir + list.length) % list.length;
        } else {
          // J / K 不循环，到边界停住
          next = Math.max(0, Math.min(list.length - 1, idxNow < 0 ? 0 : idxNow + dir));
        }
        s.setSelectedId(list[next].id);
        return;
      }

      // N / U 智能切题
      if (e.key === "n" || e.key === "N") { smartNext("open"); return; }
      if (e.key === "u" || e.key === "U") { smartNext("uncertain"); return; }

      // C 键：选中 user 框时 → 改类别（单选时单改，多选时批量改）
      if ((e.key === "c" || e.key === "C") && s.selectedIds.length > 0) {
        const userIds = s.selectedIds.filter((id) =>
          annotationsRef.current.some((a) => a.id === id),
        );
        if (userIds.length > 1) { handleStartBatchChangeClass(); return; }
        if (userIds.length === 1) { handleStartChangeClass(userIds[0]); return; }
      }
      if (e.key === "v" || e.key === "V") { s.setTool("hand"); return; }
      if (e.key === "b" || e.key === "B") { s.setTool("box"); return; }
      if (e.key >= "1" && e.key <= "9") {
        const idx = parseInt(e.key) - 1;
        if (classes[idx]) { s.setActiveClass(classes[idx]); recordRecentClass(classes[idx]); }
        return;
      }
      // 字母 a-z 切换默认类别（第 10 类起，跳过已绑定的 v/b/a/d/e/n/u/j/k/c）
      if (/^[a-z]$/i.test(e.key) &&
          !["v", "V", "b", "B", "a", "A", "d", "D", "e", "E", "n", "N", "u", "U", "j", "J", "k", "K", "c", "C"].includes(e.key)) {
        const letterIdx = e.key.toLowerCase().charCodeAt(0) - "a".charCodeAt(0);
        const idx = 9 + letterIdx;
        if (classes[idx]) { s.setActiveClass(classes[idx]); recordRecentClass(classes[idx]); return; }
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        const userIds = s.selectedIds.filter((id) =>
          annotationsRef.current.some((a) => a.id === id),
        );
        if (userIds.length > 1) handleBatchDelete();
        else if (userIds.length === 1) handleDeleteBox(userIds[0]);
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
      if (ARROW_KEYS.has(e.key)) {
        // 松开方向键 → 一次性 commit 全部 nudge
        flushNudges();
      }
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
    smartNext, clipboard, pushToast, batchChanging, flushNudges,
    handleBatchDelete, handleStartBatchChangeClass, stageGeom.imgW, stageGeom.imgH,
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
          confThreshold={s.confThreshold}
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
          onSmartNextOpen={() => smartNext("open")}
          onSmartNextUncertain={() => smartNext("uncertain")}
        />

        <ImageStage
          fileUrl={task?.file_url ?? null}
          blurhash={task?.blurhash ?? null}
          tool={s.tool}
          activeClass={s.activeClass}
          selectedId={s.selectedId}
          selectedIds={s.selectedIds}
          fadedAiIds={dimmedAiIds}
          nudgeMap={nudgeMap}
          userBoxes={userBoxes}
          aiBoxes={aiBoxes}
          spacePan={spacePan}
          vp={vp}
          setVp={setVp}
          fitTick={fitTick}
          pendingDrawing={s.pendingDrawing}
          onSelectBox={handleSelectBox}
          onAcceptPrediction={handleAcceptPrediction}
          onDeleteUserBox={handleDeleteBox}
          onCommitDrawing={handleCommitDrawing}
          onCommitMove={handleCommitMove}
          onCommitResize={handleCommitResize}
          onCursorMove={setCursor}
          onChangeUserBoxClass={handleStartChangeClass}
          onBatchDelete={handleBatchDelete}
          onBatchChangeClass={handleStartBatchChangeClass}
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
              {batchChanging && stageGeom.imgW > 0 && !s.pendingDrawing && !s.editingClass && (() => {
                const firstId = s.selectedIds[0];
                const firstAnn = annotationsRef.current.find((a) => a.id === firstId);
                if (!firstAnn) return null;
                return (
                  <ClassPickerPopover
                    geom={firstAnn.geometry as Geom}
                    imgW={stageGeom.imgW}
                    imgH={stageGeom.imgH}
                    vp={vp}
                    classes={classes}
                    recent={recentClasses}
                    defaultClass={firstAnn.class_name}
                    title={`批量改类别 (${s.selectedIds.length} 个)`}
                    onPick={handleCommitBatchChangeClass}
                    onCancel={handleCancelBatchChange}
                  />
                );
              })()}
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
          avgLeadMs={avgMs}
          remainingTaskCount={remainingTaskCount}
        />
      </div>

      <AIInspectorPanel
        open={rightOpen}
        aiModel={aiModel}
        aiRunning={aiRunning}
        aiBoxes={aiBoxes}
        userBoxes={userBoxes}
        selectedId={s.selectedId}
        selectedIds={s.selectedIds}
        dimmedAiIds={dimmedAiIds}
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
        onSelect={handleSelectBox}
        onAcceptPrediction={handleAcceptPrediction}
        onClearSelection={() => s.setSelectedId(null)}
        onDeleteUserBox={handleDeleteBox}
        onChangeUserBoxClass={handleStartChangeClass}
      />

      <HotkeyCheatSheet open={showHotkeys} onClose={() => setShowHotkeys(false)} />
    </div>
  );
}
