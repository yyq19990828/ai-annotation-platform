import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { asyncJobsApi, type AsyncJob, type CrossFrameJobCreate } from "@/api/asyncJobs";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { useToastStore } from "@/components/ui/Toast";

import { TrackOperationsPanel } from "./TrackOperationsPanel";

interface CrossFrameJobCenterProps {
  open: boolean;
  onClose: () => void;
  taskId: string;
  currentFrame: number;
  sceneStartFrame: number;
  sceneEndFrame: number;
  selectedAnnotationIds: string[];
  selectedTrackId: string | null;
  boxCount: number;
  readOnly: boolean;
}

type Scope = "selected" | "all";
type Direction = "forward" | "backward";
type CenterView = "propagate" | "track";

const STATUS_LABEL: Record<AsyncJob["status"], string> = {
  pending: "排队中",
  running: "运行中",
  completed: "已完成",
  failed: "需处理",
  cancelled: "已取消",
};

function numberField(source: Record<string, unknown>, key: string): number {
  return typeof source[key] === "number" ? source[key] : 0;
}

function frameRange(job: AsyncJob): string {
  const start = numberField(job.payload, "start_frame");
  const end = numberField(job.payload, "end_frame");
  return `F${start}–F${end}`;
}

function jobSummary(job: AsyncJob): string {
  const result = job.result;
  if (!result || Object.keys(result).length === 0) return "等待执行";
  return [
    `成功 ${numberField(result, "success_count")}`,
    `跳过 ${numberField(result, "skipped_count")}`,
    `失败 ${numberField(result, "failed_count")}`,
    `过期 ${numberField(result, "stale_count")}`,
  ].join(" · ");
}

function hasRetryableFrames(job: AsyncJob): boolean {
  return numberField(job.result, "failed_count") > 0 || numberField(job.result, "stale_count") > 0;
}

function terminal(job: AsyncJob): boolean {
  return job.status === "completed" || job.status === "failed" || job.status === "cancelled";
}

