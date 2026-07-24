// v0.16.x 第 2 批 · 从 useWorkbenchShellModel 抽出的 issue 图钉子 hook:issue 列表查询、
// 图钉创建/拖放 UI 状态、与 DiscussionPanel issues tab 的聚焦联动 effect。
// 行为零变化:state / query / effect 逐字搬运,主 hook 同名解构,消费点不变。
import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { useFeedbacks } from "@/hooks/useFeedbacks";
import { useActiveIssueStore } from "./useActiveIssueStore";
import type { Viewport } from "./useViewportTransform";
import { resolvePinViewport } from "./useWorkbenchShellModel.helpers";

export function useIssuePins(params: {
  projectId: string | undefined;
  taskId: string | undefined;
  stageGeom: { imgW: number; imgH: number; vpSize: { w: number; h: number } };
  setVp: Dispatch<SetStateAction<Viewport>>;
  setVideoFrameIndex: (frame: number) => void;
  isVideoTask: boolean;
}) {
  const { projectId, taskId, stageGeom, setVp, setVideoFrameIndex, isVideoTask } = params;

  const [issueCreateOpen, setIssueCreateOpen] = useState(false);
  const [issuePinDropArmed, setIssuePinDropArmed] = useState(false);
  const [issuePinPrefill, setIssuePinPrefill] = useState<{ x: number; y: number } | null>(null);
  const issueListParams = useMemo(
    () => ({
      project_id: projectId ?? "",
      task_id: taskId,
      kind: "issue" as const,
    }),
    [projectId, taskId],
  );
  const issuesQuery = useFeedbacks(issueListParams, !!projectId && !!taskId);
  const openIssueCount = (issuesQuery.data?.items ?? []).filter((i) => i.status === "open").length;

  // v0.11.4 · DiscussionPanel issues tab ↔ IssueLayer 双向联动 store。
  // 列表单击 → focusTick++ → 定位到对应图钉并高亮。
  //   image: 把视口平移到图钉 (复用现有 vp/setVp + stageGeom)。
  //   video (v0.11.7): 先 seek 到 anchor_position.frame 命中的帧, 该帧的 VideoIssueLayer 图钉再显示。
  const activeIssueHighlightId = useActiveIssueStore((st) => st.highlightId);
  const highlightIssueFromPin = useActiveIssueStore((st) => st.highlightFromPin);
  const requestIssuesTab = useActiveIssueStore((st) => st.requestIssuesTab);
  const issueFocusTick = useActiveIssueStore((st) => st.focusTick);
  const lastIssueFocusRef = useRef(issueFocusTick);
  useEffect(() => {
    if (issueFocusTick === lastIssueFocusRef.current) return;
    lastIssueFocusRef.current = issueFocusTick;
    const target = (issuesQuery.data?.items ?? []).find((i) => i.id === activeIssueHighlightId);
    if (!target?.anchor_position) return;
    if (isVideoTask) {
      const frame = target.anchor_position.frame;
      if (typeof frame === "number") setVideoFrameIndex(frame);
      return;
    }
    const { imgW, imgH, vpSize } = stageGeom;
    if (!imgW || !imgH || !vpSize.w || !vpSize.h) return;
    setVp((cur) => resolvePinViewport(cur, target.anchor_position!, imgW, imgH, vpSize));
  }, [
    issueFocusTick,
    activeIssueHighlightId,
    issuesQuery.data,
    stageGeom,
    setVp,
    isVideoTask,
    setVideoFrameIndex,
  ]);

  return {
    issueCreateOpen,
    setIssueCreateOpen,
    issuePinDropArmed,
    setIssuePinDropArmed,
    issuePinPrefill,
    setIssuePinPrefill,
    issueListParams,
    issuesQuery,
    openIssueCount,
    activeIssueHighlightId,
    highlightIssueFromPin,
    requestIssuesTab,
  };
}
