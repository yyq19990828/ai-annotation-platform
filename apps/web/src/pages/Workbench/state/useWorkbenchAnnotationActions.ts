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
import type { KeypointDraftHandle, PolygonDraftHandle } from "../stage/tools";
import { toolUnitForTool } from "../stage/tools/toolUnits";
import { isComplexPolygonGeometry } from "../stage/shared/geometry/geometryEditPolicy";
import { bboxGeom, keypointGeom, polygonGeom, polylineGeom } from "../state/transforms";
import type { Geometry, Keypoint } from "@/types";
import { randomId } from "@/utils/id";
import { enqueue } from "../state/offlineQueue";
import type { useWorkbenchState } from "../state/useWorkbenchState";
import type { useAnnotationHistory } from "../state/useAnnotationHistory";
import type { AnnotationPayload, AnnotationUpdatePayload } from "@/api/tasks";
import type { AnnotationResponse, RotatedBboxGeometry } from "@/types";

type Geom = { x: number; y: number; w: number; h: number };

interface ToastInput {
  msg: string;
  sub?: string;
  kind?: "success" | "warning" | "error" | "";
}

export interface AnnotationMutations {
  create: {
    mutate: (
      p: AnnotationPayload,
      opts?: {
        onSuccess?: (a: AnnotationResponse) => void;
        onError?: (e: unknown) => void;
        onSettled?: () => void;
      },
    ) => void;
  };
  update: {
    mutate: (
      vars: { annotationId: string; payload: Partial<AnnotationPayload> },
      opts?: { onSuccess?: () => void; onError?: (e: unknown) => void; onSettled?: () => void },
    ) => void;
  };
  delete: {
    mutate: (
      id: string,
      opts?: { onSuccess?: () => void; onError?: (e: unknown) => void; onSettled?: () => void },
    ) => void;
  };
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
  /** v0.10.28 · 当前 keypoint 单元 schema 节点数；放满即自动提交一个实例。0 = 未配置 schema。 */
  keypointNodeCount?: number;
  /**
   * v0.20.22 · 同步登记提交在途几何 override, 桥接「setDrag(null)」与「onMutate 微任务
   * 回填 cache」之间的一帧空窗, 防松手闪回原尺寸。见 usePendingGeom。
   */
  markPendingGeom?: (id: string, geom: Geometry) => void;
}

