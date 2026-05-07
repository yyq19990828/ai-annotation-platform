// v0.6.4 P1：从 WorkbenchShell 拆出的标注 mutation 接线层。
//
// 集中管理 7 个 handler：
//  - optimisticEnqueueCreate（共用 fallback：tmpId + cache + 离线队列）
//  - handlePickPendingClass（bbox create）
//  - submitPolygon（polygon create）
//  - handleDeleteBox
//  - handleCommitMove / handleCommitResize / handleCommitPolygonGeometry
// 以及 polygon 草稿状态 + PolygonDraftHandle。
//
// 不在这里管的：键盘 dispatch（键位在 useWorkbenchHotkeys）、history undo/redo 本身。

import { useCallback, useEffect, useMemo, useState } from "react";
import type { QueryClient } from "@tanstack/react-query";

import { isSelfIntersecting, type Pt } from "../stage/polygonGeom";
import { UNKNOWN_CLASS } from "../stage/colors";
import type { PolygonDraftHandle } from "../stage/tools";
import { bboxGeom, polygonGeom } from "../state/transforms";
import { enqueue } from "../state/offlineQueue";
import type { useWorkbenchState } from "../state/useWorkbenchState";
import type { useAnnotationHistory } from "../state/useAnnotationHistory";
import type { AnnotationPayload } from "@/api/tasks";
import type { AnnotationResponse } from "@/types";

type Geom = { x: number; y: number; w: number; h: number };

interface ToastInput {
  msg: string;
  sub?: string;
  kind?: "success" | "warning" | "error" | "";
}

export interface AnnotationMutations {
  create: { mutate: (p: AnnotationPayload, opts?: { onSuccess?: (a: AnnotationResponse) => void; onError?: (e: unknown) => void }) => void };
  update: { mutate: (vars: { annotationId: string; payload: Partial<AnnotationPayload> }, opts?: { onSuccess?: () => void; onError?: (e: unknown) => void }) => void };
  delete: { mutate: (id: string, opts?: { onSuccess?: () => void; onError?: (e: unknown) => void }) => void };
}

export interface UseWorkbenchAnnotationActionsArgs {
  taskId: string | undefined;
  projectId: string | undefined;
  meUserId: string | null | undefined;
  queryClient: QueryClient;
  history: ReturnType<typeof useAnnotationHistory>;
  s: ReturnType<typeof useWorkbenchState>;
  pushToast: (toast: ToastInput) => void;
  recordRecentClass: (cls: string) => void;
  mutations: AnnotationMutations;
  enqueueOnError: (err: unknown, fallback: () => void) => void;
  /** 由 shell 维护的当前 annotations ref（避免 stale closure）。*/
  annotationsRef: { current: AnnotationResponse[] };
  /** v0.6.5：任务已锁定（review/completed），所有写动作直接 short-circuit + toast。 */
  isLocked?: boolean;
}

export interface UseWorkbenchAnnotationActionsReturn {
  /** 共用 create fallback：分配 tmpId → cache → history → enqueue。*/
  optimisticEnqueueCreate: (payload: AnnotationPayload) => void;
  handlePickPendingClass: (cls: string) => void;
  submitPolygon: (points: [number, number][]) => void;
  handleDeleteBox: (id: string) => void;
  handleCommitMove: (id: string, before: Geom, after: Geom) => void;
  handleCommitResize: (id: string, before: Geom, after: Geom) => void;
  handleCommitPolygonGeometry: (id: string, before: Pt[], after: Pt[]) => void;
  /** polygon 草稿点集（由 hotkeys hook 借用一份引用做 Enter/Esc/Backspace 处理）。*/
  polygonDraftPoints: [number, number][];
  setPolygonDraftPoints: React.Dispatch<React.SetStateAction<[number, number][]>>;
  /** 给 ImageStage 用的 PolygonDraftHandle，已 memoize。*/
  polygonHandle: PolygonDraftHandle;
}

