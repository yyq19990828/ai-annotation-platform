import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import {
  hasPixelAnchor,
  type AnnotationFeedback,
  type FeedbackVideoContext,
} from "@/api/feedbacks";
import { useFeedbacks } from "@/hooks/useFeedbacks";
import type { VideoFrameSeekResult } from "../stage/videoStageControls";
import { useActiveIssueStore } from "./useActiveIssueStore";
import type { Viewport } from "./useViewportTransform";
import { resolvePinViewport } from "./useWorkbenchShellModel.helpers";

export interface IssuePinAnchor {
  x: number;
  y: number;
  frame?: number;
  annotationId?: string;
  annotationLabel?: string;
  maxFrame?: number;
  videoContext?: FeedbackVideoContext;
}

export interface IssueNavigation {
  status: "idle" | "preparing" | "ready" | "cancelled" | "timeout" | "unavailable";
  frameIndex: number | null;
  message?: string;
}

interface IssueOwner {
  projectId: string | undefined;
  taskId: string | undefined;
  isVideoTask: boolean;
}

interface IssueUiState {
  owner: IssueOwner;
  issueCreateOpen: boolean;
  issuePinDropArmed: boolean;
  issuePinPrefill: IssuePinAnchor | null;
  issueNavigation: IssueNavigation;
}

interface NavigationRequest {
  owner: IssueOwner;
  frameIndex: number;
  anchor?: IssuePinAnchor;
}

function emptyIssueState(owner: IssueOwner): IssueUiState {
  return {
    owner,
    issueCreateOpen: false,
    issuePinDropArmed: false,
    issuePinPrefill: null,
    issueNavigation: { status: "idle", frameIndex: null },
  };
}

function isSourceFrame(frame: unknown): frame is number {
  return typeof frame === "number" && Number.isInteger(frame) && frame >= 0;
}

