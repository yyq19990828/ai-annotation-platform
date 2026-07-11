import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useQueryClient } from "@tanstack/react-query";

import {
  videoTrackerApi,
  type VideoTrackerJob,
  type VideoTrackerJobPreview,
  type VideoTrackerJobStatus,
} from "@/api/videoTracker";
import { ApiError } from "@/api/client";
import { useToastStore } from "@/components/ui";
import { buildWsUrl } from "@/lib/wsHost";
import { useAuthStore } from "@/stores/authStore";

const REMOVE_AFTER_DONE_MS = 1500;

export interface VideoTrackerJobState {
  jobId: string;
  taskId: string;
  annotationId: string;
  status: VideoTrackerJobStatus;
  fromFrame: number;
  toFrame: number;
  windowProgress?: { current: number; total: number };
  errorMessage?: string | null;
  modelKey: string;
  receivedAt: number;
}

// v0.21.28 · 候选/接受流: 追踪完成 (pending_review) 拉出的暂存预览, 供画布叠加 + 接受/丢弃。
export interface TrackerStoreState {
  jobs: Record<string, VideoTrackerJobState>;
  candidates: Record<string, VideoTrackerJobPreview>;
  submitting: Record<string, boolean>;
}

type Listener = (state: TrackerStoreState) => void;

export class TrackerJobStore {
  private jobs: Record<string, VideoTrackerJobState> = {};
  private candidates: Record<string, VideoTrackerJobPreview> = {};
  private submitting: Record<string, boolean> = {};
  private listeners = new Set<Listener>();
  private sockets = new Map<string, WebSocket>();
  private removeTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private hydrationTasks = new Map<string, Promise<void>>();
  private invalidateAnnotations: (taskId: string) => void = () => {};

  setAnnotationInvalidator(fn: (taskId: string) => void): void {
    this.invalidateAnnotations = fn;
  }

