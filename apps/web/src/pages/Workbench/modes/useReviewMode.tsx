import { useCallback, useEffect, useMemo, useState } from "react";
import {
  useApproveTask,
  useRejectTask,
  useReviewClaim,
} from "@/hooks/useTasks";
import { ReviewerMiniPanel } from "@/pages/Review/ReviewerMiniPanel";
import type { ReviewClaimResponse, TaskResponse } from "@/types";
import type {
  DiffMode,
  NavigateTask,
  PushToast,
  WorkbenchMode,
  WorkbenchModeState,
} from "./types";

interface UseReviewModeParams {
  mode: WorkbenchMode;
  taskId: string | undefined;
  task: TaskResponse | undefined;
  navigateTask: NavigateTask;
  pushToast: PushToast;
}

const noop = () => {};
const emptyBannerActions = {
  canWithdraw: false,
  isWithdrawing: false,
  isReopening: false,
  isAcceptingRejection: false,
  onWithdraw: noop,
  onReopen: noop,
  onAcceptRejection: noop,
};

export function useReviewMode({
  mode,
  taskId,
  task,
  navigateTask,
  pushToast,
}: UseReviewModeParams): WorkbenchModeState {
  const [diffMode, setDiffMode] = useState<DiffMode>("diff");
  const [rejectingTask, setRejectingTask] = useState(false);
  const [claimInfo, setClaimInfo] = useState<ReviewClaimResponse | null>(null);
  const approveMut = useApproveTask();
  const rejectMut = useRejectTask();
  const claimMut = useReviewClaim();

  useEffect(() => {
    if (mode !== "review" || !taskId || task?.status !== "review") return;
    claimMut.mutate(taskId, {
      onSuccess: (data) => setClaimInfo(data),
      onError: () => {},
    });
    // claimMut 故意不在依赖数组中（每次 taskId 变化只 fire 一次）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, taskId, task?.status]);

  const handleApproveTask = useCallback(() => {
    if (!taskId) return;
    approveMut.mutate(taskId, {
      onSuccess: () => {
        pushToast({ msg: "任务已通过", kind: "success" });
        navigateTask("next");
      },
      onError: () => pushToast({ msg: "通过失败，请重试", kind: "error" }),
    });
  }, [taskId, approveMut, pushToast, navigateTask]);

  const handleRejectTask = useCallback(
    (reason: string) => {
      if (!taskId) return;
      rejectMut.mutate({ taskId, reason }, {
        onSuccess: () => {
          pushToast({ msg: "任务已退回", kind: "success" });
          setRejectingTask(false);
          navigateTask("next");
        },
        onError: () => pushToast({ msg: "退回失败，请重试", kind: "error" }),
      });
    },
    [taskId, rejectMut, pushToast, navigateTask],
  );

  useEffect(() => {
    if (mode !== "review") return;
    const handler = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.isContentEditable) return;
      if (e.key === "a" || e.key === "A") {
        e.preventDefault();
        handleApproveTask();
      } else if (e.key === "r" || e.key === "R") {
        e.preventDefault();
        setRejectingTask(true);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [mode, handleApproveTask]);

  const topbarActions = useMemo(
    () => ({
      canApprove: mode === "review",
      canReject: mode === "review",
      onApprove: handleApproveTask,
      onReject: () => setRejectingTask(true),
      isApproving: approveMut.isPending,
      isRejecting: rejectMut.isPending,
      reviewInfoSlot: mode === "review" ? <ReviewerMiniPanel /> : undefined,
    }),
    [mode, handleApproveTask, approveMut.isPending, rejectMut.isPending],
  );

  return {
    isLocked: task?.status === "completed",
    diffMode: mode === "review" ? diffMode : undefined,
    onSetDiffMode: mode === "review" ? setDiffMode : undefined,
    banners: null,
    claimInfo,
    topbarActions,
    bannerActions: emptyBannerActions,
    rejectModal: mode === "review"
      ? {
          open: rejectingTask,
          onClose: () => setRejectingTask(false),
          onConfirm: handleRejectTask,
          skipReasonHint: task?.skip_reason ?? null,
        }
      : undefined,
  };
}
