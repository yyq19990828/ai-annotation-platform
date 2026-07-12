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
  // 当前工作台聚焦的 task。切任务时用它把不属于当前 task 的 job/candidate/socket/timer
  // 清掉 (见 scopeToTask), 并作为异步恢复的护栏 (恢复回来发现已切走就丢弃)。
  private currentTaskId: string | null = null;
  // restoreReviewable 已成功拉取过 reviewable/active 数据的 task id。切任务时清空 (见
  // restoreReviewable 顶部); 同一 task 内重复调用 (例如 token 从 null 变为有值后 effect 重跑)
  // 靠它跳过重复拉数据, 只补连尚未连接的 socket。
  private hydratedTaskId: string | null = null;
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
    this.currentTaskId = job.task_id;
    this.jobs = { ...this.jobs, [job.id]: toJobState(job) };
    this.emit();
    useToastStore.getState().push({
      msg: "AI 追踪已开始",
      sub: `${job.model_key} · F${job.from_frame}-F${job.to_frame}`,
      kind: "",
    });
    this.connect(job.id, token);
  }

  /**
   * 从服务端恢复刷新前的会话态: 仍待审阅的候选 + 仍在运行的追踪任务 (重连 WS)。
   * 单例 store 跨 task 复用, 切 task 时先把上一个 task 的残留清干净, 再按 task 去重恢复。
   */
  restoreReviewable(taskId: string, token?: string | null): Promise<void> {
    // 切 task: 先 scope 清理 (关旧 socket / 清旧 timer), 避免旧任务的完成 Toast 或候选
    // 借同名 annotation 浮到新任务上。
    if (this.currentTaskId !== taskId) {
      this.currentTaskId = taskId;
      this.scopeToTask(taskId);
      this.hydratedTaskId = null;
    }
    const pending = this.hydrationTasks.get(taskId);
    if (pending) {
      // 拉取仍在飞行中: 待其结束后再补连 (届时 token 若已就绪, connectActiveJobs 是幂等的)。
      if (token) void pending.then(() => this.connectActiveJobs(taskId, token));
      return pending;
    }
    if (this.hydratedTaskId === taskId) {
      // 本 task 已经拉取过一轮: 只是 token 从 null 变为有值 (如刷新后 auth store 延迟 hydrate)。
      // 不重新拉数据 (避免抖动), 只对 jobs 里仍是 queued/running 但还没连上 socket 的补连。
      if (token) this.connectActiveJobs(taskId, token);
      return Promise.resolve();
    }
    const hydration = this.loadReviewable(taskId, token).finally(() => {
      this.hydrationTasks.delete(taskId);
      if (this.currentTaskId === taskId) this.hydratedTaskId = taskId;
    });
    this.hydrationTasks.set(taskId, hydration);
    return hydration;
  }

  /** 关闭并清掉不属于 taskId 的 job/candidate/submitting/socket/timer。同 task 的活跃 job 保留。 */
  private scopeToTask(taskId: string): void {
    const keptJobs: Record<string, VideoTrackerJobState> = {};
    for (const [jobId, job] of Object.entries(this.jobs)) {
      if (job.taskId === taskId) keptJobs[jobId] = job;
    }
    // candidates / submitting 以 jobId 为键, 其归属经 jobs[jobId].taskId 反查 —— 只保留仍在 keptJobs 里的。
    const keptCandidates: Record<string, VideoTrackerJobPreview> = {};
    for (const [jobId, preview] of Object.entries(this.candidates)) {
      if (keptJobs[jobId]) keptCandidates[jobId] = preview;
    }
    const keptSubmitting: Record<string, boolean> = {};
    for (const [jobId, on] of Object.entries(this.submitting)) {
      if (keptJobs[jobId]) keptSubmitting[jobId] = on;
    }
    // 关掉 / 清掉不再保留的 job 对应的 socket 与 timer, 避免泄漏与旧任务的迟到消息。
    for (const [jobId, socket] of this.sockets) {
      if (!keptJobs[jobId]) {
        try {
          socket.close();
        } catch {
          /* noop */
        }
        this.sockets.delete(jobId);
      }
    }
    for (const [jobId, timer] of this.removeTimers) {
      if (!keptJobs[jobId]) {
        clearTimeout(timer);
        this.removeTimers.delete(jobId);
      }
    }
    const changed =
      Object.keys(keptJobs).length !== Object.keys(this.jobs).length ||
      Object.keys(keptCandidates).length !== Object.keys(this.candidates).length ||
      Object.keys(keptSubmitting).length !== Object.keys(this.submitting).length;
    if (!changed) return;
    this.jobs = keptJobs;
    this.candidates = keptCandidates;
    this.submitting = keptSubmitting;
    this.emit();
  }

  private async loadReviewable(taskId: string, token?: string | null): Promise<void> {
    // 候选 (pending_review / cancelled+staged) 与运行中 (queued/running) 任务分别拉取;
    // 任一失败都不阻断另一路。
    let reviewable: VideoTrackerJob[] = [];
    try {
      reviewable = (await videoTrackerApi.reviewable(taskId)) ?? [];
    } catch {
      reviewable = [];
    }
    let active: VideoTrackerJob[] = [];
    try {
      active = (await videoTrackerApi.active(taskId)) ?? [];
    } catch {
      active = [];
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
    // 护栏: 恢复期间用户已切走 task → 丢弃这批结果, 别把旧任务塞回来 (scopeToTask 会用当前 task 兜底)。
    if (this.currentTaskId !== taskId) return;
    let jobs = this.jobs;
    let candidates = this.candidates;
    for (const entry of restored) {
      if (!entry) continue;
      const { job, preview } = entry;
      jobs = { ...jobs, [job.id]: toJobState(job) };
      candidates = { ...candidates, [job.id]: preview };
    }
    // 运行中任务: 恢复到 UI 并重连 WS, 让刷新后仍能收进度 / 完成时冒候选。
    for (const job of active) {
      jobs = { ...jobs, [job.id]: toJobState(job) };
    }
    this.jobs = jobs;
    this.candidates = candidates;
    this.emit();
    if (token) {
      for (const job of active) this.connect(job.id, token);
    }
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

  /** 对 taskId 下仍是 queued/running 的 job 补连 socket; connect() 内部按 jobId 判重, 已连的会跳过。 */
  private connectActiveJobs(taskId: string, token: string): void {
    for (const job of Object.values(this.jobs)) {
      if (job.taskId === taskId && (job.status === "queued" || job.status === "running")) {
        this.connect(job.jobId, token);
      }
    }
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
    const jobTaskId = this.jobs[jobId]?.taskId;
    try {
      const preview = await videoTrackerApi.preview(jobId);
      if (!preview.results || preview.results.length === 0) {
        this.scheduleTerminalCleanup(jobId);
        return;
      }
      // 护栏: preview 请求飞行中用户已切走 task (scopeToTask 会把该 job 从 jobs 里剔除) →
      // 丢弃这次写入, 避免孤儿候选挂到新任务上。
      if (this.currentTaskId !== jobTaskId) return;
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

function toJobState(job: VideoTrackerJob): VideoTrackerJobState {
  return {
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

  const tokenRef = useRef(token);
  tokenRef.current = token;

  useEffect(() => {
    // 传 token 让恢复顺带重连运行中任务的 WS (刷新后仍能收进度 / 完成时冒候选)。token 进依赖:
    // 刷新时 auth store 可能还没 hydrate (token=null), effect 先跑一轮拉数据但因无 token 连不上
    // socket; token 就位后这里重跑, restoreReviewable 内部会跳过重复拉数据、只补连 socket。
    if (taskId && enabled) void trackerStore.restoreReviewable(taskId, token);
  }, [taskId, enabled, token]);

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
