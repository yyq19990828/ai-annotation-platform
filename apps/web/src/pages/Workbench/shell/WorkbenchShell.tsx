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
import { dispatchKey, ARROW_KEY_SET } from "../state/hotkeys";
import { annotationToBox, bboxGeom, polygonGeom, predictionsToBoxes, type AiBox } from "../state/transforms";
import type { PolygonDraftHandle } from "../stage/tools";
import type { AnnotationPayload } from "@/api/tasks";
import { iouShape } from "../stage/iou";
import { isSelfIntersecting, type Pt } from "../stage/polygonGeom";
import { setActiveClassesConfig, sortClassesByConfig } from "../stage/colors";
import { getMissingRequired } from "./AttributeForm";
import { ImageStage } from "../stage/ImageStage";
import { Topbar } from "./Topbar";
import { ToolDock } from "./ToolDock";
import { FloatingDock } from "./FloatingDock";
import { ThemeSwitcher } from "./ThemeSwitcher";
import { TaskQueuePanel } from "./TaskQueuePanel";
import { AIInspectorPanel } from "./AIInspectorPanel";
import { StatusBar } from "./StatusBar";
import { HotkeyCheatSheet } from "./HotkeyCheatSheet";
import { ClassPickerPopover } from "./ClassPickerPopover";
import { Minimap } from "../stage/Minimap";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { useAuthStore } from "@/stores/authStore";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { drain, enqueue, isOfflineCandidate } from "../state/offlineQueue";
import { WorkbenchSkeleton } from "./WorkbenchSkeleton";

type Geom = { x: number; y: number; w: number; h: number };