export function CrossFrameJobCenter({
  open,
  onClose,
  taskId,
  currentFrame,
  sceneStartFrame,
  sceneEndFrame,
  selectedAnnotationIds,
  selectedTrackId,
  boxCount,
  readOnly,
}: CrossFrameJobCenterProps) {
  const queryClient = useQueryClient();
  const pushToast = useToastStore((state) => state.push);
  const defaultDirection: Direction = currentFrame < sceneEndFrame ? "forward" : "backward";
  const [scope, setScope] = useState<Scope>(selectedAnnotationIds.length > 0 ? "selected" : "all");
  const [view, setView] = useState<CenterView>("propagate");
  const [direction, setDirection] = useState<Direction>(defaultDirection);
  const [targetEnd, setTargetEnd] = useState(() =>
    defaultDirection === "forward"
      ? Math.min(sceneEndFrame, currentFrame + 10)
      : Math.max(sceneStartFrame, currentFrame - 10),
  );
  const observedTerminalRef = useRef(new Set<string>());

  useEffect(() => {
    if (!open) return;
    const nextDirection: Direction = currentFrame < sceneEndFrame ? "forward" : "backward";
    setDirection(nextDirection);
    setTargetEnd(
      nextDirection === "forward"
        ? Math.min(sceneEndFrame, currentFrame + 10)
        : Math.max(sceneStartFrame, currentFrame - 10),
    );
    setScope(selectedAnnotationIds.length > 0 ? "selected" : "all");
  }, [currentFrame, open, sceneEndFrame, sceneStartFrame, selectedAnnotationIds.length]);

  const jobsQuery = useQuery({
    queryKey: ["async-jobs", "point-cloud-cross-frame", taskId],
    queryFn: () => asyncJobsApi.listCrossFrame(taskId),
    enabled: open,
    refetchInterval: open ? 1500 : false,
  });
  const jobs = useMemo(() => jobsQuery.data?.items ?? [], [jobsQuery.data?.items]);

  useEffect(() => {
    for (const job of jobs) {
      if (!terminal(job) || observedTerminalRef.current.has(job.id)) continue;
      observedTerminalRef.current.add(job.id);
      queryClient.invalidateQueries({ queryKey: ["annotations"] });
      queryClient.invalidateQueries({ queryKey: ["scene-timeline"] });
    }
  }, [jobs, queryClient]);

  const refreshJobs = () => {
    queryClient.invalidateQueries({
      queryKey: ["async-jobs", "point-cloud-cross-frame"],
    });
  };
  const createMutation = useMutation({
    mutationFn: (body: CrossFrameJobCreate) => asyncJobsApi.createCrossFrame(taskId, body),
    onSuccess: () => {
      refreshJobs();
      pushToast({ msg: "跨帧任务已加入队列", kind: "success" });
    },
    onError: () => pushToast({ msg: "跨帧任务启动失败", kind: "error" }),
  });
  const cancelMutation = useMutation({
    mutationFn: (jobId: string) => asyncJobsApi.cancel(jobId),
    onSuccess: refreshJobs,
    onError: () => pushToast({ msg: "取消任务失败", kind: "error" }),
  });
  const retryMutation = useMutation({
    mutationFn: (jobId: string) => asyncJobsApi.retryCrossFrame(taskId, jobId),
    onSuccess: () => {
      refreshJobs();
      pushToast({ msg: "失败帧已重新入队", kind: "success" });
    },
    onError: () => pushToast({ msg: "失败帧重试失败", kind: "error" }),
  });

  const range = useMemo(() => {
    if (direction === "forward") {
      return { start: currentFrame + 1, end: targetEnd, count: targetEnd - currentFrame };
    }
    return { start: targetEnd, end: currentFrame - 1, count: currentFrame - targetEnd };
  }, [currentFrame, direction, targetEnd]);
  const targetValid =
    range.count >= 1 &&
    range.count <= 100 &&
    range.start >= sceneStartFrame &&
    range.end <= sceneEndFrame;
  const sourceCount = scope === "all" ? boxCount : selectedAnnotationIds.length;
  const scopeValid = sourceCount > 0 && sourceCount <= 500;
  const canStart = !readOnly && targetValid && scopeValid && !createMutation.isPending;

  const setNextDirection = (next: Direction) => {
    setDirection(next);
    setTargetEnd(
      next === "forward"
        ? Math.min(sceneEndFrame, currentFrame + 10)
        : Math.max(sceneStartFrame, currentFrame - 10),
    );
  };
  const start = () => {
    if (!canStart) return;
    createMutation.mutate({
      operation: "propagate",
      scope,
      annotation_ids: scope === "selected" ? selectedAnnotationIds : [],
      direction,
      start_frame: range.start,
      end_frame: range.end,
      conflict_policy: "skip_existing",
    });
  };

  return (
    <Modal open={open} onClose={onClose} title="3D 跨帧任务中心" width={720}>
      <div className="mb-4 grid grid-cols-2 gap-2" role="tablist" aria-label="跨帧任务类型">
        <Button
          size="sm"
          variant={view === "propagate" ? "primary" : "default"}
          role="tab"
          aria-selected={view === "propagate"}
          onClick={() => setView("propagate")}
        >
          批量传播
        </Button>
        <Button
          size="sm"
          variant={view === "track" ? "primary" : "default"}
          role="tab"
          aria-selected={view === "track"}
          onClick={() => setView("track")}
        >
          轨迹修正
        </Button>
      </div>
      {view === "propagate" ? (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
          <section className="space-y-4" aria-label="新建跨帧任务">
            <div>
              <h3 className="text-sm font-semibold text-foreground">传播 3D 框</h3>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                从当前 F{currentFrame} 传播；每个目标帧独立提交，取消会保留已完成帧。
              </p>
            </div>

            <fieldset className="space-y-2">
              <legend className="text-xs font-medium text-foreground">对象范围</legend>
              <label className="flex cursor-pointer items-center justify-between rounded-md border border-border px-3 py-2 text-xs text-foreground">
                <span>已选择对象 ({selectedAnnotationIds.length})</span>
                <input
                  type="radio"
                  name="cross-frame-scope"
                  value="selected"
                  checked={scope === "selected"}
                  disabled={selectedAnnotationIds.length === 0}
                  onChange={() => setScope("selected")}
                />
              </label>
              <label className="flex cursor-pointer items-center justify-between rounded-md border border-border px-3 py-2 text-xs text-foreground">
                <span>当前帧全部框 ({boxCount})</span>
                <input
                  type="radio"
                  name="cross-frame-scope"
                  value="all"
                  checked={scope === "all"}
                  disabled={boxCount === 0}
                  onChange={() => setScope("all")}
                />
              </label>
            </fieldset>

            <div className="grid grid-cols-2 gap-3">
              <label className="space-y-1 text-xs text-muted-foreground">
                方向
                <select
                  aria-label="传播方向"
                  value={direction}
                  onChange={(event) => setNextDirection(event.target.value as Direction)}
                  className="h-8 w-full rounded-md border border-border bg-background px-2 text-xs text-foreground"
                >
                  <option value="forward" disabled={currentFrame >= sceneEndFrame}>
                    向后
                  </option>
                  <option value="backward" disabled={currentFrame <= sceneStartFrame}>
                    向前
                  </option>
                </select>
              </label>
              <label className="space-y-1 text-xs text-muted-foreground">
                结束帧
                <input
                  aria-label="传播结束帧"
                  type="number"
                  min={sceneStartFrame}
                  max={sceneEndFrame}
                  value={targetEnd}
                  onChange={(event) => setTargetEnd(Number(event.target.value))}
                  className="h-8 w-full rounded-md border border-border bg-background px-2 text-xs text-foreground"
                />
              </label>
            </div>

            <label className="block space-y-1 text-xs text-muted-foreground">
              冲突策略
              <select
                aria-label="冲突策略"
                value="skip_existing"
                disabled
                className="h-8 w-full rounded-md border border-border bg-muted px-2 text-xs text-foreground"
              >
                <option value="skip_existing">跳过已有同轨迹框</option>
              </select>
            </label>

            <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              目标 F{range.start}–F{range.end} · {Math.max(0, range.count)} 个逻辑帧
              {!targetValid && <span className="ml-2 text-status-danger">范围必须为 1–100 帧</span>}
            </div>
            {readOnly && (
              <p className="text-xs text-status-caution">当前任务只读，不能启动写任务。</p>
            )}
            {sourceCount > 500 && (
              <p className="text-xs text-status-caution">
                单个任务最多传播 500 个 3D 框，请缩小已选范围。
              </p>
            )}
            <Button variant="primary" size="sm" disabled={!canStart} onClick={start}>
              {createMutation.isPending ? "提交中…" : "启动任务"}
            </Button>
          </section>

          <section
            className="min-h-64 border-t border-border pt-4 lg:border-l lg:border-t-0 lg:pl-5 lg:pt-0"
            aria-label="跨帧任务历史"
          >
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-foreground">当前 Scene 作业</h3>
              <Button size="xs" variant="ghost" onClick={() => void jobsQuery.refetch()}>
                刷新
              </Button>
            </div>
            {jobsQuery.isError ? (
              <p className="text-xs text-status-danger">任务列表加载失败</p>
            ) : jobs.length === 0 ? (
              <p className="rounded-md border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
                暂无跨帧任务
              </p>
            ) : (
              <div className="max-h-[420px] space-y-2 overflow-y-auto pr-1">
                {jobs.map((job) => {
                  const active = job.status === "pending" || job.status === "running";
                  return (
                    <article
                      key={job.id}
                      className="rounded-md border border-border bg-background p-3"
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium text-foreground">
                          {frameRange(job)}
                        </span>
                        <Badge variant={job.status === "failed" ? "warning" : "outline"}>
                          {STATUS_LABEL[job.status]}
                        </Badge>
                        <span className="ml-auto text-2xs tabular-nums text-muted-foreground">
                          {job.progress_pct}%
                        </span>
                      </div>
                      <div className="mt-2">
                        <ProgressBar value={job.progress_pct} />
                      </div>
                      <p className="mt-2 text-2xs text-muted-foreground">{jobSummary(job)}</p>
                      {(active || hasRetryableFrames(job)) && (
                        <div className="mt-2 flex justify-end gap-2">
                          {active && (
                            <Button
                              size="xs"
                              variant="ghost"
                              disabled={cancelMutation.isPending}
                              onClick={() => cancelMutation.mutate(job.id)}
                            >
                              取消
                            </Button>
                          )}
                          {!active && hasRetryableFrames(job) && (
                            <Button
                              size="xs"
                              variant="default"
                              disabled={retryMutation.isPending}
                              onClick={() => retryMutation.mutate(job.id)}
                            >
                              重试失败帧
                            </Button>
                          )}
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      ) : (
        <TrackOperationsPanel
          taskId={taskId}
          currentFrame={currentFrame}
          selectedTrackId={selectedTrackId}
          readOnly={readOnly}
        />
      )}
    </Modal>
  );
}
