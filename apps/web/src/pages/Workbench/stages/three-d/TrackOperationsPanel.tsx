import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { ApiError } from "@/api/client";
import {
  tasksApi,
  type PointCloudTrackOperationPreview,
  type PointCloudTrackOperationRequest,
} from "@/api/tasks";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { useToastStore } from "@/components/ui/Toast";

interface TrackOperationsPanelProps {
  taskId: string;
  currentFrame: number;
  selectedTrackId: string | null;
  readOnly: boolean;
  onCompleted?: () => void;
}

type Operation = "split" | "merge";

function shortTrackId(trackId: string): string {
  return trackId.length > 18 ? `${trackId.slice(0, 10)}…${trackId.slice(-5)}` : trackId;
}

function errorReason(error: unknown): string | null {
  if (!(error instanceof ApiError) || !error.detailRaw || typeof error.detailRaw !== "object") {
    return null;
  }
  const reason = (error.detailRaw as { reason?: unknown }).reason;
  return typeof reason === "string" ? reason : null;
}

export function TrackOperationsPanel({
  taskId,
  currentFrame,
  selectedTrackId,
  readOnly,
  onCompleted,
}: TrackOperationsPanelProps) {
  const queryClient = useQueryClient();
  const pushToast = useToastStore((state) => state.push);
  const [operation, setOperation] = useState<Operation>("split");
  const [secondaryTrackId, setSecondaryTrackId] = useState("");
  const [preview, setPreview] = useState<PointCloudTrackOperationPreview | null>(null);

  useEffect(() => {
    setSecondaryTrackId("");
    setPreview(null);
  }, [currentFrame, selectedTrackId, taskId]);

  const candidatesQuery = useQuery({
    queryKey: ["point-cloud-track-operation-candidates", taskId, selectedTrackId],
    queryFn: () => tasksApi.listPointCloudTrackOperationCandidates(taskId, selectedTrackId!),
    enabled: operation === "merge" && !!selectedTrackId && !readOnly,
  });
  const candidates = useMemo(
    () => candidatesQuery.data?.candidates ?? [],
    [candidatesQuery.data?.candidates],
  );

  const operationRequest = useMemo<PointCloudTrackOperationRequest | null>(() => {
    if (!selectedTrackId) return null;
    if (operation === "split") {
      return {
        operation: "split",
        primary_track_id: selectedTrackId,
        split_after_frame: currentFrame,
      };
    }
    if (!secondaryTrackId) return null;
    return {
      operation: "merge",
      primary_track_id: selectedTrackId,
      secondary_track_id: secondaryTrackId,
    };
  }, [currentFrame, operation, secondaryTrackId, selectedTrackId]);

  const previewMutation = useMutation({
    mutationFn: (payload: PointCloudTrackOperationRequest) =>
      tasksApi.previewPointCloudTrackOperation(taskId, payload),
    onSuccess: (value) => setPreview(value),
    onError: () => {
      setPreview(null);
      pushToast({ msg: "轨迹修正预览失败", kind: "error" });
    },
  });
  const executeMutation = useMutation({
    mutationFn: ({
      payload,
      snapshotToken,
    }: {
      payload: PointCloudTrackOperationRequest;
      snapshotToken: string;
    }) =>
      tasksApi.executePointCloudTrackOperation(taskId, {
        ...payload,
        snapshot_token: snapshotToken,
      }),
    onSuccess: (result) => {
      setPreview(null);
      setSecondaryTrackId("");
      queryClient.invalidateQueries({ queryKey: ["annotations"] });
      queryClient.invalidateQueries({ queryKey: ["scene-timeline"] });
      queryClient.invalidateQueries({ queryKey: ["point-cloud-track-operation-candidates"] });
      pushToast({
        msg: result.operation === "split" ? "轨迹已拆分" : "轨迹已合并",
        kind: "success",
      });
      onCompleted?.();
    },
    onError: (error) => {
      if (errorReason(error) === "track_snapshot_stale") {
        setPreview(null);
        pushToast({ msg: "轨迹已变化，请重新预览", kind: "warning" });
        return;
      }
      pushToast({ msg: "轨迹修正失败", kind: "error" });
    },
  });

  const selectOperation = (next: Operation) => {
    setOperation(next);
    setPreview(null);
    if (next === "split") setSecondaryTrackId("");
  };
  const canPreview = !!operationRequest && !readOnly && !previewMutation.isPending;
  const confirm = () => {
    if (!operationRequest || !preview || executeMutation.isPending) return;
    executeMutation.mutate({
      payload: operationRequest,
      snapshotToken: preview.snapshot_token,
    });
  };

  return (
    <section className="space-y-4" aria-label="3D 轨迹修正">
      <div>
        <h3 className="text-sm font-semibold text-foreground">轨迹身份修正</h3>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          只修改跨帧身份，不移动、插值或删除任何 3D 框。提交前必须先预览。
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2" role="group" aria-label="轨迹修正操作">
        <Button
          size="sm"
          variant={operation === "split" ? "primary" : "default"}
          aria-pressed={operation === "split"}
          onClick={() => selectOperation("split")}
        >
          拆分轨迹
        </Button>
        <Button
          size="sm"
          variant={operation === "merge" ? "primary" : "default"}
          aria-pressed={operation === "merge"}
          onClick={() => selectOperation("merge")}
        >
          合并轨迹
        </Button>
      </div>

      {!selectedTrackId ? (
        <p className="rounded-md border border-dashed border-border px-3 py-5 text-center text-xs text-muted-foreground">
          请先在当前帧选择一个已有跨帧轨迹的 3D 框。
        </p>
      ) : (
        <div className="space-y-3">
          <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs">
            <span className="text-muted-foreground">当前 survivor：</span>
            <span className="ml-1 font-mono text-foreground" title={selectedTrackId}>
              {shortTrackId(selectedTrackId)}
            </span>
            <span className="ml-2 text-muted-foreground">· F{currentFrame}</span>
          </div>

          {operation === "split" ? (
            <p className="text-xs leading-5 text-muted-foreground">
              F{currentFrame} 及之前保留原轨迹；之后的成员获得新轨迹 ID。
            </p>
          ) : (
            <label className="block space-y-1 text-xs text-muted-foreground">
              合并候选
              <select
                aria-label="合并候选轨迹"
                value={secondaryTrackId}
                disabled={candidatesQuery.isLoading || candidates.length === 0}
                onChange={(event) => {
                  setSecondaryTrackId(event.target.value);
                  setPreview(null);
                }}
                className="h-9 w-full rounded-md border border-border bg-background px-2 text-xs text-foreground"
              >
                <option value="">
                  {candidatesQuery.isLoading
                    ? "正在查找候选…"
                    : candidates.length === 0
                      ? "没有可安全合并的同类轨迹"
                      : "选择同类、无重叠轨迹"}
                </option>
                {candidates.map((candidate) => (
                  <option key={candidate.track_id} value={candidate.track_id}>
                    {candidate.class_name} · F{candidate.first_frame}–F{candidate.last_frame} ·
                    {candidate.member_count} 框 · {shortTrackId(candidate.track_id)}
                  </option>
                ))}
              </select>
            </label>
          )}

          {candidatesQuery.isError && operation === "merge" && (
            <p className="text-xs text-status-danger">合并候选加载失败，请刷新后重试。</p>
          )}
          {candidatesQuery.data?.truncated && operation === "merge" && (
            <p className="text-xs text-status-caution">候选较多，仅显示前 20 条安全候选。</p>
          )}
          {readOnly && (
            <p className="text-xs text-status-caution">当前任务只读，不能修改轨迹身份。</p>
          )}

          <Button
            size="sm"
            variant="default"
            disabled={!canPreview}
            onClick={() => operationRequest && previewMutation.mutate(operationRequest)}
          >
            {previewMutation.isPending ? "计算中…" : "预览影响"}
          </Button>
        </div>
      )}

      {preview && operationRequest && (
        <div className="space-y-3 rounded-md border border-brand/30 bg-brand/5 p-3" role="status">
          <div className="flex items-center gap-2">
            <Badge variant="accent">待确认</Badge>
            <span className="text-xs font-medium text-foreground">
              {preview.operation === "split" ? "拆分轨迹" : "合并到当前轨迹"}
            </span>
          </div>
          <p className="text-xs leading-5 text-muted-foreground">
            共更新 {preview.affected_member_count} 个成员，其中 {preview.rewritten_member_count}{" "}
            个成员会改写 track ID。
          </p>
          {preview.secondary && (
            <p className="text-xs text-muted-foreground">
              {preview.secondary.class_name} · F{preview.secondary.first_frame}–F
              {preview.secondary.last_frame} · {preview.secondary.member_count} 框
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button size="xs" variant="ghost" onClick={() => setPreview(null)}>
              取消
            </Button>
            <Button
              size="xs"
              variant="primary"
              disabled={executeMutation.isPending || readOnly}
              onClick={confirm}
            >
              {executeMutation.isPending
                ? "提交中…"
                : preview.operation === "split"
                  ? "确认拆分"
                  : "确认合并"}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
