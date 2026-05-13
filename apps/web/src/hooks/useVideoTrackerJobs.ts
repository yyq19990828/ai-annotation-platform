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
    const status: VideoTrackerJobStatus = payload.status ?? mapEventToStatus(payload.type, cur.status);
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

    if (payload.type === "job_completed" || payload.type === "job_cancelled") {
      this.invalidateAnnotations(cur.taskId);
    }

    if (status === "completed" || status === "failed" || status === "cancelled") {
      this.scheduleTerminalCleanup(jobId);
    }
  }

  private scheduleTerminalCleanup(jobId: string): void {
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
    if (
      updated.status === "completed" ||
      updated.status === "failed" ||
      updated.status === "cancelled"
    ) {
      this.invalidateAnnotations(cur.taskId);
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
    case "job_completed":
      return "completed";
    case "job_failed":
      return "failed";
    case "job_cancelled":
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
