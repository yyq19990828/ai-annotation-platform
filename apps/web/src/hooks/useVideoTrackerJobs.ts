import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useQueryClient } from "@tanstack/react-query";

import {
  videoTrackerApi,
  type VideoTrackerJob,
  type VideoTrackerJobStatus,
} from "@/api/videoTracker";
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
  windowFrom?: number;
  windowTo?: number;
  windowProgress?: { current: number; total: number };
  errorMessage?: string | null;
  modelKey: string;
  receivedAt: number;
}

type Listener = (jobs: Record<string, VideoTrackerJobState>) => void;

class TrackerJobStore {
  private jobs: Record<string, VideoTrackerJobState> = {};
  private listeners = new Set<Listener>();
  private sockets = new Map<string, WebSocket>();
  private removeTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private invalidateAnnotations: (taskId: string) => void = () => {};

  setAnnotationInvalidator(fn: (taskId: string) => void): void {
    this.invalidateAnnotations = fn;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.jobs);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(): void {
    for (const fn of this.listeners) fn(this.jobs);
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
    this.connect(job.id, token);
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
    let payload: { type?: string; status?: VideoTrackerJobStatus; error_message?: string; window?: { from?: number; to?: number; index?: number; total?: number } } | null = null;
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
    const status: VideoTrackerJobStatus = payload.status ?? mapEventToStatus(payload.type, cur.status);
    const next: VideoTrackerJobState = {
      ...cur,
      status,
      errorMessage: payload.error_message ?? cur.errorMessage,
      receivedAt: Date.now(),
    };
    if (payload.window) {
      next.windowFrom = payload.window.from ?? next.windowFrom;
      next.windowTo = payload.window.to ?? next.windowTo;
      if (typeof payload.window.index === "number" && typeof payload.window.total === "number") {
        next.windowProgress = { current: payload.window.index, total: payload.window.total };
      }
    }
    this.jobs = { ...this.jobs, [jobId]: next };
    this.emit();

    if (payload.type === "job.window_completed" || payload.type === "job.completed") {
      this.invalidateAnnotations(cur.taskId);
    }

    if (status === "completed" || status === "failed" || status === "cancelled") {
      const timer = this.removeTimers.get(jobId);
      if (timer) clearTimeout(timer);
      this.removeTimers.set(
        jobId,
        setTimeout(() => {
          const { [jobId]: _drop, ...rest } = this.jobs;
          this.jobs = rest;
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
  }

  async cancel(jobId: string): Promise<void> {
    await videoTrackerApi.cancel(jobId).catch(() => undefined);
  }
}

function mapEventToStatus(
  type: string | undefined,
  prev: VideoTrackerJobStatus,
): VideoTrackerJobStatus {
  switch (type) {
    case "job.queued":
      return "queued";
    case "job.started":
    case "job.window_started":
    case "job.window_progress":
    case "job.window_completed":
      return "running";
    case "job.completed":
      return "completed";
    case "job.failed":
      return "failed";
    case "job.cancelled":
      return "cancelled";
    default:
      return prev;
  }
}

const trackerStore = new TrackerJobStore();

export function useVideoTrackerJobs() {
  const token = useAuthStore((s) => s.token);
  const qc = useQueryClient();
  const [jobs, setJobs] = useState<Record<string, VideoTrackerJobState>>({});

  useEffect(() => {
    trackerStore.setAnnotationInvalidator((taskId: string) => {
      qc.invalidateQueries({ queryKey: ["annotations", taskId] });
    });
  }, [qc]);

  useEffect(() => trackerStore.subscribe(setJobs), []);

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

  return { jobs, byAnnotation, propagate, cancel };
}