  private snapshot(): TrackerStoreState {
    return { jobs: this.jobs, candidates: this.candidates, submitting: this.submitting };
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(): void {
    const s = this.snapshot();
    for (const fn of this.listeners) fn(s);
  }

  addJob(job: VideoTrackerJob, token: string): void {
    const state: VideoTrackerJobState = {
      jobId: job.id,
      taskId: job.task_id,
      annotationId: job.annotation_id,
      status: job.status,
      fromFrame: job.from_frame,
      toFrame: job.to_frame,
      modelKey: job.model_key,
      errorMessage: job.error_message,
      receivedAt: Date.now(),
    };
    this.jobs = { ...this.jobs, [job.id]: state };
    this.emit();
    useToastStore.getState().push({
      msg: "AI 追踪已开始",
      sub: `${job.model_key} · F${job.from_frame}-F${job.to_frame}`,
      kind: "",
    });
    this.connect(job.id, token);
  }

  /** 从服务端恢复刷新前已进入候选审阅态的任务。并发调用按 task 去重。 */
  restoreReviewable(taskId: string): Promise<void> {
    const pending = this.hydrationTasks.get(taskId);
    if (pending) return pending;
    const hydration = this.loadReviewable(taskId).finally(() => {
      this.hydrationTasks.delete(taskId);
    });
    this.hydrationTasks.set(taskId, hydration);
    return hydration;
  }

  private async loadReviewable(taskId: string): Promise<void> {
    let reviewable: VideoTrackerJob[];
    try {
      reviewable = await videoTrackerApi.reviewable(taskId);
    } catch {
      return;
    }
    const restored = await Promise.all(
      reviewable.map(async (job) => {
        try {
          const preview = await videoTrackerApi.preview(job.id);
          return preview.results?.length ? { job, preview } : null;
        } catch {
          return null;
        }
      }),
    );
    let jobs = this.jobs;
    let candidates = this.candidates;
    for (const entry of restored) {
      if (!entry) continue;
      const { job, preview } = entry;
      jobs = {
        ...jobs,
        [job.id]: {
          jobId: job.id,
          taskId: job.task_id,
          annotationId: job.annotation_id,
          status: job.status,
          fromFrame: job.from_frame,
          toFrame: job.to_frame,
          modelKey: job.model_key,
          errorMessage: job.error_message,
          receivedAt: Date.now(),
        },
      };
      candidates = { ...candidates, [job.id]: preview };
    }
    this.jobs = jobs;
    this.candidates = candidates;
    this.emit();
  }

  private connect(jobId: string, token: string): void {
    if (this.sockets.has(jobId)) return;
    const url = buildWsUrl(`/ws/video-tracker-jobs/${jobId}`, { token });
    let socket: WebSocket;
    try {
      socket = new WebSocket(url);
    } catch {
      return;
    }
    this.sockets.set(jobId, socket);
    socket.onmessage = (evt) => this.handleMessage(jobId, evt);
    socket.onclose = () => {
      this.sockets.delete(jobId);
    };
    socket.onerror = () => {
      try {
        socket.close();
      } catch {
        /* noop */
      }
    };
  }

  private handleMessage(jobId: string, evt: MessageEvent): void {
    let payload:
      | {
          type?: string;
          status?: VideoTrackerJobStatus;
          error_message?: string;
          current?: number;
          total?: number;
        }
      | null = null;
    try {
      const data = JSON.parse(evt.data);
      if (data?.type === "ping") return;
      payload = data;
    } catch {
      return;
    }
    if (!payload) return;
    const cur = this.jobs[jobId];
    if (!cur) return;
    const status: VideoTrackerJobStatus =
      payload.status ?? mapEventToStatus(payload.type, cur.status);
    const next: VideoTrackerJobState = {
      ...cur,
      status,
      errorMessage: payload.error_message ?? cur.errorMessage,
      receivedAt: Date.now(),
    };
    if (typeof payload.current === "number" && typeof payload.total === "number") {
      next.windowProgress = { current: payload.current, total: payload.total };
    }
    this.jobs = { ...this.jobs, [jobId]: next };
    this.emit();

    const range = `${cur.modelKey} · F${cur.fromFrame}-F${cur.toFrame}`;
    // v0.21.28 · 候选流: 完成/取消 = 结果暂存待审, 拉候选预览进候选态 (接受才落库), 不直接
    // invalidate; 失败无候选、直接清理。
    if (payload.type === "job_completed") {
      useToastStore.getState().push({ msg: "AI 追踪完成, 待接受", sub: range, kind: "success" });
      void this.enterReview(jobId);
    } else if (payload.type === "job_cancelled") {
      useToastStore.getState().push({ msg: "AI 追踪已取消 (部分结果待审)", sub: range, kind: "warning" });
      void this.enterReview(jobId);
    } else if (payload.type === "job_failed") {
      useToastStore.getState().push({
        msg: "AI 追踪失败",
        sub: payload.error_message ?? cur.errorMessage ?? range,
        kind: "error",
      });
      this.scheduleTerminalCleanup(jobId);
    }
  }

  /** 拉候选预览; 有暂存结果则进候选态 (等用户接受/丢弃), 无结果直接清理。 */
  private async enterReview(jobId: string): Promise<void> {
    try {
      const preview = await videoTrackerApi.preview(jobId);
      if (!preview.results || preview.results.length === 0) {
        this.scheduleTerminalCleanup(jobId);
        return;
      }
      this.candidates = { ...this.candidates, [jobId]: preview };
      this.emit();
    } catch {
      this.scheduleTerminalCleanup(jobId);
    }
  }

  private setSubmitting(jobId: string, on: boolean): void {
    if (on) {
      this.submitting = { ...this.submitting, [jobId]: true };
    } else {
      const { [jobId]: _drop, ...rest } = this.submitting;
      this.submitting = rest;
    }
    this.emit();
  }

  /** 接受/丢弃失败: 4xx (如 409 状态冲突) 全局拦截器不弹 toast, 这里显式提示并保留审阅条。 */
  private pushActionError(action: string, err: unknown): void {
    const status = err instanceof ApiError ? err.status : undefined;
    const detail =
      status === 409
        ? "候选状态已变化 (可能已被处理, 或源标注被删)"
        : err instanceof Error && err.message
          ? err.message
          : "请重试";
    useToastStore.getState().push({
      msg: `${action} AI 追踪候选失败: ${detail}`,
      sub: status ? `HTTP ${status}` : undefined,
      kind: "error",
    });
  }

  async accept(jobId: string): Promise<void> {
    const cur = this.jobs[jobId];
    this.setSubmitting(jobId, true);
    let updated: VideoTrackerJob;
    try {
      updated = await videoTrackerApi.accept(jobId);
    } catch (err) {
      this.pushActionError("接受", err);
      return;
    } finally {
      this.setSubmitting(jobId, false);
    }
    // 落库 → invalidate annotations 让结果可见; 清候选 + 清理。
    if (cur) this.invalidateAnnotations(cur.taskId);
    useToastStore.getState().push({ msg: "已接受 AI 追踪结果", kind: "success" });
    this.finishReview(jobId, updated.status);
  }

  async discard(jobId: string): Promise<void> {
    this.setSubmitting(jobId, true);
    let updated: VideoTrackerJob;
    try {
      updated = await videoTrackerApi.discard(jobId);
    } catch (err) {
      this.pushActionError("丢弃", err);
      return;
    } finally {
      this.setSubmitting(jobId, false);
    }
    useToastStore.getState().push({ msg: "已丢弃 AI 追踪候选", kind: "" });
    this.finishReview(jobId, updated.status);
  }

  private finishReview(jobId: string, status: VideoTrackerJobStatus): void {
    const { [jobId]: _dropCand, ...restCand } = this.candidates;
    this.candidates = restCand;
    const cur = this.jobs[jobId];
    if (cur) this.jobs = { ...this.jobs, [jobId]: { ...cur, status, receivedAt: Date.now() } };
    this.emit();
    this.scheduleTerminalCleanup(jobId);
  }

  private scheduleTerminalCleanup(jobId: string): void {
    const timer = this.removeTimers.get(jobId);
    if (timer) clearTimeout(timer);
    this.removeTimers.set(
      jobId,
      setTimeout(() => {
        const { [jobId]: _drop, ...rest } = this.jobs;
        this.jobs = rest;
        const { [jobId]: _dropCand, ...restCand } = this.candidates;
        this.candidates = restCand;
        this.removeTimers.delete(jobId);
        const sock = this.sockets.get(jobId);
        if (sock) {
          try {
            sock.close();
          } catch {
            /* noop */
          }
          this.sockets.delete(jobId);
        }
        this.emit();
      }, REMOVE_AFTER_DONE_MS),
    );
  }

  async cancel(jobId: string): Promise<void> {
    const updated = await videoTrackerApi.cancel(jobId).catch(() => undefined);
    if (!updated) return;
    const cur = this.jobs[jobId];
    if (!cur) return;
    this.jobs = {
      ...this.jobs,
      [jobId]: {
        ...cur,
        status: updated.status,
        errorMessage: updated.error_message ?? cur.errorMessage,
        receivedAt: Date.now(),
      },
    };
    this.emit();
    // v0.21.28 · 取消也暂存部分结果 → 进候选态待审 (而非直接落库)。
    if (updated.status === "cancelled") {
      void this.enterReview(jobId);
    } else if (updated.status === "failed") {
      this.scheduleTerminalCleanup(jobId);
    }
  }
}

function mapEventToStatus(
  type: string | undefined,
  prev: VideoTrackerJobStatus,
): VideoTrackerJobStatus {
  switch (type) {
    case "job_started":
    case "job_progress":
    case "frame_result":
      return "running";
    // v0.21.28 · 完成 = 暂存待审 (非直接 completed)。
    case "job_completed":
      return "pending_review";
    case "job_failed":
      return "failed";
    case "job_cancelled":
      return "cancelled";
    default:
      return prev;
  }
}

const trackerStore = new TrackerJobStore();

export function useVideoTrackerJobs(taskId?: string, enabled = true) {
  const token = useAuthStore((s) => s.token);
  const qc = useQueryClient();
  const [state, setState] = useState<TrackerStoreState>({ jobs: {}, candidates: {}, submitting: {} });

  useEffect(() => {
    trackerStore.setAnnotationInvalidator((taskId: string) => {
      qc.invalidateQueries({ queryKey: ["annotations", taskId] });
    });
  }, [qc]);

  useEffect(() => trackerStore.subscribe(setState), []);

  useEffect(() => {
    if (taskId && enabled) void trackerStore.restoreReviewable(taskId);
  }, [taskId, enabled]);

  const tokenRef = useRef(token);
  tokenRef.current = token;

  const propagate = useCallback(
    async (
      taskId: string,
      annotationId: string,
      payload: Parameters<typeof videoTrackerApi.propagate>[2],
    ) => {
      const job = await videoTrackerApi.propagate(taskId, annotationId, payload);
      if (tokenRef.current) trackerStore.addJob(job, tokenRef.current);
      return job;
    },
    [],
  );

  const cancel = useCallback((jobId: string) => trackerStore.cancel(jobId), []);
  const accept = useCallback((jobId: string) => trackerStore.accept(jobId), []);
  const discard = useCallback((jobId: string) => trackerStore.discard(jobId), []);

  const jobs = state.jobs;
  const candidates = state.candidates;
  const submitting = state.submitting;

  const byAnnotation = useMemo(() => {
    const map: Record<string, VideoTrackerJobState> = {};
    for (const job of Object.values(jobs)) {
      const existing = map[job.annotationId];
      if (!existing || existing.receivedAt < job.receivedAt) {
        map[job.annotationId] = job;
      }
    }
    return map;
  }, [jobs]);

  // v0.21.28 · 候选按 annotation 归并 (供画布/审阅条按当前选中轨迹取候选)。
  const candidateByAnnotation = useMemo(() => {
    const map: Record<string, VideoTrackerJobPreview> = {};
    for (const preview of Object.values(candidates)) {
      map[preview.annotation_id] = preview;
    }
    return map;
  }, [candidates]);

  return { jobs, byAnnotation, candidates, candidateByAnnotation, submitting, propagate, cancel, accept, discard };
}
