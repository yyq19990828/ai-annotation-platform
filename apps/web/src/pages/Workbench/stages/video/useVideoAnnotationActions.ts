import { useCallback } from "react";
import type { QueryClient } from "@tanstack/react-query";
import { ApiError } from "@/api/client";
import { tasksApi, type AnnotationPayload } from "@/api/tasks";
import type { AnnotationResponse, Geometry, VideoBboxGeometry, VideoTrackGeometry } from "@/types";
import { UNKNOWN_CLASS } from "../../stage/colors";
import { enqueue } from "../../state/offlineQueue";
import type { useAnnotationHistory, Command } from "../../state/useAnnotationHistory";
import type { PendingDrawing, useWorkbenchState } from "../../state/useWorkbenchState";
import { buildVideoKeyframeCommand } from "../../state/videoTrackCommands";

type Geom = { x: number; y: number; w: number; h: number };
type VideoGeometry = VideoBboxGeometry | VideoTrackGeometry;

interface ToastInput {
  msg: string;
  sub?: string;
  kind?: "success" | "warning" | "error" | "";
}

interface VideoAnnotationMutations {
  create: {
    mutate: (
      p: AnnotationPayload,
      opts?: { onSuccess?: (a: AnnotationResponse) => void; onError?: (e: unknown) => void },
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

interface UseVideoAnnotationActionsArgs {
  taskId: string | undefined;
  queryClient: QueryClient;
  history: ReturnType<typeof useAnnotationHistory>;
  s: ReturnType<typeof useWorkbenchState>;
  annotationsRef: { current: AnnotationResponse[] };
  pushToast: (toast: ToastInput) => void;
  recordRecentClass: (cls: string) => void;
  optimisticEnqueueCreate: (payload: AnnotationPayload) => void;
  enqueueOnError: (err: unknown, fallback: () => void) => void;
  mutations: VideoAnnotationMutations;
}

export interface VideoConvertOptions {
  operation: "copy" | "split";
  scope: "frame" | "track";
  frameIndex?: number;
  frameMode?: "keyframes" | "all_frames";
}

export interface VideoTrackCompositionOptions {
  operation: "aggregate_bboxes" | "split_track" | "merge_tracks";
  annotationIds: string[];
  frameIndex?: number;
  deleteSources?: boolean;
}

export function buildVideoCreatePayload(
  kind: "video_bbox" | "video_track",
  frameIndex: number,
  geo: Geom,
  cls: string,
): AnnotationPayload {
  const className = cls || UNKNOWN_CLASS;
  if (kind === "video_bbox") {
    return {
      annotation_type: "video_bbox",
      class_name: className,
      geometry: { type: "video_bbox", frame_index: frameIndex, ...geo },
    };
  }

  const trackId = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? `trk_${crypto.randomUUID()}`
    : `trk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const geometry: VideoTrackGeometry = {
    type: "video_track",
    track_id: trackId,
    keyframes: [
      {
        frame_index: frameIndex,
        bbox: geo,
        source: "manual",
        absent: false,
        occluded: false,
      },
    ],
  };

  return {
    annotation_type: "video_track",
    class_name: className,
    geometry,
  };
}

export function buildVideoUpdateCommand(ann: AnnotationResponse, geometry: VideoGeometry): Command {
  if (ann.geometry.type === "video_track" && geometry.type === "video_track") {
    const keyframeCommand = buildVideoKeyframeCommand(ann.id, ann.geometry, geometry);
    if (keyframeCommand) return keyframeCommand;
  }
  return { kind: "update", annotationId: ann.id, before: { geometry: ann.geometry }, after: { geometry } };
}

export function buildVideoCompositionCommands(
  beforeAnnotations: AnnotationResponse[],
  result: {
    updated_annotations: AnnotationResponse[];
    created_annotations: AnnotationResponse[];
    deleted_annotation_ids: string[];
  },
): Exclude<Command, { kind: "batch" }>[] {
  const beforeById = new Map(beforeAnnotations.map((ann) => [ann.id, ann]));
  const commands: Exclude<Command, { kind: "batch" }>[] = [];

  for (const updated of result.updated_annotations) {
    const before = beforeById.get(updated.id);
    if (!before) continue;
    commands.push({
      kind: "update",
      annotationId: updated.id,
      before: { geometry: before.geometry },
      after: { geometry: updated.geometry },
    });
  }

  for (const deletedId of result.deleted_annotation_ids) {
    const before = beforeById.get(deletedId);
    if (before) commands.push({ kind: "delete", annotation: before });
  }

  for (const created of result.created_annotations) {
    commands.push({
      kind: "create",
      annotationId: created.id,
      payload: {
        annotation_type: created.annotation_type,
        class_name: created.class_name,
        geometry: created.geometry,
        confidence: created.confidence ?? undefined,
        attributes: created.attributes,
      },
    });
  }

  return commands;
}

function isConflictError(err: unknown): boolean {
  return err instanceof ApiError && err.status === 409;
}

function isVideoPending(pending: PendingDrawing): pending is NonNullable<PendingDrawing> & {
  kind: "video_bbox" | "video_track";
} {
  return pending?.kind === "video_bbox" || pending?.kind === "video_track";
}

export function useVideoAnnotationActions({
  taskId,
  queryClient,
  history,
  s,
  annotationsRef,
  pushToast,
  recordRecentClass,
  optimisticEnqueueCreate,
  enqueueOnError,
  mutations,
}: UseVideoAnnotationActionsArgs) {
  const optimisticUpdateAnnotation = useCallback((annotationId: string, patch: { geometry?: Geometry; class_name?: string }) => {
    if (!taskId) return;
    queryClient.setQueryData<AnnotationResponse[]>(
      ["annotations", taskId],
      (prev) => (prev ?? []).map((a) => (a.id === annotationId ? { ...a, ...patch } : a)),
    );
  }, [queryClient, taskId]);

  const handleVideoCreateWithClass = useCallback((kind: "video_bbox" | "video_track", frameIndex: number, geo: Geom, cls: string) => {
    const payload = buildVideoCreatePayload(kind, frameIndex, geo, cls);
    const className = payload.class_name;
    mutations.create.mutate(payload, {
      onSuccess: (created) => {
        history.push({ kind: "create", annotationId: created.id, payload });
        if (className !== UNKNOWN_CLASS) {
          s.setActiveClass(className);
          recordRecentClass(className);
        }
        s.setSelectedId(created.id);
      },
      onError: (err) => enqueueOnError(err, () => optimisticEnqueueCreate(payload)),
    });
  }, [enqueueOnError, history, mutations.create, optimisticEnqueueCreate, recordRecentClass, s]);

  const handleVideoCreate = useCallback((frameIndex: number, geo: Geom) => {
    handleVideoCreateWithClass("video_track", frameIndex, geo, s.activeClass || UNKNOWN_CLASS);
  }, [handleVideoCreateWithClass, s.activeClass]);

  const handleVideoPendingDraw = useCallback((
    kind: "video_bbox" | "video_track",
    frameIndex: number,
    geom: Geom,
    anchor: { left: number; top: number },
  ) => {
    s.setPendingDrawing({ kind, frameIndex, geom, anchor });
  }, [s]);

  const handlePickVideoPendingClass = useCallback((cls: string): boolean => {
    const pending = s.pendingDrawing;
    if (!isVideoPending(pending)) return false;
    s.setPendingDrawing(null);
    handleVideoCreateWithClass(pending.kind, pending.frameIndex, pending.geom, cls);
    return true;
  }, [handleVideoCreateWithClass, s]);

  const handleVideoUpdate = useCallback((ann: AnnotationResponse, geometry: VideoGeometry) => {
    const after = { geometry };
    const command = buildVideoUpdateCommand(ann, geometry);
    mutations.update.mutate(
      { annotationId: ann.id, payload: after },
      {
        onSuccess: () => history.push(command),
        onError: (err) => {
          if (isConflictError(err)) return;
          enqueueOnError(err, () => {
            optimisticUpdateAnnotation(ann.id, { geometry });
            history.push(command);
            if (taskId) enqueue({ kind: "update", id: crypto.randomUUID(), taskId, annotationId: ann.id, payload: after, ts: Date.now() });
          });
        },
      },
    );
  }, [enqueueOnError, history, mutations.update, optimisticUpdateAnnotation, taskId]);

  const handleVideoRename = useCallback((ann: AnnotationResponse, className: string) => {
    const before = { class_name: ann.class_name };
    const after = { class_name: className };
    mutations.update.mutate(
      { annotationId: ann.id, payload: after },
      {
        onSuccess: () => history.push({ kind: "update", annotationId: ann.id, before, after }),
        onError: (err) => {
          if (isConflictError(err)) return;
          enqueueOnError(err, () => {
            optimisticUpdateAnnotation(ann.id, { class_name: className });
            history.push({ kind: "update", annotationId: ann.id, before, after });
            if (taskId) enqueue({ kind: "update", id: crypto.randomUUID(), taskId, annotationId: ann.id, payload: after, ts: Date.now() });
          });
        },
      },
    );
  }, [enqueueOnError, history, mutations.update, optimisticUpdateAnnotation, taskId]);

  const handleVideoBatchRename = useCallback((annotations: AnnotationResponse[], className: string) => {
    const targets = annotations.filter((ann) =>
      ann.geometry.type === "video_track" && ann.class_name !== className,
    );
    if (!className || targets.length === 0) return;

    let pending = targets.length;
    let succeeded = 0;
    let failed = 0;
    const commands: Extract<Command, { kind: "update" }>[] = [];

    targets.forEach((ann) => {
      const before = { class_name: ann.class_name };
      const after = { class_name: className };
      mutations.update.mutate(
        { annotationId: ann.id, payload: after },
        {
          onSuccess: () => {
            succeeded++;
            commands.push({ kind: "update", annotationId: ann.id, before, after });
          },
          onError: () => {
            failed++;
          },
          onSettled: () => {
            pending--;
            if (pending !== 0) return;
            if (commands.length > 0) history.pushBatch(commands);
            if (succeeded > 0) {
              s.setActiveClass(className);
              recordRecentClass(className);
            }
            pushToast({
              msg: `${succeeded} 条轨迹已改为 ${className}`,
              sub: failed ? `${failed} 项失败` : undefined,
              kind: failed ? "error" : "success",
            });
          },
        },
      );
    });
  }, [history, mutations.update, pushToast, recordRecentClass, s]);

  const handleVideoBatchDelete = useCallback((annotations: AnnotationResponse[]) => {
    const targets = annotations.filter((ann) => ann.geometry.type === "video_track");
    if (targets.length === 0) return;

    let pending = targets.length;
    let succeeded = 0;
    let failed = 0;
    const commands: Extract<Command, { kind: "delete" }>[] = [];

    targets.forEach((ann) => {
      mutations.delete.mutate(ann.id, {
        onSuccess: () => {
          succeeded++;
          commands.push({ kind: "delete", annotation: ann });
        },
        onError: () => {
          failed++;
        },
        onSettled: () => {
          pending--;
          if (pending !== 0) return;
          if (commands.length > 0) history.pushBatch(commands);
          pushToast({
            msg: `已删除 ${succeeded}/${targets.length} 条轨迹`,
            sub: failed ? `${failed} 项失败` : undefined,
            kind: failed ? "error" : "success",
          });
          s.setSelectedId(null);
        },
      });
    });
  }, [history, mutations.delete, pushToast, s]);

  const handleVideoSetSelectedClass = useCallback((className: string) => {
    if (!s.selectedId) return false;
    const ann = annotationsRef.current.find((a) => a.id === s.selectedId);
    if (!ann || (ann.geometry.type !== "video_bbox" && ann.geometry.type !== "video_track")) return false;
    if (ann.class_name === className) return true;
    handleVideoRename(ann, className);
    recordRecentClass(className);
    return true;
  }, [annotationsRef, handleVideoRename, recordRecentClass, s.selectedId]);

  const handleVideoConvertToBboxes = useCallback(async (
    ann: AnnotationResponse,
    options: VideoConvertOptions,
  ) => {
    if (!taskId || ann.geometry.type !== "video_track") return;
    if (options.frameMode === "all_frames") {
      const ok = window.confirm("将按插值结果展开所有可见帧，长视频可能生成大量独立框。继续？");
      if (!ok) return;
    }
    try {
      const result = await tasksApi.convertVideoTrackToBboxes(taskId, ann.id, {
        operation: options.operation,
        scope: options.scope,
        frame_index: options.frameIndex,
        frame_mode: options.frameMode ?? "keyframes",
      });
      queryClient.setQueryData<AnnotationResponse[]>(["annotations", taskId], (prev) => {
        const base = (prev ?? []).filter((item) => !result.created_annotations.some((created) => created.id === item.id));
        const withoutSource = result.deleted_source ? base.filter((item) => item.id !== ann.id) : base;
        const updatedSource = result.source_annotation
          ? withoutSource.map((item) => (item.id === ann.id ? result.source_annotation! : item))
          : withoutSource;
        return [...updatedSource, ...result.created_annotations];
      });
      const commands: Exclude<Command, { kind: "batch" }>[] = result.created_annotations.map((created) => ({
        kind: "create",
        annotationId: created.id,
        payload: {
          annotation_type: created.annotation_type,
          class_name: created.class_name,
          geometry: created.geometry,
          confidence: created.confidence ?? undefined,
          attributes: created.attributes,
        },
      }));
      if (result.deleted_source) {
        commands.push({ kind: "delete", annotation: ann });
        s.setSelectedId(null);
      } else if (result.source_annotation && result.source_annotation.geometry.type === "video_track") {
        commands.push({
          kind: "update",
          annotationId: ann.id,
          before: { geometry: ann.geometry },
          after: { geometry: result.source_annotation.geometry },
        });
        s.setSelectedId(result.source_annotation.id);
      }
      history.pushBatch(commands);
      pushToast({ msg: `已生成 ${result.created_annotations.length} 个独立框`, kind: "success" });
    } catch (err) {
      pushToast({ msg: "轨迹转换失败", sub: String(err), kind: "error" });
    }
  }, [history, pushToast, queryClient, s, taskId]);

  const handleVideoComposeTracks = useCallback(async (options: VideoTrackCompositionOptions) => {
    if (!taskId || options.annotationIds.length === 0) return;
    const before = annotationsRef.current.filter((ann) => options.annotationIds.includes(ann.id));
    try {
      const result = await tasksApi.composeVideoTracks(taskId, {
        operation: options.operation,
        annotation_ids: options.annotationIds,
        frame_index: options.frameIndex,
        delete_sources: options.deleteSources,
      });
      queryClient.setQueryData<AnnotationResponse[]>(["annotations", taskId], (prev) => {
        const deleted = new Set(result.deleted_annotation_ids);
        const updatedById = new Map(result.updated_annotations.map((ann) => [ann.id, ann]));
        const createdIds = new Set(result.created_annotations.map((ann) => ann.id));
        const kept = (prev ?? [])
          .filter((ann) => !deleted.has(ann.id) && !createdIds.has(ann.id))
          .map((ann) => updatedById.get(ann.id) ?? ann);
        const present = new Set(kept.map((ann) => ann.id));
        return [
          ...kept,
          ...result.updated_annotations.filter((ann) => !present.has(ann.id)),
          ...result.created_annotations,
        ];
      });
      history.pushBatch(buildVideoCompositionCommands(before, result));
      const nextSelected = result.created_annotations[0]?.id
        ?? result.updated_annotations[0]?.id
        ?? null;
      s.setSelectedId(nextSelected);
      const label = options.operation === "aggregate_bboxes"
        ? "已聚合为轨迹"
        : options.operation === "split_track"
          ? "轨迹已拆分"
          : "轨迹已合并";
      pushToast({ msg: label, kind: "success" });
    } catch (err) {
      pushToast({ msg: "轨迹组合失败", sub: String(err), kind: "error" });
    }
  }, [annotationsRef, history, pushToast, queryClient, s, taskId]);

  return {
    handleVideoCreate,
    handleVideoPendingDraw,
    handlePickVideoPendingClass,
    handleVideoUpdate,
    handleVideoRename,
    handleVideoBatchRename,
    handleVideoBatchDelete,
    handleVideoSetSelectedClass,
    handleVideoConvertToBboxes,
    handleVideoComposeTracks,
  };
}
