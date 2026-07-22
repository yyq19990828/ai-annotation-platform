import { useEffect, useRef, useState } from "react";

import type { MaskRepairAction } from "@/api/maskQc";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/shadcn/ui/alert";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/shadcn/ui/sheet";
import { Spinner } from "@/components/shadcn/ui/spinner";
import {
  useDryRunMaskRepairs,
  useExecuteMaskRepairs,
  useMaskRepairBatch,
  useResumeMaskRepairs,
  useRollbackMaskRepairs,
} from "@/hooks/useMaskQc";

const TERMINAL = new Set([
  "completed",
  "partial",
  "failed",
  "cancelled",
  "rolled_back",
  "rollback_failed",
]);

function statusLabel(status: string): string {
  return {
    pending: "等待执行",
    running: "正在执行",
    completed: "修复完成",
    partial: "部分完成",
    failed: "执行失败",
    cancelled: "已取消",
    rolling_back: "正在回滚",
    rolled_back: "已回滚",
    rollback_failed: "回滚失败",
  }[status] ?? status;
}

function errorText(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "请求失败，请刷新问题后重试";
}

function rollbackFailure(result: Record<string, unknown>): Record<string, unknown> | null {
  const value = result.rollback;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return (value as Record<string, unknown>).status === "failed"
    ? value as Record<string, unknown>
    : null;
}

interface MaskRepairSheetProps {
  open: boolean;
  projectId: string;
  actions: MaskRepairAction[];
  onOpenChange: (open: boolean) => void;
  onFinished: () => void;
}