export function useIssuePins(params: {
  projectId: string | undefined;
  taskId: string | undefined;
  stageGeom: { imgW: number; imgH: number; vpSize: { w: number; h: number } };
  setVp: Dispatch<SetStateAction<Viewport>>;
  seekVideoFrameReady: (frame: number, isRelevant: () => boolean) => Promise<VideoFrameSeekResult>;
  pauseVideoPlayback: () => void;
  isVideoTask: boolean;
  captureVideoContext?: (frame: number) => Partial<IssuePinAnchor> | null;
  navigateVideoIssue?: (issue: AnnotationFeedback) => Promise<void>;
  onCreateIntent?: () => void;
}) {
  const { projectId, taskId, stageGeom, setVp, isVideoTask } = params;
  const owner = useMemo(
    () => ({ projectId, taskId, isVideoTask }),
    [projectId, taskId, isVideoTask],
  );
  const ownerRef = useRef(owner);
  ownerRef.current = owner;
  const paramsRef = useRef(params);
  paramsRef.current = params;
  const mountedRef = useRef(true);
  const activeRequestRef = useRef<NavigationRequest | null>(null);
  const retryRequestRef = useRef<NavigationRequest | null>(null);
  const uiRef = useRef(emptyIssueState(owner));
  const [ui, setUi] = useState(uiRef.current);

  // Changing away and back creates a new owner, even when the task id repeats.
  if (uiRef.current.owner !== owner) {
    uiRef.current = emptyIssueState(owner);
    activeRequestRef.current = null;
    retryRequestRef.current = null;
  }
  const currentUi = ui.owner === owner ? ui : uiRef.current;

  useLayoutEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      activeRequestRef.current = null;
      retryRequestRef.current = null;
    };
  }, []);

  const updateUi = useCallback(
    (patch: Partial<Omit<IssueUiState, "owner">>) => {
      if (!mountedRef.current || ownerRef.current !== owner) return;
      uiRef.current = { ...uiRef.current, ...patch };
      setUi(uiRef.current);
    },
    [owner],
  );

  const clearRequest = useCallback(() => {
    activeRequestRef.current = null;
    retryRequestRef.current = null;
  }, []);

  const runNavigation = useCallback(
    async (input: NavigationRequest) => {
      if (!mountedRef.current || ownerRef.current !== input.owner) return;
      const request = { ...input, anchor: input.anchor ? { ...input.anchor } : undefined };
      activeRequestRef.current = request;
      retryRequestRef.current = request;
      const isRelevant = () =>
        mountedRef.current &&
        ownerRef.current === request.owner &&
        activeRequestRef.current === request;
      updateUi({ issueNavigation: { status: "preparing", frameIndex: request.frameIndex } });

      let result: VideoFrameSeekResult;
      try {
        paramsRef.current.pauseVideoPlayback();
        result = await paramsRef.current.seekVideoFrameReady(request.frameIndex, isRelevant);
      } catch {
        result = { status: "unavailable", frameIndex: request.frameIndex, source: null };
      }
      if (!isRelevant()) return;

      const status =
        result.status === "ready" && result.frameIndex !== request.frameIndex
          ? "unavailable"
          : result.status;
      updateUi({
        issueNavigation: { status, frameIndex: request.frameIndex },
        ...(status === "ready" && request.anchor
          ? { issueCreateOpen: true, issuePinPrefill: request.anchor }
          : {}),
      });
      if (status === "ready") retryRequestRef.current = null;
    },
    [updateUi],
  );

  const closeIssueCreate = useCallback(() => {
    if (ownerRef.current !== owner) return;
    clearRequest();
    updateUi(emptyIssueState(owner));
  }, [clearRequest, owner, updateUi]);

  const onToggleIssuePinDrop = useCallback(() => {
    if (!mountedRef.current || ownerRef.current !== owner || !projectId || !taskId) return;
    const armed = !uiRef.current.issuePinDropArmed;
    paramsRef.current.onCreateIntent?.();
    clearRequest();
    if (armed && isVideoTask) paramsRef.current.pauseVideoPlayback();
    updateUi({ ...emptyIssueState(owner), issuePinDropArmed: armed });
  }, [clearRequest, isVideoTask, owner, projectId, taskId, updateUi]);

  const openTaskIssue = useCallback(() => {
    if (!mountedRef.current || ownerRef.current !== owner || !projectId || !taskId) return;
    clearRequest();
    if (isVideoTask) paramsRef.current.pauseVideoPlayback();
    paramsRef.current.onCreateIntent?.();
    updateUi({ ...emptyIssueState(owner), issueCreateOpen: true });
  }, [clearRequest, isVideoTask, owner, projectId, taskId, updateUi]);

  const onIssuePinDrop = useCallback(
    async (x: number, y: number, frame?: number) => {
      if (
        !mountedRef.current ||
        ownerRef.current !== owner ||
        !uiRef.current.issuePinDropArmed ||
        !Number.isFinite(x) ||
        !Number.isFinite(y) ||
        x < 0 ||
        x > 1 ||
        y < 0 ||
        y > 1
      ) {
        return;
      }
      clearRequest();
      if (!isVideoTask) {
        updateUi({ issuePinDropArmed: false, issuePinPrefill: { x, y }, issueCreateOpen: true });
        return;
      }
      if (!isSourceFrame(frame)) {
        updateUi({
          issuePinDropArmed: false,
          issueNavigation: { status: "unavailable", frameIndex: null },
        });
        return;
      }
      const anchor = { ...paramsRef.current.captureVideoContext?.(frame), x, y, frame };
      updateUi({ issuePinDropArmed: false, issuePinPrefill: anchor });
      await runNavigation({ owner, frameIndex: frame, anchor });
    },
    [clearRequest, isVideoTask, owner, runNavigation, updateUi],
  );

  const onSeekIssueFrame = useCallback(
    async (frame: number) => {
      if (!mountedRef.current || ownerRef.current !== owner || !isVideoTask) return;
      if (!isSourceFrame(frame)) {
        clearRequest();
        updateUi({ issueNavigation: { status: "unavailable", frameIndex: null } });
        return;
      }
      await runNavigation({ owner, frameIndex: frame });
    },
    [clearRequest, isVideoTask, owner, runNavigation, updateUi],
  );

  const retryIssueNavigation = useCallback(async () => {
    const request = retryRequestRef.current;
    if (
      !request ||
      request.owner !== owner ||
      uiRef.current.issueNavigation.status === "preparing"
    ) {
      return;
    }
    await runNavigation(request);
  }, [owner, runNavigation]);

  const issueListParams = useMemo(
    () => ({ project_id: projectId ?? "", task_id: taskId, kind: "issue" as const }),
    [projectId, taskId],
  );
  const issuesQuery = useFeedbacks(issueListParams, !!projectId && !!taskId);
  // The compact FAB uses the first page only; the issues panel owns pagination.
  const openIssueCount = (issuesQuery.data?.items ?? []).filter((i) => i.status === "open").length;
  const activeIssueHighlightId = useActiveIssueStore((st) => st.highlightId);
  const highlightIssueFromPin = useActiveIssueStore((st) => st.highlightFromPin);
  const requestIssuesTab = useActiveIssueStore((st) => st.requestIssuesTab);
  const issueFocusTick = useActiveIssueStore((st) => st.focusTick);
  const focusTarget = useActiveIssueStore((st) => st.focusTarget);
  const lastIssueFocusRef = useRef({ owner, tick: issueFocusTick });

  useEffect(() => {
    const previous = lastIssueFocusRef.current;
    lastIssueFocusRef.current = { owner, tick: issueFocusTick };
    if (issueFocusTick === previous.tick) return;
    const target =
      focusTarget?.id === activeIssueHighlightId
        ? focusTarget
        : (issuesQuery.data?.items ?? []).find((i) => i.id === activeIssueHighlightId);
    if (!target?.anchor_position) return;
    if (isVideoTask) {
      if (paramsRef.current.navigateVideoIssue && target.project_id === projectId) {
        clearRequest();
        updateUi(emptyIssueState(owner));
        void paramsRef.current.navigateVideoIssue(target);
        return;
      }
      const frame = target.anchor_position.frame;
      if (typeof frame === "number") void onSeekIssueFrame(frame);
      return;
    }
    const { imgW, imgH, vpSize } = stageGeom;
    if (!imgW || !imgH || !vpSize.w || !vpSize.h || !hasPixelAnchor(target)) return;
    setVp((cur) => resolvePinViewport(cur, target.anchor_position, imgW, imgH, vpSize));
  }, [
    owner,
    issueFocusTick,
    activeIssueHighlightId,
    issuesQuery.data,
    stageGeom,
    setVp,
    isVideoTask,
    onSeekIssueFrame,
    focusTarget,
    projectId,
    clearRequest,
    updateUi,
  ]);

  return {
    issueCreateOpen: currentUi.issueCreateOpen,
    issuePinDropArmed: currentUi.issuePinDropArmed,
    issuePinPrefill: currentUi.issuePinPrefill,
    issueNavigation: currentUi.issueNavigation,
    onToggleIssuePinDrop,
    openTaskIssue,
    onIssuePinDrop,
    closeIssueCreate,
    onSeekIssueFrame,
    retryIssueNavigation,
    issueListParams,
    issuesQuery,
    openIssueCount,
    activeIssueHighlightId,
    highlightIssueFromPin,
    requestIssuesTab,
  };
}