export function useWorkbenchAnnotationActions({
  taskId,
  projectId,
  meUserId,
  queryClient,
  history,
  s,
  pushToast,
  recordRecentClass,
  mutations,
  enqueueOnError,
  annotationsRef,
  isLocked = false,
}: UseWorkbenchAnnotationActionsArgs): UseWorkbenchAnnotationActionsReturn {
  const setQ = queryClient.setQueryData.bind(queryClient);

  /** v0.6.5：锁定时 short-circuit；返回 true 表示已被拦截。 */
  const blockIfLocked = useCallback((): boolean => {
    if (isLocked) {
      pushToast({ msg: "任务已锁定", sub: "撤回提交或继续编辑后再操作", kind: "warning" });
      return true;
    }
    return false;
  }, [isLocked, pushToast]);

  /** 共用：写入 annotations cache 中的某条 geometry（bbox 移动 / resize / polygon 编辑都用）。 */
  const optimisticUpdateGeom = useCallback(
    (id: string, afterG: Record<string, unknown>) => {
      if (!taskId) return;
      setQ<AnnotationResponse[]>(["annotations", taskId], (prev) =>
        (prev ?? []).map((a) => (a.id === id ? { ...a, geometry: afterG as AnnotationResponse["geometry"] } : a)),
      );
    },
    [taskId, setQ],
  );

  /** 共用：从 annotations cache 中删除一条（delete fallback）。 */
  const optimisticDelete = useCallback(
    (id: string) => {
      if (!taskId) return;
      setQ<AnnotationResponse[]>(["annotations", taskId], (prev) =>
        (prev ?? []).filter((a) => a.id !== id),
      );
    },
    [taskId, setQ],
  );

  /** v0.6.3 P0：create 失败兜底（共用 bbox / polygon）。*/
  const optimisticEnqueueCreate = useCallback(
    (payload: AnnotationPayload) => {
      if (!taskId) return;
      const tmpId = `tmp_${crypto.randomUUID()}`;
      const optimistic: AnnotationResponse = {
        id: tmpId,
        task_id: taskId,
        project_id: projectId ?? null,
        user_id: meUserId ?? null,
        source: "manual",
        annotation_type: payload.annotation_type ?? "bbox",
        class_name: payload.class_name,
        geometry: payload.geometry,
        confidence: payload.confidence ?? 1,
        parent_prediction_id: null,
        parent_annotation_id: null,
        lead_time: null,
        is_active: true,
        ground_truth: false,
        attributes: payload.attributes ?? {},
        created_at: new Date().toISOString(),
        updated_at: null,
      };
      setQ<AnnotationResponse[]>(["annotations", taskId], (prev) => [...(prev ?? []), optimistic]);
      s.setSelectedId(tmpId);
      history.push({ kind: "create", annotationId: tmpId, payload });
      enqueue({ kind: "create", id: crypto.randomUUID(), tmpId, taskId, payload, ts: Date.now() });
    },
    [taskId, projectId, meUserId, setQ, s, history],
  );

  // ── polygon 草稿 ──────────────────────────────────────────────────
  const [polygonDraftPoints, setPolygonDraftPoints] = useState<[number, number][]>([]);
  // 切到非 polygon 工具或切题清空草稿
  useEffect(() => { if (s.tool !== "polygon") setPolygonDraftPoints([]); }, [s.tool]);
  useEffect(() => { setPolygonDraftPoints([]); }, [taskId]);

  const submitPolygon = useCallback(
    (points: [number, number][]) => {
      if (blockIfLocked()) return;
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
      mutations.create.mutate(payload, {
        onSuccess: (created) => {
          history.push({ kind: "create", annotationId: created.id, payload });
          s.setSelectedId(created.id);
          recordRecentClass(cls);
          pushToast({ msg: "已创建多边形", sub: `${points.length} 顶点 · ${cls}`, kind: "success" });
        },
        onError: (err) => enqueueOnError(err, () => optimisticEnqueueCreate(payload)),
      });
    },
    [blockIfLocked, s, mutations, history, recordRecentClass, pushToast, enqueueOnError, optimisticEnqueueCreate],
  );

  const polygonHandle = useMemo<PolygonDraftHandle>(
    () => ({
      points: polygonDraftPoints,
      addPoint: (pt) => setPolygonDraftPoints((p) => [...p, pt]),
      close: () => submitPolygon(polygonDraftPoints),
      cancel: () => setPolygonDraftPoints([]),
    }),
    [polygonDraftPoints, submitPolygon],
  );

  // ── handlers ───────────────────────────────────────────────────────

  const handlePickPendingClass = useCallback(
    (cls: string) => {
      if (blockIfLocked()) { s.setPendingDrawing(null); return; }
      const pending = s.pendingDrawing;
      if (!pending || !cls) return;
      const isUnknown = cls === UNKNOWN_CLASS;
      const payload: AnnotationPayload = {
        annotation_type: "bbox",
        class_name: cls,
        geometry: bboxGeom(pending.geom),
        confidence: 1,
      };
      s.setPendingDrawing(null);
      // unknown 是「画完未选类」的兜底，不应污染 activeClass / 最近使用类。
      if (!isUnknown) {
        s.setActiveClass(cls);
        recordRecentClass(cls);
      }
      mutations.create.mutate(payload, {
        onSuccess: (newAnnotation) => {
          s.setSelectedId(newAnnotation.id);
          history.push({ kind: "create", annotationId: newAnnotation.id, payload });
        },
        onError: (err) => enqueueOnError(err, () => optimisticEnqueueCreate(payload)),
      });
    },
    [blockIfLocked, s, mutations, history, recordRecentClass, enqueueOnError, optimisticEnqueueCreate],
  );

  const handleDeleteBox = useCallback(
    (id: string) => {
      if (blockIfLocked()) return;
      const target = annotationsRef.current.find((a) => a.id === id);
      if (target && taskId) {
        mutations.delete.mutate(id, {
          onSuccess: () => {
            history.push({ kind: "delete", annotation: target });
            pushToast({ msg: "已删除标注", kind: "success" });
          },
          onError: (err) =>
            enqueueOnError(err, () => {
              optimisticDelete(id);
              history.push({ kind: "delete", annotation: target });
              enqueue({ kind: "delete", id: crypto.randomUUID(), taskId, annotationId: id, ts: Date.now() });
            }),
        });
      }
      s.setSelectedId(null);
    },
    [blockIfLocked, mutations, history, pushToast, s, taskId, enqueueOnError, optimisticDelete, annotationsRef],
  );

  const handleCommitMove = useCallback(
    (id: string, before: Geom, after: Geom) => {
      if (blockIfLocked()) return;
      if (!taskId) return;
      const beforeG = bboxGeom(before);
      const afterG = bboxGeom(after);
      const payload = { geometry: afterG };
      mutations.update.mutate(
        { annotationId: id, payload },
        {
          onSuccess: () => {
            history.push({
              kind: "update", annotationId: id,
              before: { geometry: beforeG }, after: { geometry: afterG },
            });
          },
          onError: (err) =>
            enqueueOnError(err, () => {
              optimisticUpdateGeom(id, afterG);
              history.push({
                kind: "update", annotationId: id,
                before: { geometry: beforeG }, after: { geometry: afterG },
              });
              enqueue({ kind: "update", id: crypto.randomUUID(), taskId, annotationId: id, payload, ts: Date.now() });
            }),
        },
      );
    },
    [blockIfLocked, mutations, history, taskId, enqueueOnError, optimisticUpdateGeom],
  );

  const handleCommitResize = useCallback(
    (id: string, before: Geom, after: Geom) => {
      if (blockIfLocked()) return;
      if (after.w < 0.005 || after.h < 0.005) {
        pushToast({ msg: "框太小未保存", sub: "拖动到至少 0.5% × 0.5%", kind: "error" });
        return;
      }
      if (!taskId) return;
      const beforeG = bboxGeom(before);
      const afterG = bboxGeom(after);
      const payload = { geometry: afterG };
      mutations.update.mutate(
        { annotationId: id, payload },
        {
          onSuccess: () => {
            history.push({
              kind: "update", annotationId: id,
              before: { geometry: beforeG }, after: { geometry: afterG },
            });
          },
          onError: (err) =>
            enqueueOnError(err, () => {
              optimisticUpdateGeom(id, afterG);
              history.push({
                kind: "update", annotationId: id,
                before: { geometry: beforeG }, after: { geometry: afterG },
              });
              enqueue({ kind: "update", id: crypto.randomUUID(), taskId, annotationId: id, payload, ts: Date.now() });
            }),
        },
      );
    },
    [blockIfLocked, mutations, history, pushToast, taskId, enqueueOnError, optimisticUpdateGeom],
  );

  const handleCommitPolygonGeometry = useCallback(
    (id: string, before: Pt[], after: Pt[]) => {
      if (blockIfLocked()) return;
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
      mutations.update.mutate(
        { annotationId: id, payload },
        {
          onSuccess: () => {
            history.push({
              kind: "update", annotationId: id,
              before: { geometry: beforeG }, after: { geometry: afterG },
            });
          },
          onError: (err) =>
            enqueueOnError(err, () => {
              optimisticUpdateGeom(id, afterG);
              history.push({
                kind: "update", annotationId: id,
                before: { geometry: beforeG }, after: { geometry: afterG },
              });
              enqueue({ kind: "update", id: crypto.randomUUID(), taskId, annotationId: id, payload, ts: Date.now() });
            }),
        },
      );
    },
    [blockIfLocked, mutations, history, pushToast, taskId, enqueueOnError, optimisticUpdateGeom],
  );

  return {
    optimisticEnqueueCreate,
    handlePickPendingClass,
    submitPolygon,
    handleDeleteBox,
    handleCommitMove,
    handleCommitResize,
    handleCommitPolygonGeometry,
    polygonDraftPoints,
    setPolygonDraftPoints,
    polygonHandle,
  };
}