export function MaskRepairSheet({
  open,
  projectId,
  actions,
  onOpenChange,
  onFinished,
}: MaskRepairSheetProps) {
  const dryRun = useDryRunMaskRepairs(projectId);
  const execute = useExecuteMaskRepairs(projectId);
  const rollback = useRollbackMaskRepairs();
  const resume = useResumeMaskRepairs();
  const [repairId, setRepairId] = useState<string | null>(null);
  const batch = useMaskRepairBatch(projectId, repairId);
  const requestedKeyRef = useRef<string | null>(null);
  const finishedKeyRef = useRef<string | null>(null);
  const actionKey = actions.map((action) => `${action.issue_id}:${action.kind}`).join("|");
  const currentBatch = batch.data ?? execute.data ?? null;
  const isTerminal = currentBatch ? TERMINAL.has(currentBatch.status) : false;
  const canRollback = Boolean(
    currentBatch
    && ["completed", "partial"].includes(currentBatch.status)
    && currentBatch.rollback_expires_at
    && new Date(currentBatch.rollback_expires_at).getTime() > Date.now(),
  );
  const rollbackReport = currentBatch ? rollbackFailure(currentBatch.result) : null;

  useEffect(() => {
    if (!open || !actions.length || requestedKeyRef.current === actionKey) return;
    requestedKeyRef.current = actionKey;
    setRepairId(null);
    execute.reset();
    rollback.reset();
    resume.reset();
    finishedKeyRef.current = null;
    dryRun.mutate(actions);
  }, [actionKey, actions, dryRun, execute, open, resume, rollback]);

  useEffect(() => {
    if (!currentBatch || !isTerminal) return;
    const finishedKey = `${currentBatch.id}:${currentBatch.status}:${currentBatch.result_digest}`;
    if (finishedKeyRef.current === finishedKey) return;
    finishedKeyRef.current = finishedKey;
    onFinished();
  }, [currentBatch, isTerminal, onFinished]);

  const close = () => {
    requestedKeyRef.current = null;
    onOpenChange(false);
  };

  const submit = () => {
    if (!dryRun.data) return;
    execute.mutate(
      { receipt: dryRun.data.receipt, planDigest: dryRun.data.plan_digest },
      { onSuccess: (value) => setRepairId(value.id) },
    );
  };

  const submitRollback = () => {
    if (!currentBatch || !canRollback) return;
    rollback.mutate(
      { repairId: currentBatch.id, resultDigest: currentBatch.result_digest },
      { onSuccess: (value) => setRepairId(value.id) },
    );
  };

  const submitResume = () => {
    if (!currentBatch || !["failed", "partial"].includes(currentBatch.status)) return;
    resume.mutate(currentBatch.id, { onSuccess: (value) => setRepairId(value.id) });
  };

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (next) onOpenChange(true);
        else close();
      }}
    >
      <SheetContent side="right" className="w-full sm:max-w-md">
        <SheetHeader className="border-b border-border">
          <SheetTitle>批量修复预览</SheetTitle>
          <SheetDescription>
            先冻结问题版本和精确像素范围，再提交可审计的原子分片。
          </SheetDescription>
        </SheetHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4">
          {dryRun.isPending && (
            <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
              <Spinner data-icon="inline-start" /> 正在计算精确变更…
            </div>
          )}

          {dryRun.isError && (
            <Alert variant="destructive">
              <AlertTitle>预览失败</AlertTitle>
              <AlertDescription>{errorText(dryRun.error)}</AlertDescription>
            </Alert>
          )}

          {dryRun.data && !currentBatch && (
            <>
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-lg border border-border bg-card p-3">
                  <div className="text-xs text-muted-foreground">实际修复对象</div>
                  <div className="mt-1 text-lg font-semibold text-foreground">
                    {dryRun.data.summary.mutation_count}
                  </div>
                </div>
                <div className="rounded-lg border border-border bg-card p-3">
                  <div className="text-xs text-muted-foreground">变更像素</div>
                  <div className="mt-1 text-lg font-semibold text-foreground">
                    {dryRun.data.summary.changed_pixels.toLocaleString()}
                  </div>
                </div>
                <div className="rounded-lg border border-border bg-card p-3">
                  <div className="text-xs text-muted-foreground">原子分片</div>
                  <div className="mt-1 text-lg font-semibold text-foreground">
                    {dryRun.data.summary.shard_count}
                  </div>
                </div>
                <div className="rounded-lg border border-border bg-card p-3">
                  <div className="text-xs text-muted-foreground">跳过项</div>
                  <div className="mt-1 text-lg font-semibold text-foreground">
                    {dryRun.data.summary.skipped_count}
                  </div>
                </div>
              </div>

              <div className="flex flex-col gap-2">
                {dryRun.data.items.map((item) => (
                  <div key={item.issue_id} className="rounded-lg border border-border bg-card p-3">
                    <div className="flex items-center gap-2">
                      <Badge variant={item.skip_code ? "warning" : "success"}>
                        {item.skip_code ? "跳过" : "可执行"}
                      </Badge>
                      <span className="truncate text-sm font-medium text-foreground">
                        {item.kind}
                      </span>
                      {item.frame_index != null && (
                        <span className="ml-auto text-xs text-muted-foreground">F{item.frame_index}</span>
                      )}
                    </div>
                    <div className="mt-2 text-xs text-muted-foreground">
                      {item.skip_detail
                        ?? `${item.annotation_ids.length} 个对象 · ${item.changed_pixels.toLocaleString()} 像素`}
                    </div>
                    {item.skip_code && (
                      <div className="mt-1 font-mono text-xs text-muted-foreground">
                        {item.skip_code}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              <div className="font-mono text-xs text-muted-foreground">
                计划摘要 {dryRun.data.plan_digest.slice(0, 16)} · 收据 15 分钟有效
              </div>
            </>
          )}

          {currentBatch && (
            <Alert variant={currentBatch.status === "failed" || currentBatch.status === "rollback_failed" ? "destructive" : "default"}>
              <AlertTitle>{statusLabel(currentBatch.status)}</AlertTitle>
              <AlertDescription>
                批次 {currentBatch.id.slice(0, 8)} · 结果摘要 {currentBatch.result_digest.slice(0, 12)}
              </AlertDescription>
            </Alert>
          )}

          {(execute.isError || batch.isError || rollback.isError || resume.isError) && (
            <Alert variant="destructive">
              <AlertTitle>操作失败</AlertTitle>
              <AlertDescription>
                {errorText(execute.error ?? batch.error ?? rollback.error ?? resume.error)}
              </AlertDescription>
            </Alert>
          )}
        </div>

        <SheetFooter className="border-t border-border">
          {!currentBatch && (
            <Button
              variant="primary"
              disabled={!dryRun.data || dryRun.data.summary.executable_count === 0 || execute.isPending}
              onClick={submit}
            >
              {execute.isPending && <Spinner data-icon="inline-start" />}
              确认修复 {dryRun.data ? `(${dryRun.data.summary.mutation_count})` : ""}
            </Button>
          )}
          {canRollback && (
            <Button variant="danger" disabled={rollback.isPending} onClick={submitRollback}>
              {rollback.isPending && <Spinner data-icon="inline-start" />}
              回滚本批修复
            </Button>
          )}
          {currentBatch && ["failed", "partial"].includes(currentBatch.status) && (
            <Button variant="primary" disabled={resume.isPending} onClick={submitResume}>
              {resume.isPending && <Spinner data-icon="inline-start" />}
              重试未完成分片
            </Button>
          )}
          {rollbackReport && (
            <Button
              variant="ghost"
              onClick={() => {
                const blob = new Blob(
                  [JSON.stringify(rollbackReport, null, 2)],
                  { type: "application/json" },
                );
                const url = URL.createObjectURL(blob);
                const anchor = document.createElement("a");
                anchor.href = url;
                anchor.download = `mask-repair-${currentBatch!.id}-rollback-conflict.json`;
                anchor.click();
                URL.revokeObjectURL(url);
              }}
            >
              下载回滚冲突报告
            </Button>
          )}
          <Button variant="ghost" onClick={close}>{isTerminal ? "完成" : "关闭"}</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