export interface UseWorkbenchAnnotationActionsReturn {
  /** 共用 create fallback：分配 tmpId → cache → history → enqueue。*/
  optimisticEnqueueCreate: (payload: AnnotationPayload) => void;
  createBboxWithClass: (geom: Geom, cls: string) => boolean;
  /** v0.10.28 · 旋转框: 由轴对齐矩形 (归一化 x/y/w/h) 提交 angle=0 的 rotated_bbox; 类别用 activeClass。 */
  createRotatedBbox: (geom: Geom) => boolean;
  /** v0.10.28 · 旋转框: 旋转 / 缩放手柄落定时更新 OBB geometry (走 update mutation + history)。 */
  handleCommitRotateBbox: (
    id: string,
    before: RotatedBboxGeometry,
    after: RotatedBboxGeometry,
  ) => void;
  handlePickPendingClass: (cls: string) => void;
  submitPolygon: (points: [number, number][]) => void;
  /** v0.10.28 · 提交折线（不闭合，≥2 顶点）。*/
  submitPolyline: (points: [number, number][]) => void;
  handleDeleteBox: (id: string) => void;
  handleCommitMove: (
    id: string,
    before: Geom,
    after: Geom,
    childMoves?: { id: string; before: Geometry; after: Geometry }[],
  ) => void;
  handleCommitResize: (id: string, before: Geom, after: Geom) => void;
  handleCommitPolygonGeometry: (id: string, before: Pt[], after: Pt[]) => void;
  /** v0.10.28 · keypoint 节点几何/可见性变更。 */
  handleCommitKeypointGeometry: (id: string, before: Keypoint[], after: Keypoint[]) => void;
  /** v0.10.5 M4-β · I15 shape 状态位 (z_order / is_locked / is_hidden) 字段级 PATCH。*/
  handlePatchShapeFlag: (
    id: string,
    flag: "z_order" | "is_locked" | "is_hidden",
    value: number | boolean,
  ) => void;
  /** polygon 草稿点集（由 hotkeys hook 借用一份引用做 Enter/Esc/Backspace 处理）。*/
  polygonDraftPoints: [number, number][];
  setPolygonDraftPoints: React.Dispatch<React.SetStateAction<[number, number][]>>;
  /** 给 ImageStage 用的 PolygonDraftHandle，已 memoize。*/
  polygonHandle: PolygonDraftHandle;
  /** v0.10.28 · 折线草稿 handle（closed:false，复用同一 polygonDraftPoints）。*/
  polylineHandle: PolygonDraftHandle;
  /** v0.10.28 · 给 ImageStage 用的 KeypointDraftHandle，已 memoize。*/
  keypointHandle: KeypointDraftHandle;
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
  keypointNodeCount = 0,
  markPendingGeom,
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
        (prev ?? []).map((a) =>
          a.id === id ? { ...a, geometry: afterG as AnnotationResponse["geometry"] } : a,
        ),
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
      const tmpId = `tmp_${randomId()}`;
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
        render_key: tmpId,
      };
      setQ<AnnotationResponse[]>(["annotations", taskId], (prev) => [...(prev ?? []), optimistic]);
      s.setSelectedId(tmpId);
      history.push({ kind: "create", annotationId: tmpId, payload });
      enqueue({ kind: "create", id: randomId(), tmpId, taskId, payload, ts: Date.now() });
    },
    [taskId, projectId, meUserId, setQ, s, history],
  );

  // ── polygon / polyline 草稿（共用顶点累积 state）──────────────────────
  const [polygonDraftPoints, setPolygonDraftPoints] = useState<[number, number][]>([]);
  // 切到非 polygon/polyline 工具或切题清空草稿
  useEffect(() => {
    if (s.tool !== "polygon" && s.tool !== "polyline") setPolygonDraftPoints([]);
  }, [s.tool]);
  useEffect(() => {
    setPolygonDraftPoints([]);
  }, [taskId]);

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
        // v0.10.17 · 工具维度: polygon 工具归 region unit; 后端据此校验 class_name.
        tool_unit_id: toolUnitForTool(s.tool),
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
          pushToast({
            msg: "已创建多边形",
            sub: `${points.length} 顶点 · ${cls}`,
            kind: "success",
          });
        },
        onError: (err) => enqueueOnError(err, () => optimisticEnqueueCreate(payload)),
      });
    },
    [
      blockIfLocked,
      s,
      mutations,
      history,
      recordRecentClass,
      pushToast,
      enqueueOnError,
      optimisticEnqueueCreate,
    ],
  );

  const polygonHandle = useMemo<PolygonDraftHandle>(
    () => ({
      points: polygonDraftPoints,
      addPoint: (pt) => setPolygonDraftPoints((p) => [...p, pt]),
      close: () => submitPolygon(polygonDraftPoints),
      cancel: () => setPolygonDraftPoints([]),
      closed: true,
    }),
    [polygonDraftPoints, submitPolygon],
  );

  // ── polyline 提交 (v0.10.28) ──────────────────────────────────────
  const submitPolyline = useCallback(
    (points: [number, number][]) => {
      if (blockIfLocked()) return;
      const cls = s.activeClass;
      if (points.length < 2) {
        pushToast({ msg: "折线需至少 2 个顶点", kind: "warning" });
        return;
      }
      if (!cls) {
        pushToast({ msg: "请先选择类别", kind: "warning" });
        return;
      }
      const payload: AnnotationPayload = {
        annotation_type: "polyline",
        tool_unit_id: toolUnitForTool(s.tool),
        class_name: cls,
        geometry: { type: "polyline", points },
        confidence: 1,
      };
      setPolygonDraftPoints([]);
      mutations.create.mutate(payload, {
        onSuccess: (created) => {
          history.push({ kind: "create", annotationId: created.id, payload });
          s.setSelectedId(created.id);
          recordRecentClass(cls);
          pushToast({ msg: "已创建折线", sub: `${points.length} 顶点 · ${cls}`, kind: "success" });
        },
        onError: (err) => enqueueOnError(err, () => optimisticEnqueueCreate(payload)),
      });
    },
    [
      blockIfLocked,
      s,
      mutations,
      history,
      recordRecentClass,
      pushToast,
      enqueueOnError,
      optimisticEnqueueCreate,
    ],
  );

  const polylineHandle = useMemo<PolygonDraftHandle>(
    () => ({
      points: polygonDraftPoints,
      addPoint: (pt) => setPolygonDraftPoints((p) => [...p, pt]),
      close: () => submitPolyline(polygonDraftPoints),
      cancel: () => setPolygonDraftPoints([]),
      closed: false,
    }),
    [polygonDraftPoints, submitPolyline],
  );

  // ── v0.10.28 · keypoint 草稿 ──────────────────────────────────────────
  const [keypointDraftPoints, setKeypointDraftPoints] = useState<Keypoint[]>([]);
  useEffect(() => {
    if (s.tool !== "keypoint") setKeypointDraftPoints([]);
  }, [s.tool]);
  useEffect(() => {
    setKeypointDraftPoints([]);
  }, [taskId]);
  // schema 节点数变化 (切类别 → 不同 schema) 时清空半成品草稿。
  useEffect(() => {
    setKeypointDraftPoints([]);
  }, [keypointNodeCount]);

  const submitKeypoint = useCallback(
    (points: Keypoint[]) => {
      if (blockIfLocked()) return;
      const cls = s.activeClass;
      if (!cls) {
        pushToast({ msg: "请先选择类别", kind: "warning" });
        return;
      }
      if (points.length === 0) return;
      const payload: AnnotationPayload = {
        annotation_type: "keypoint",
        tool_unit_id: toolUnitForTool(s.tool),
        class_name: cls,
        geometry: keypointGeom(points),
        confidence: 1,
      };
      setKeypointDraftPoints([]);
      mutations.create.mutate(payload, {
        onSuccess: (created) => {
          history.push({ kind: "create", annotationId: created.id, payload });
          s.setSelectedId(created.id);
          recordRecentClass(cls);
          const visible = points.filter((p) => p.v > 0).length;
          pushToast({
            msg: "已创建关键点",
            sub: `${visible}/${points.length} 可见 · ${cls}`,
            kind: "success",
          });
        },
        onError: (err) => enqueueOnError(err, () => optimisticEnqueueCreate(payload)),
      });
    },
    [
      blockIfLocked,
      s,
      mutations,
      history,
      recordRecentClass,
      pushToast,
      enqueueOnError,
      optimisticEnqueueCreate,
    ],
  );

  // 放满 nodeCount 个点 → 自动提交一个实例。
  useEffect(() => {
    if (keypointNodeCount > 0 && keypointDraftPoints.length >= keypointNodeCount) {
      submitKeypoint(keypointDraftPoints.slice(0, keypointNodeCount));
    }
  }, [keypointDraftPoints, keypointNodeCount, submitKeypoint]);

  const keypointHandle = useMemo<KeypointDraftHandle>(
    () => ({
      points: keypointDraftPoints,
      nodeCount: keypointNodeCount,
      addPoint: (kp) => setKeypointDraftPoints((p) => [...p, kp]),
      cancel: () => setKeypointDraftPoints([]),
    }),
    [keypointDraftPoints, keypointNodeCount],
  );

  const handleCommitKeypointGeometry = useCallback(
    (id: string, before: Keypoint[], after: Keypoint[]) => {
      if (blockIfLocked()) return;
      if (!taskId) return;
      const beforeG = keypointGeom(before);
      const afterG = keypointGeom(after);
      const payload = { geometry: afterG };
      // v0.20.22 · 见 usePendingGeom: 同步 mark 目标几何以桥接一帧闪回。
      markPendingGeom?.(id, afterG);
      mutations.update.mutate(
        { annotationId: id, payload },
        {
          onSuccess: () => {
            history.push({
              kind: "update",
              annotationId: id,
              before: { geometry: beforeG },
              after: { geometry: afterG },
            });
          },
          onError: (err) =>
            enqueueOnError(err, () => {
              optimisticUpdateGeom(id, afterG);
              history.push({
                kind: "update",
                annotationId: id,
                before: { geometry: beforeG },
                after: { geometry: afterG },
              });
              enqueue({
                kind: "update",
                id: randomId(),
                taskId,
                annotationId: id,
                payload,
                ts: Date.now(),
              });
            }),
        },
      );
    },
    [
      blockIfLocked,
      mutations,
      history,
      taskId,
      enqueueOnError,
      optimisticUpdateGeom,
      markPendingGeom,
    ],
  );

  // ── handlers ───────────────────────────────────────────────────────

  const createBboxWithClass = useCallback(
    (geom: Geom, cls: string): boolean => {
      if (blockIfLocked()) return false;
      if (!cls) return false;
      const isUnknown = cls === UNKNOWN_CLASS;
      const payload: AnnotationPayload = {
        annotation_type: "bbox",
        // v0.10.17 · 工具维度: bbox / smart-box / magic-box 各自映射的 unit.
        tool_unit_id: toolUnitForTool(s.tool),
        class_name: cls,
        geometry: bboxGeom(geom),
        confidence: 1,
      };
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
      return true;
    },
    [
      blockIfLocked,
      s,
      mutations,
      history,
      recordRecentClass,
      enqueueOnError,
      optimisticEnqueueCreate,
    ],
  );

  // v0.10.28 · 旋转框: 轴对齐矩形 → angle=0 的 rotated_bbox。中心 = 矩形中点; 类别用 activeClass。
  const createRotatedBbox = useCallback(
    (geom: Geom): boolean => {
      if (blockIfLocked()) return false;
      const cls = s.activeClass;
      if (!cls) {
        pushToast({ msg: "请先选择类别", kind: "warning" });
        return false;
      }
      const geometry: RotatedBboxGeometry = {
        type: "rotated_bbox",
        cx: geom.x + geom.w / 2,
        cy: geom.y + geom.h / 2,
        w: geom.w,
        h: geom.h,
        angle: 0,
      };
      const payload: AnnotationPayload = {
        annotation_type: "rotated_bbox",
        tool_unit_id: toolUnitForTool(s.tool),
        class_name: cls,
        geometry,
        confidence: 1,
      };
      s.setActiveClass(cls);
      recordRecentClass(cls);
      mutations.create.mutate(payload, {
        onSuccess: (newAnnotation) => {
          s.setSelectedId(newAnnotation.id);
          history.push({ kind: "create", annotationId: newAnnotation.id, payload });
        },
        onError: (err) => enqueueOnError(err, () => optimisticEnqueueCreate(payload)),
      });
      return true;
    },
    [
      blockIfLocked,
      s,
      mutations,
      history,
      recordRecentClass,
      pushToast,
      enqueueOnError,
      optimisticEnqueueCreate,
    ],
  );

  // v0.10.28 · 旋转框: 旋转 / 缩放手柄落定时更新 rotated_bbox geometry。
  const handleCommitRotateBbox = useCallback(
    (id: string, before: RotatedBboxGeometry, after: RotatedBboxGeometry) => {
      if (blockIfLocked()) return;
      if (!taskId) return;
      if (
        before.cx === after.cx &&
        before.cy === after.cy &&
        before.w === after.w &&
        before.h === after.h &&
        before.angle === after.angle
      )
        return;
      const payload = { geometry: after };
      // v0.20.22 · 见 usePendingGeom。
      markPendingGeom?.(id, after);
      mutations.update.mutate(
        { annotationId: id, payload },
        {
          onSuccess: () => {
            history.push({
              kind: "update",
              annotationId: id,
              before: { geometry: before },
              after: { geometry: after },
            });
          },
          onError: (err) =>
            enqueueOnError(err, () => {
              optimisticUpdateGeom(id, after as unknown as Record<string, unknown>);
              history.push({
                kind: "update",
                annotationId: id,
                before: { geometry: before },
                after: { geometry: after },
              });
              enqueue({
                kind: "update",
                id: randomId(),
                taskId,
                annotationId: id,
                payload,
                ts: Date.now(),
              });
            }),
        },
      );
    },
    [
      blockIfLocked,
      mutations,
      history,
      taskId,
      enqueueOnError,
      optimisticUpdateGeom,
      markPendingGeom,
    ],
  );

  const handlePickPendingClass = useCallback(
    (cls: string) => {
      const pending = s.pendingDrawing;
      if (!pending || !cls) return;
      s.setPendingDrawing(null);
      createBboxWithClass(pending.geom, cls);
    },
    [s, createBboxWithClass],
  );

  const handleDeleteBox = useCallback(
    (id: string) => {
      if (blockIfLocked()) return;
      const target = annotationsRef.current.find((a) => a.id === id);
      if (target?.is_locked) {
        pushToast({ msg: "对象已锁定", sub: "请先解锁再删除", kind: "warning" });
        return;
      }
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
              enqueue({ kind: "delete", id: randomId(), taskId, annotationId: id, ts: Date.now() });
            }),
        });
      }
      s.setSelectedId(null);
    },
    [
      blockIfLocked,
      mutations,
      history,
      pushToast,
      s,
      taskId,
      enqueueOnError,
      optimisticDelete,
      annotationsRef,
    ],
  );

  const handleCommitMove = useCallback(
    (
      id: string,
      before: Geom,
      after: Geom,
      childMoves?: { id: string; before: Geometry; after: Geometry }[],
    ) => {
      if (blockIfLocked()) return;
      if (!taskId) return;
      const beforeG = bboxGeom(before);
      const afterG = bboxGeom(after);
      // v0.20.15 · Alt 拖父联动子: 父 + 子的几何更新作为一个 batch 命令进 history (单次 undo 全回退)。
      // 各更新独立 mutate; 失败走同款离线兜底 (乐观写 + enqueue), 但 history 只 pushBatch 一次 (不逐条 push)。
      if (childMoves && childMoves.length > 0) {
        history.pushBatch([
          {
            kind: "update",
            annotationId: id,
            before: { geometry: beforeG },
            after: { geometry: afterG },
          },
          ...childMoves.map((c) => ({
            kind: "update" as const,
            annotationId: c.id,
            before: { geometry: c.before },
            after: { geometry: c.after },
          })),
        ]);
        const fire = (annotationId: string, geometry: Geometry) => {
          const p = { geometry };
          // v0.20.22 · 见 usePendingGeom。
          markPendingGeom?.(annotationId, geometry);
          mutations.update.mutate(
            { annotationId, payload: p },
            {
              onError: (err) =>
                enqueueOnError(err, () => {
                  optimisticUpdateGeom(annotationId, geometry);
                  enqueue({
                    kind: "update",
                    id: randomId(),
                    taskId,
                    annotationId,
                    payload: p,
                    ts: Date.now(),
                  });
                }),
            },
          );
        };
        fire(id, afterG);
        for (const c of childMoves) fire(c.id, c.after);
        pushToast({ msg: `联动搬动 ${childMoves.length} 个子框`, kind: "" });
        return;
      }
      const payload = { geometry: afterG };
      // v0.20.22 · 见 usePendingGeom。
      markPendingGeom?.(id, afterG);
      mutations.update.mutate(
        { annotationId: id, payload },
        {
          onSuccess: () => {
            history.push({
              kind: "update",
              annotationId: id,
              before: { geometry: beforeG },
              after: { geometry: afterG },
            });
          },
          onError: (err) =>
            enqueueOnError(err, () => {
              optimisticUpdateGeom(id, afterG);
              history.push({
                kind: "update",
                annotationId: id,
                before: { geometry: beforeG },
                after: { geometry: afterG },
              });
              enqueue({
                kind: "update",
                id: randomId(),
                taskId,
                annotationId: id,
                payload,
                ts: Date.now(),
              });
            }),
        },
      );
    },
    [
      blockIfLocked,
      mutations,
      history,
      taskId,
      enqueueOnError,
      optimisticUpdateGeom,
      pushToast,
      markPendingGeom,
    ],
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
      // v0.20.22 · 见 usePendingGeom。
      markPendingGeom?.(id, afterG);
      mutations.update.mutate(
        { annotationId: id, payload },
        {
          onSuccess: () => {
            history.push({
              kind: "update",
              annotationId: id,
              before: { geometry: beforeG },
              after: { geometry: afterG },
            });
          },
          onError: (err) =>
            enqueueOnError(err, () => {
              optimisticUpdateGeom(id, afterG);
              history.push({
                kind: "update",
                annotationId: id,
                before: { geometry: beforeG },
                after: { geometry: afterG },
              });
              enqueue({
                kind: "update",
                id: randomId(),
                taskId,
                annotationId: id,
                payload,
                ts: Date.now(),
              });
            }),
        },
      );
    },
    [
      blockIfLocked,
      mutations,
      history,
      pushToast,
      taskId,
      enqueueOnError,
      optimisticUpdateGeom,
      markPendingGeom,
    ],
  );

  const handleCommitPolygonGeometry = useCallback(
    (id: string, before: Pt[], after: Pt[]) => {
      if (blockIfLocked()) return;
      const target = annotationsRef.current.find((a) => a.id === id);
      if (isComplexPolygonGeometry(target?.geometry)) {
        pushToast({
          msg: "复杂多边形暂不支持直接编辑",
          sub: "已保留全部外环与内环，未提交本次变更",
          kind: "warning",
        });
        return;
      }
      // v0.10.28 · 折线 (polyline) 复用同一顶点编辑路径，但不闭合 → 跳过 polygon 专属校验。
      const isPolyline = target?.geometry.type === "polyline";
      if (isPolyline) {
        if (after.length < 2) {
          pushToast({ msg: "折线至少需要 2 顶点", kind: "error" });
          return;
        }
      } else {
        if (after.length < 3) {
          pushToast({ msg: "多边形至少需要 3 顶点", kind: "error" });
          return;
        }
        if (!isSelfIntersecting(after).ok) {
          pushToast({ msg: "多边形自相交，已撤销", kind: "error" });
          return;
        }
      }
      if (!taskId) return;
      const beforeG = isPolyline ? polylineGeom(before) : polygonGeom(before);
      const afterG = isPolyline ? polylineGeom(after) : polygonGeom(after);
      const payload = { geometry: afterG };
      // v0.20.22 · 见 usePendingGeom。
      markPendingGeom?.(id, afterG);
      mutations.update.mutate(
        { annotationId: id, payload },
        {
          onSuccess: () => {
            history.push({
              kind: "update",
              annotationId: id,
              before: { geometry: beforeG },
              after: { geometry: afterG },
            });
          },
          onError: (err) =>
            enqueueOnError(err, () => {
              optimisticUpdateGeom(id, afterG);
              history.push({
                kind: "update",
                annotationId: id,
                before: { geometry: beforeG },
                after: { geometry: afterG },
              });
              enqueue({
                kind: "update",
                id: randomId(),
                taskId,
                annotationId: id,
                payload,
                ts: Date.now(),
              });
            }),
        },
      );
    },
    [
      blockIfLocked,
      mutations,
      history,
      pushToast,
      taskId,
      enqueueOnError,
      optimisticUpdateGeom,
      annotationsRef,
      markPendingGeom,
    ],
  );

  // v0.10.5 M4-β · I15 shape 状态位字段级 PATCH。
  // `flag` ∈ { z_order, is_locked, is_hidden }；value 直传。
  // 失败时仍 enqueue 离线 op（与 handleCommitMove 一致）。
  const handlePatchShapeFlag = useCallback(
    (id: string, flag: "z_order" | "is_locked" | "is_hidden", value: number | boolean) => {
      if (blockIfLocked()) return;
      if (!taskId) return;
      const target = annotationsRef.current.find((a) => a.id === id);
      const before = target ? (target as unknown as Record<string, unknown>)[flag] : undefined;
      const payload = { [flag]: value } as AnnotationUpdatePayload;
      mutations.update.mutate(
        { annotationId: id, payload },
        {
          onSuccess: () => {
            history.push({
              kind: "update",
              annotationId: id,
              before: { [flag]: before } as AnnotationUpdatePayload,
              after: payload,
            });
          },
          onError: (err) =>
            enqueueOnError(err, () => {
              history.push({
                kind: "update",
                annotationId: id,
                before: { [flag]: before } as AnnotationUpdatePayload,
                after: payload,
              });
              enqueue({
                kind: "update",
                id: randomId(),
                taskId,
                annotationId: id,
                payload,
                ts: Date.now(),
              });
            }),
        },
      );
    },
    [blockIfLocked, mutations, history, taskId, enqueueOnError, annotationsRef],
  );

  return {
    optimisticEnqueueCreate,
    createBboxWithClass,
    createRotatedBbox,
    handleCommitRotateBbox,
    handlePickPendingClass,
    submitPolygon,
    submitPolyline,
    handleDeleteBox,
    handleCommitMove,
    handleCommitResize,
    handleCommitPolygonGeometry,
    handleCommitKeypointGeometry,
    handlePatchShapeFlag,
    polygonDraftPoints,
    setPolygonDraftPoints,
    polygonHandle,
    polylineHandle,
    keypointHandle,
  };
}