export function WorkbenchShell() {
  const { id: routeId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const onBack = useCallback(() => navigate("/dashboard"), [navigate]);
  const pushToast = useToastStore((s) => s.push);

  const { data: currentProject, isLoading: isProjectLoading } = useProject(routeId ?? "");
  const projectId = currentProject?.id;
  const rawClasses: string[] = currentProject?.classes ?? [];
  const classesConfig = currentProject?.classes_config;
  const classes: string[] = useMemo(
    () => sortClassesByConfig(rawClasses, classesConfig),
    [rawClasses, classesConfig],
  );

  // 设置全局色板覆盖（让 ImageStage / SelectionOverlay 等无需逐层接 prop）
  useEffect(() => {
    setActiveClassesConfig(classesConfig);
    return () => setActiveClassesConfig(undefined);
  }, [classesConfig]);

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
  const meUserId = useAuthStore((s) => s.user?.id);

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

  // IoU 视觉去重：与已确认 user 框 IoU > 项目级阈值（默认 0.7）且 class 相同的 AI 框 → 淡化
  const iouDedupThreshold = currentProject?.iou_dedup_threshold ?? 0.7;
  const dimmedAiIds = useMemo(() => {
    const out = new Set<string>();
    if (userBoxes.length === 0 || aiBoxes.length === 0) return out;
    for (const a of aiBoxes) {
      const sameClass = userBoxes.filter((u) => u.cls === a.cls);
      if (sameClass.some((u) => iouShape(u, a) > iouDedupThreshold)) out.add(a.id);
    }
    return out;
  }, [userBoxes, aiBoxes, iouDedupThreshold]);

  // 方向键 nudge：临时几何 override，松开方向键时一次性 batch 提交
  const [nudgeMap, setNudgeMap] = useState<Map<string, Geom>>(new Map());
  const nudgeOrigRef = useRef<Map<string, Geom>>(new Map());
  // 切题清空 nudge
  useEffect(() => { setNudgeMap(new Map()); nudgeOrigRef.current = new Map(); }, [taskId]);

  // 批量改类 popover：anchor 到 selectedIds 第一个 user 框的 geom
  const [batchChanging, setBatchChanging] = useState(false);

  // ── polygon 工具草稿（v0.5.3） ────────────────────────────────────────────
  const [polygonDraftPoints, setPolygonDraftPoints] = useState<[number, number][]>([]);
  // 切到非 polygon 工具或切题清空草稿
  useEffect(() => { if (s.tool !== "polygon") setPolygonDraftPoints([]); }, [s.tool]);
  useEffect(() => { setPolygonDraftPoints([]); }, [taskId]);

  const submitPolygon = useCallback((points: [number, number][]) => {
    const cls = s.activeClass;
    if (points.length < 3) {
      pushToast({ msg: "多边形需至少 3 个顶点", kind: "warning" });
      return;
    }
    if (!cls) {
      pushToast({ msg: "请先选择类别", kind: "warning" });
      return;
    }
    const payload: AnnotationPayload = {
      annotation_type: "polygon",
      class_name: cls,
      geometry: { type: "polygon", points },
      confidence: 1,
    };
    setPolygonDraftPoints([]);
    createAnnotation.mutate(payload, {
      onSuccess: (created) => {
        history.push({ kind: "create", annotationId: created.id, payload });
        s.setSelectedId(created.id);
        recordRecentClass(cls);
        pushToast({ msg: "已创建多边形", sub: `${points.length} 顶点 · ${cls}`, kind: "success" });
      },
    });
  }, [s, createAnnotation, history, recordRecentClass, pushToast]);

  const polygonHandle = useMemo<PolygonDraftHandle>(() => ({
    points: polygonDraftPoints,
    addPoint: (pt) => setPolygonDraftPoints((p) => [...p, pt]),
    close: () => submitPolygon(polygonDraftPoints),
    cancel: () => setPolygonDraftPoints([]),
  }), [polygonDraftPoints, submitPolygon]);

  // polygon 专用键（Enter / Esc / Backspace）。capture 阶段拦截，避免主分发再处理。
  useEffect(() => {
    if (s.tool !== "polygon") return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target;
      if (t instanceof HTMLElement && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (polygonDraftPoints.length === 0) return;
      if (e.key === "Enter" && polygonDraftPoints.length >= 3) {
        e.preventDefault(); e.stopPropagation();
        submitPolygon(polygonDraftPoints);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault(); e.stopPropagation();
        setPolygonDraftPoints([]);
        return;
      }
      if (e.key === "Backspace") {
        e.preventDefault(); e.stopPropagation();
        setPolygonDraftPoints((p) => p.slice(0, -1));
        return;
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [s.tool, polygonDraftPoints, submitPolygon]);

  const flushNudges = useCallback(() => {
    if (nudgeMap.size === 0) return;
    const cmds: { kind: "update"; annotationId: string; before: { geometry: ReturnType<typeof bboxGeom> }; after: { geometry: ReturnType<typeof bboxGeom> } }[] = [];
    nudgeMap.forEach((after, id) => {
      const before = nudgeOrigRef.current.get(id);
      if (!before) return;
      // 真有变化才 commit
      if (before.x === after.x && before.y === after.y && before.w === after.w && before.h === after.h) return;
      const beforeG = bboxGeom(before);
      const afterG = bboxGeom(after);
      updateAnnotationMut.mutate({ annotationId: id, payload: { geometry: afterG } });
      cmds.push({ kind: "update", annotationId: id, before: { geometry: beforeG }, after: { geometry: afterG } });
    });
    if (cmds.length > 0) history.pushBatch(cmds);
    setNudgeMap(new Map());
    nudgeOrigRef.current = new Map();
  }, [nudgeMap, updateAnnotationMut, history]);

  // ── 离线队列：网络抖动 / 5xx 时把 mutation 暂存到 IndexedDB；恢复在线后 flush ─
  const { online, queueCount } = useOnlineStatus();

  const enqueueOnError = useCallback((err: unknown, fallback: () => void) => {
    if (isOfflineCandidate(err)) {
      fallback();
      pushToast({ msg: "已暂存到离线队列", sub: "恢复连接后将自动同步", kind: "warning" });
    } else {
      pushToast({ msg: "操作失败", sub: String(err), kind: "error" });
    }
  }, [pushToast]);

  const flushOffline = useCallback(async () => {
    const result = await drain(async (op) => {
      if (op.kind === "create") {
        await tasksApi.createAnnotation(op.taskId, op.payload as Parameters<typeof tasksApi.createAnnotation>[1]);
      } else if (op.kind === "update") {
        await tasksApi.updateAnnotation(op.taskId, op.annotationId, op.payload as Parameters<typeof tasksApi.updateAnnotation>[2]);
      } else {
        await tasksApi.deleteAnnotation(op.taskId, op.annotationId);
      }
    });
    if (result.ok > 0) {
      queryClient.invalidateQueries({ queryKey: ["annotations"] });
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      pushToast({ msg: `已同步 ${result.ok} 条离线操作`, kind: "success" });
    }
    if (result.failed > 0) {
      pushToast({ msg: "部分操作仍未能同步", sub: "请检查网络后重试", kind: "warning" });
    }
  }, [queryClient, pushToast]);

  // online 事件触发自动 flush
  useEffect(() => {
    if (online && queueCount > 0) flushOffline();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online]);

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
    if (target && taskId) {
      deleteAnnotationMut.mutate(id, {
        onSuccess: () => {
          history.push({ kind: "delete", annotation: target });
          pushToast({ msg: "已删除标注", kind: "success" });
        },
        onError: (err) => enqueueOnError(err, () => {
          enqueue({ kind: "delete", id: crypto.randomUUID(), taskId, annotationId: id, ts: Date.now() });
        }),
      });
    }
    s.setSelectedId(null);
  }, [deleteAnnotationMut, history, pushToast, s, taskId, enqueueOnError]);

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
      geometry: bboxGeom(pending.geom),
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
      onError: (err) => enqueueOnError(err, () => {
        if (taskId) enqueue({ kind: "create", id: crypto.randomUUID(), taskId, payload, ts: Date.now() });
      }),
    });
  }, [s, createAnnotation, history, recordRecentClass, taskId, enqueueOnError]);

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
    if (!taskId) return;
    const beforeG = bboxGeom(before);
    const afterG = bboxGeom(after);
    const payload = { geometry: afterG };
    updateAnnotationMut.mutate({ annotationId: id, payload }, {
      onSuccess: () => {
        history.push({
          kind: "update", annotationId: id,
          before: { geometry: beforeG }, after: { geometry: afterG },
        });
      },
      onError: (err) => enqueueOnError(err, () => {
        enqueue({ kind: "update", id: crypto.randomUUID(), taskId, annotationId: id, payload, ts: Date.now() });
      }),
    });
  }, [updateAnnotationMut, history, taskId, enqueueOnError]);

  const handleCommitPolygonGeometry = useCallback((id: string, before: Pt[], after: Pt[]) => {
    if (after.length < 3) {
      pushToast({ msg: "多边形至少需要 3 顶点", kind: "error" });
      return;
    }
    if (!isSelfIntersecting(after).ok) {
      pushToast({ msg: "多边形自相交，已撤销", kind: "error" });
      return;
    }
    if (!taskId) return;
    const beforeG = polygonGeom(before);
    const afterG = polygonGeom(after);
    const payload = { geometry: afterG };
    updateAnnotationMut.mutate({ annotationId: id, payload }, {
      onSuccess: () => {
        history.push({
          kind: "update", annotationId: id,
          before: { geometry: beforeG }, after: { geometry: afterG },
        });
      },
      onError: (err) => enqueueOnError(err, () => {
        enqueue({ kind: "update", id: crypto.randomUUID(), taskId, annotationId: id, payload, ts: Date.now() });
      }),
    });
  }, [updateAnnotationMut, history, pushToast, taskId, enqueueOnError]);

  const handleCommitResize = useCallback((id: string, before: Geom, after: Geom) => {
    if (after.w < 0.005 || after.h < 0.005) {
      pushToast({ msg: "框太小未保存", sub: "拖动到至少 0.5% × 0.5%", kind: "error" });
      return;
    }
    if (!taskId) return;
    const beforeG = bboxGeom(before);
    const afterG = bboxGeom(after);
    const payload = { geometry: afterG };
    updateAnnotationMut.mutate({ annotationId: id, payload }, {
      onSuccess: () => {
        history.push({
          kind: "update", annotationId: id,
          before: { geometry: beforeG }, after: { geometry: afterG },
        });
      },
      onError: (err) => enqueueOnError(err, () => {
        enqueue({ kind: "update", id: crypto.randomUUID(), taskId, annotationId: id, payload, ts: Date.now() });
      }),
    });
  }, [updateAnnotationMut, history, pushToast, taskId, enqueueOnError]);

  /** 选中态的 AnnotationResponse（驱动右侧栏属性表单）。仅单选 user 框时返回。 */
  const selectedAnnotationForPanel = useMemo<AnnotationResponse | null>(() => {
    if (!s.selectedId || s.selectedIds.length > 1) return null;
    return (annotationsData ?? []).find((a) => a.id === s.selectedId) ?? null;
  }, [s.selectedId, s.selectedIds.length, annotationsData]);

  const handleUpdateAttributes = useCallback((annotationId: string, next: Record<string, unknown>) => {
    const ann = annotationsRef.current.find((a) => a.id === annotationId);
    if (!ann) return;
    const before = { attributes: ann.attributes ?? {} };
    const after = { attributes: next };
    updateAnnotationMut.mutate({ annotationId, payload: after }, {
      onSuccess: () => {
        history.push({ kind: "update", annotationId, before, after });
      },
    });
  }, [updateAnnotationMut, history]);

  /** 计算所有 annotation 中是否有 required 属性未填（驱动提交按钮 disabled）。 */
  const hasMissingRequired = useMemo(() => {
    const schema = currentProject?.attribute_schema;
    if (!schema || !schema.fields || schema.fields.length === 0) return false;
    for (const a of annotationsRef.current) {
      if (getMissingRequired(schema, a.class_name, a.attributes ?? {}).length > 0) return true;
    }
    return false;
    // 当 annotations 列表变化时重算
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [annotationsData, currentProject?.attribute_schema]);

  const handleSubmitTask = useCallback(() => {
    if (!taskId) return;
    if (hasMissingRequired) {
      pushToast({ msg: "存在必填属性未填，无法提交", sub: "请检查右侧标注属性表单", kind: "error" });
      return;
    }
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
  }, [taskId, submitTaskMut, pushToast, task?.display_id, userBoxes.length, navigateTask, hasMissingRequired]);

  // ── 键盘快捷键 ──────────────────────────────────────────────────────────
  useEffect(() => {
    const isInputFocused = (el: EventTarget | null) =>
      el instanceof HTMLElement && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);

    const applyArrowNudge = (dx: number, dy: number) => {
      const userTargets = s.selectedIds
        .map((id) => annotationsRef.current.find((a) => a.id === id))
        .filter(Boolean) as AnnotationResponse[];
      if (userTargets.length === 0) return;
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
      // D.1：属性 hotkey 查找 —— 仅当单选 user 框时启用
      const attributeHotkey = (digit: string) => {
        const sel = s.selectedId;
        if (!sel) return null;
        const ann = annotationsRef.current.find((a) => a.id === sel);
        if (!ann) return null;
        const fields = currentProject?.attribute_schema?.fields ?? [];
        for (const f of fields) {
          if (f.hotkey !== digit) continue;
          if (f.type !== "boolean" && f.type !== "select") continue;
          // applies_to 过滤
          const applies = f.applies_to;
          if (Array.isArray(applies) && !applies.includes(ann.class_name)) continue;
          const cur = (ann.attributes ?? {})[f.key];
          if (f.type === "boolean") {
            return { key: f.key, type: "boolean" as const, currentValue: cur };
          }
          // select
          const opts = (f.options ?? []).map((o) => o.value);
          return { key: f.key, type: "select" as const, options: opts, currentValue: cur };
        }
        return null;
      };

      const action = dispatchKey(e, {
        isInputFocused: isInputFocused(e.target),
        hasSelection: !!s.selectedId || s.selectedIds.length > 0,
        pendingActive: !!s.pendingDrawing || !!s.editingClass || batchChanging,
        attributeHotkey,
      });
      if (!action) return;

      switch (action.type) {
        case "undo": e.preventDefault(); history.undo(); return;
        case "redo": e.preventDefault(); history.redo(); return;
        case "fitReset": e.preventDefault(); setFitTick((n) => n + 1); return;
        case "navigateTask": e.preventDefault(); navigateTask(action.dir); return;

        case "selectAllUser":
          e.preventDefault();
          if (annotationsRef.current.length > 0) {
            s.replaceSelected(annotationsRef.current.map((a) => a.id));
          }
          return;

        case "copy": {
          e.preventDefault();
          const n = clipboard.copySelection();
          if (n > 0) pushToast({ msg: `已复制 ${n} 个标注`, kind: "success" });
          return;
        }
        case "paste":
          e.preventDefault();
          if (clipboard.hasClipboard) {
            clipboard.paste().then((ids) => {
              if (ids.length > 0) pushToast({ msg: `已粘贴 ${ids.length} 个标注`, kind: "success" });
            });
          }
          return;
        case "duplicate":
          e.preventDefault();
          if (s.selectedIds.length > 0) {
            clipboard.duplicateSelection().then((ids) => {
              if (ids.length > 0) pushToast({ msg: `已复制 ${ids.length} 个标注`, kind: "success" });
            });
          }
          return;

        case "arrowNudge": {
          // 仅当选中里有 user 框才消费方向键
          const hasUser = s.selectedIds.some((id) =>
            annotationsRef.current.some((a) => a.id === id),
          );
          if (!hasUser) return;
          e.preventDefault();
          applyArrowNudge(action.dx, action.dy);
          return;
        }

        case "spacePanOn": e.preventDefault(); setSpacePan(true); return;
        case "showHotkeys": setShowHotkeys(true); return;
        case "cancel":
          if (showHotkeys) { setShowHotkeys(false); return; }
          if (batchChanging) { setBatchChanging(false); return; }
          if (s.pendingDrawing) { s.setPendingDrawing(null); return; }
          if (s.editingClass) { s.setEditingClass(null); return; }
          s.setSelectedId(null);
          return;

        case "thresholdAdjust":
          e.preventDefault();
          s.setConfThreshold(Math.max(0, Math.min(1, +(s.confThreshold + action.delta).toFixed(2))));
          return;

        case "cycleUser": {
          const list = annotationsRef.current;
          if (list.length === 0) return;
          e.preventDefault();
          const idxNow = s.selectedId ? list.findIndex((a) => a.id === s.selectedId) : -1;
          let next: number;
          if (action.loop) {
            next = (idxNow + action.dir + list.length) % list.length;
          } else {
            next = Math.max(0, Math.min(list.length - 1, idxNow < 0 ? 0 : idxNow + action.dir));
          }
          s.setSelectedId(list[next].id);
          return;
        }

        case "smartNext": smartNext(action.mode); return;

        case "changeClass": {
          const userIds = s.selectedIds.filter((id) =>
            annotationsRef.current.some((a) => a.id === id),
          );
          if (userIds.length > 1) handleStartBatchChangeClass();
          else if (userIds.length === 1) handleStartChangeClass(userIds[0]);
          return;
        }

        case "setTool": s.setTool(action.tool); return;

        case "setClassByDigit":
          if (classes[action.idx]) { s.setActiveClass(classes[action.idx]); recordRecentClass(classes[action.idx]); }
          return;

        case "setAttribute": {
          // D.1：选中态下 1-9 命中属性 hotkey → 直接覆盖单字段
          e.preventDefault();
          if (!s.selectedId) return;
          const ann = annotationsRef.current.find((a) => a.id === s.selectedId);
          if (!ann) return;
          const next = { ...(ann.attributes ?? {}), [action.key]: action.value };
          handleUpdateAttributes(ann.id, next);
          return;
        }

        case "setClassByLetter": {
          const letterIdx = action.letter.charCodeAt(0) - "a".charCodeAt(0);
          const idx = 9 + letterIdx;
          if (classes[idx]) { s.setActiveClass(classes[idx]); recordRecentClass(classes[idx]); }
          return;
        }

        case "deleteSelected": {
          const userIds = s.selectedIds.filter((id) =>
            annotationsRef.current.some((a) => a.id === id),
          );
          if (userIds.length > 1) handleBatchDelete();
          else if (userIds.length === 1) handleDeleteBox(userIds[0]);
          return;
        }

        case "submit": handleSubmitTask(); return;

        case "acceptAi": {
          if (!s.selectedId) return;
          const aiBox = aiBoxes.find((b) => b.id === s.selectedId);
          if (aiBox) handleAcceptPrediction(aiBox);
          return;
        }
        case "rejectAi": {
          if (!s.selectedId) return;
          const aiBox = aiBoxes.find((b) => b.id === s.selectedId);
          if (aiBox) s.setSelectedId(null);
          return;
        }
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === " ") setSpacePan(false);
      if (ARROW_KEY_SET.has(e.key)) flushNudges();
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
    currentProject?.attribute_schema, handleUpdateAttributes,
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
        gridTemplateColumns: `${leftOpen ? "260px" : "32px"} 48px 1fr ${rightOpen ? "280px" : "32px"}`,
        height: "100%", overflow: "hidden", background: "var(--color-bg-sunken)",
      }}
    >
      <TaskQueuePanel
        open={leftOpen}
        projectName={projectName}
        projectDisplayId={projectDisplayId}
        classes={classes}
        classesConfig={currentProject?.classes_config}
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

      <ToolDock tool={s.tool} onSetTool={s.setTool} />

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
          taskIdx={taskIdx}
          taskTotal={tasks.length}
          aiRunning={aiRunning}
          isSubmitting={submitTaskMut.isPending}
          confThreshold={s.confThreshold}
          onShowHotkeys={() => setShowHotkeys(true)}
          onRunAi={handleRunAi}
          onPrev={() => navigateTask("prev")}
          onNext={() => navigateTask("next")}
          onSubmit={handleSubmitTask}
          onSmartNextOpen={() => smartNext("open")}
          onSmartNextUncertain={() => smartNext("uncertain")}
          overflowSlot={<ThemeSwitcher />}
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
          onCommitPolygonGeometry={handleCommitPolygonGeometry}
          onCursorMove={setCursor}
          onChangeUserBoxClass={handleStartChangeClass}
          onBatchDelete={handleBatchDelete}
          onBatchChangeClass={handleStartBatchChangeClass}
          onStageGeometry={setStageGeom}
          polygonDraft={s.tool === "polygon" ? polygonHandle : undefined}
          overlay={
            <>
              <FloatingDock
                scale={vp.scale}
                canUndo={history.canUndo}
                canRedo={history.canRedo}
                onUndo={history.undo}
                onRedo={history.redo}
                onZoomIn={() => setVp((cur) => ({ ...cur, scale: Math.min(8, cur.scale * 1.2) }))}
                onZoomOut={() => setVp((cur) => ({ ...cur, scale: Math.max(0.2, cur.scale / 1.2) }))}
                onFit={() => setFitTick((n) => n + 1)}
              />
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
          offlineQueueCount={queueCount}
          online={online}
          onFlushOffline={flushOffline}
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
        attributeSchema={currentProject?.attribute_schema}
        selectedAnnotation={selectedAnnotationForPanel}
        onUpdateAttributes={handleUpdateAttributes}
        currentUserId={meUserId}
      />

      <HotkeyCheatSheet open={showHotkeys} onClose={() => setShowHotkeys(false)} />
    </div>
  );
}
