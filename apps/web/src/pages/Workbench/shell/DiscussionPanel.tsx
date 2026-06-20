import { useEffect, useRef, useState, type ComponentProps } from "react";
import { Icon } from "@/components/ui/Icon";
import { CommentsPanel } from "./CommentsPanel";
import { DiscussionIssuesTab } from "./DiscussionIssuesTab";
import { useActiveIssueStore } from "../state/useActiveIssueStore";

// 顶部 tab 切换条:小写 chrome 风格的下划线 tab(与 CommentsPanel 同形)。
const TAB_BUTTON =
  "cursor-pointer appearance-none border-0 border-b-2 border-transparent bg-transparent px-2 py-1 text-xs font-semibold uppercase tracking-[0.4px] text-muted-foreground [font:inherit]";
const TAB_BUTTON_ACTIVE = "border-brand text-foreground";

/**
 * v0.11.2-4 · B 组 · 工作台右栏下段统一讨论面板。
 *
 * 三个常驻 tab：
 *   - comments (v0.11.2)：复用 CommentsPanel 的评论能力 (hideTabs + forceTab)，
 *     annotationId 非 null → 标注级评论；null → 任务级评论 (合并 annotation_comments + feedback)。
 *   - history (v0.11.3)：同样复用 CommentsPanel 的历史时间线 (forceTab="history")，
 *     annotation 优先，null 降级查任务级 audit (GET /tasks/{id}/audit-history)。
 *   - issues (v0.11.4)：kind=issue feedback 列表 + status 过滤 + 与 IssueLayer 图钉双向联动。
 *
 * v0.11.5 转正：去 flag 成为右栏下段默认；旧浮层 IssueListPanel 路径已删，
 * CommentsPanel 保留作本面板 comments/history tab 的子渲染器。
 * 边界：只统一 comment + issue + history(audit)；bug / reject 刻意不进。
 */
type DiscussionTab = "comments" | "history" | "issues";

const TABS: { key: DiscussionTab; label: string }[] = [
  { key: "comments", label: "评论" },
  { key: "history", label: "历史" },
  { key: "issues", label: "Issue" },
];

// v0.11.5+ · 评论内画布批注 (live 绘图) + 点评论跳帧 (video) 的桥接 props，
// 从 CommentsPanel 派生以保持同步。原在 AIInspectorPanel 内嵌时透传，去 flag 后
// 在此重新接上 (修复 v0.11.2 复用 CommentsPanel 时漏传导致的功能回退)。
type CommentsBridgeProps = Pick<
  ComponentProps<typeof CommentsPanel>,
  "backgroundUrl" | "imageWidth" | "imageHeight" | "enableCanvasDrawing" | "liveCanvas" | "commentAnchor" | "onSeekFrame"
>;

interface DiscussionPanelProps extends CommentsBridgeProps {
  annotationId: string | null;
  taskId: string | null;
  projectId: string | null;
  currentUserId: string | null;
  onDetach?: () => void;
  floating?: boolean;
}

export function DiscussionPanel({
  annotationId, taskId, projectId, currentUserId,
  backgroundUrl, imageWidth, imageHeight, enableCanvasDrawing, liveCanvas, commentAnchor, onSeekFrame,
  onDetach,
  floating = false,
}: DiscussionPanelProps) {
  const [tab, setTab] = useState<DiscussionTab>("comments");

  // v0.11.4 · 单击/hover IssueLayer 图钉 → store.tabRequestTick++ → 自动切到 issues tab。
  const tabRequestTick = useActiveIssueStore((s) => s.tabRequestTick);
  const lastTabRequestRef = useRef(tabRequestTick);
  useEffect(() => {
    if (tabRequestTick !== lastTabRequestRef.current) {
      lastTabRequestRef.current = tabRequestTick;
      setTab("issues");
    }
  }, [tabRequestTick]);

  return (
    <div
      className={`flex h-full min-h-0 flex-col bg-card ${floating ? "" : "border-t border-border"}`}
    >
      <div className="flex items-center justify-between gap-1 pl-3 pr-2 pt-1.5">
        <div className="flex items-center gap-1" role="tablist" aria-label="讨论面板">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              className={`${TAB_BUTTON} ${tab === t.key ? TAB_BUTTON_ACTIVE : ""}`}
              onClick={() => setTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>
        {onDetach && (
          <button
            type="button"
            className="inline-flex h-6 w-6 cursor-pointer appearance-none items-center justify-center rounded border border-border bg-background p-0 text-muted-foreground hover:border-brand hover:text-brand"
            onClick={onDetach}
            title="分离讨论面板"
            aria-label="分离讨论面板"
          >
            <Icon name="pictureInPicture2" size={13} />
          </button>
        )}
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto" role="tabpanel">
        {tab === "issues" ? (
          projectId && taskId ? (
            <DiscussionIssuesTab projectId={projectId} taskId={taskId} />
          ) : null
        ) : (
          <CommentsPanel
            annotationId={annotationId}
            taskId={taskId}
            projectId={projectId}
            currentUserId={currentUserId ?? undefined}
            backgroundUrl={backgroundUrl}
            imageWidth={imageWidth}
            imageHeight={imageHeight}
            enableCanvasDrawing={enableCanvasDrawing}
            liveCanvas={liveCanvas}
            commentAnchor={commentAnchor}
            onSeekFrame={onSeekFrame}
            hideTabs
            forceTab={tab}
          />
        )}
      </div>
    </div>
  );
}
