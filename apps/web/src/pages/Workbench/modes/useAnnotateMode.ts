import { useCallback, useMemo } from "react";
import { ApiError } from "@/api/client";
import {
  useAcceptRejection,
  useReopenTask,
  useSkipTask,
  useWithdrawTask,
} from "@/hooks/useTasks";
import type { TaskResponse } from "@/types";
import type { SkipReason } from "../shell/SkipTaskModal";
import type {
  NavigateTask,
  PushToast,
  SmartNext,
  WorkbenchMode,
  WorkbenchModeState,
} from "./types";

interface UseAnnotateModeParams {
  mode: WorkbenchMode;
  taskId: string | undefined;
  task: TaskResponse | undefined;
  navigateTask: NavigateTask;
  smartNext: SmartNext;
  onSubmit: () => void;
  isSubmitting: boolean;
  pushToast: PushToast;
}

const noop = () => {};

export function useAnnotateMode({
  mode,
  taskId,
  task,
  navigateTask,
  smartNext,
  onSubmit,
  isSubmitting,
  pushToast,
}: UseAnnotateModeParams): WorkbenchModeState {
  const withdrawTaskMut = useWithdrawTask();
  const reopenTaskMut = useReopenTask();
  const acceptRejectionMut = useAcceptRejection();
  const skipTaskMut = useSkipTask();

  const canWithdraw = task?.status === "review" && !task?.reviewer_claimed_at;
  const canReopen = task?.status === "completed";

  const handleWithdrawTask = useCallback(() => {
    if (!taskId || !canWithdraw) return;
    withdrawTaskMut.mutate(taskId, {
      onSuccess: () => pushToast({ msg: "已撤回提交，可继续编辑", kind: "success" }),
      onError: (err) => {
        const isApi = err instanceof ApiError;
        const reason = isApi ? (err.detailRaw as { reason?: string } | undefined)?.reason : undefined;
        let msg = "撤回失败，请刷新后重试";
        if (reason === "task_already_claimed") msg = "审核员已介入，无法撤回";
        else if (isApi && err.status === 403) msg = "只有任务的指派人可撤回（请联系管理员重新指派）";
        pushToast({ msg, kind: "error" });
      },
    });
  }, [taskId, canWithdraw, withdrawTaskMut, pushToast]);

  const handleReopenTask = useCallback(() => {
    if (!taskId || !canReopen) return;
    reopenTaskMut.mutate(taskId, {
      onSuccess: () => pushToast({ msg: "已重开任务，可继续编辑", sub: "改完记得重新提交质检", kind: "success" }),
      onError: () => pushToast({ msg: "重开失败，请刷新后重试", kind: "error" }),
    });
  }, [taskId, canReopen, reopenTaskMut, pushToast]);

  const handleAcceptRejection = useCallback(() => {
    if (!taskId) return;
    acceptRejectionMut.mutate(taskId, {
      onError: () => pushToast({ kind: "error", msg: "接受退回失败，请重试" }),
    });
  }, [acceptRejectionMut, pushToast, taskId]);

  const handleSkipTask = useCallback(
    (reason: SkipReason, note?: string) => {
      if (!taskId) return;
      skipTaskMut.mutate(
        { taskId, reason, note },
        {
          onSuccess: () => {
            pushToast({ msg: "已跳过本题，等待审核员复核", kind: "success" });
            navigateTask("next");
          },
          onError: (err) => {
            const isApi = err instanceof ApiError;
            const reason = isApi
              ? (err.detailRaw as { reason?: string } | undefined)?.reason
              : undefined;
            let msg = "跳过失败，请刷新后重试";
            if (reason === "task_not_skippable") msg = "当前状态无法跳过";
            else if (reason === "invalid_skip_reason") msg = "原因无效";
            pushToast({ msg, kind: "error" });
          },
        },
      );
    },
    [taskId, skipTaskMut, pushToast, navigateTask],
  );

  const topbarActions = useMemo(
    () => ({
      canSubmit: task?.status !== "review" && task?.status !== "completed",
      onSubmit,
      isSubmitting,
      onSmartNextOpen: mode === "annotate" ? () => smartNext("open") : undefined,
      onSmartNextUncertain: mode === "annotate" ? () => smartNext("uncertain") : undefined,
      canWithdraw,
      canReopen,
      isWithdrawing: withdrawTaskMut.isPending,
      isReopening: reopenTaskMut.isPending,
      onWithdraw: handleWithdrawTask,
      onReopen: handleReopenTask,
      isSkipping: skipTaskMut.isPending,
      onSkip: mode === "annotate" ? handleSkipTask : undefined,
    }),
    [
      task?.status,
      onSubmit,
      isSubmitting,
      mode,
      smartNext,
      canWithdraw,
      canReopen,
      withdrawTaskMut.isPending,
      reopenTaskMut.isPending,
      handleWithdrawTask,
      handleReopenTask,
      skipTaskMut.isPending,
      handleSkipTask,
    ],
  );

  const bannerActions = useMemo(
    () => ({
      canWithdraw,
      isWithdrawing: withdrawTaskMut.isPending,
      isReopening: reopenTaskMut.isPending,
      isAcceptingRejection: acceptRejectionMut.isPending,
      onWithdraw: handleWithdrawTask,
      onReopen: handleReopenTask,
      onAcceptRejection: handleAcceptRejection,
    }),
    [
      canWithdraw,
      withdrawTaskMut.isPending,
      reopenTaskMut.isPending,
      acceptRejectionMut.isPending,
      handleWithdrawTask,
      handleReopenTask,
      handleAcceptRejection,
    ],
  );

  return {
    isLocked: task?.status === "review" || task?.status === "completed",
    banners: null,
    claimInfo: null,
    topbarActions,
    bannerActions: mode === "annotate" ? bannerActions : {
      canWithdraw: false,
      isWithdrawing: false,
      isReopening: false,
      isAcceptingRejection: false,
      onWithdraw: noop,
      onReopen: noop,
      onAcceptRejection: noop,
    },
  };
}
