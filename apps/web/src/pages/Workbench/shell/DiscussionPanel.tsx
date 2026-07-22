import { useEffect, useRef, useState, type ComponentProps } from "react";
import { Icon } from "@/components/ui/Icon";
import { CommentsPanel } from "./CommentsPanel";
import { DiscussionIssuesTab } from "./DiscussionIssuesTab";
import { MaskQcPanel } from "./MaskQcPanel";
import { useActiveIssueStore } from "../state/useActiveIssueStore";

// 顶部 tab 切换条: 字号/字重与右栏上段"标注详情"标题 (text-sm font-semibold) 对齐,
// 视觉上作为同级标题。v0.20.22 · 拆分中性/激活分支下发, 避免 border-transparent 与
// border-brand 同挂被源顺序覆盖 (memory: "Tailwind 激活态色类冲突")。text 色同理。
const TAB_BUTTON_BASE =
  "cursor-pointer appearance-none border-0 border-b-2 bg-transparent px-2 py-1 text-sm font-semibold [font:inherit]";
const TAB_BUTTON_ACTIVE = "border-brand text-foreground";
const TAB_BUTTON_INACTIVE = "border-transparent text-muted-foreground";

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
type DiscussionTab = "comments" | "history" | "issues" | "mask_qc";

const TABS: { key: DiscussionTab; label: string }[] = [
  { key: "comments", label: "评论" },
  { key: "history", label: "历史" },
  { key: "issues", label: "Issue" },
  { key: "mask_qc", label: "Mask 质检" },
];

// v0.11.5+ · 评论内画布批注 (live 绘图) + 点评论跳帧 (video) 的桥接 props，
// 从 CommentsPanel 派生以保持同步。原在 AIInspectorPanel 内嵌时透传，去 flag 后
// 在此重新接上 (修复 v0.11.2 复用 CommentsPanel 时漏传导致的功能回退)。
type CommentsBridgeProps = Pick<
  ComponentProps<typeof CommentsPanel>,
  "backgroundUrl" | "imageWidth" | "imageHeight" | "enableCanvasDrawing" | "liveCanvas" | "commentAnchor" | "onSeekFrame"
>;

interface DiscussionPanelProps extends CommentsBridgeProps {
  maskQc?: ComponentProps<typeof MaskQcPanel>;
  annotationId: string | null;
  taskId: string | null;
  projectId: string | null;
  currentUserId: string | null;
  onDetach?: () => void;
  floating?: boolean;
  /** v0.20.22 · 完全收起态 (受控, 走 workbench.layout 持久); 缺省回落组件内会话态。
   *  收起时不渲染 tabpanel 内容区, 仅剩 tab 头一条。 */
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
}

export function DiscussionPanel({
  maskQc,
  annotationId, taskId, projectId, currentUserId,
  backgroundUrl, imageWidth, imageHeight, enableCanvasDrawing, liveCanvas, commentAnchor, onSeekFrame,
  onDetach,
  floating = false,
  collapsed: collapsedProp,
  onToggleCollapsed,
}: DiscussionPanelProps) {
  const [tab, setTab] = useState<DiscussionTab>(maskQc?.activeIssue ? "mask_qc" : "comments");
  // v0.20.22 · 受控优先 (走 workbench.layout 持久), 缺省回落组件内会话态 (测试/独立使用)。
  const [collapsedLocal, setCollapsedLocal] = useState(false);
  const collapsed = collapsedProp ?? collapsedLocal;
  const toggleCollapsed = onToggleCollapsed ?? (() => setCollapsedLocal((v) => !v));

  // v0.11.4 · 单击/hover IssueLayer 图钉 → store.tabRequestTick++ → 自动切到 issues tab。
  const tabRequestTick = useActiveIssueStore((s) => s.tabRequestTick);
  const lastTabRequestRef = useRef(tabRequestTick);
  useEffect(() => {
    if (tabRequestTick !== lastTabRequestRef.current) {
      lastTabRequestRef.current = tabRequestTick;
      setTab("issues");
      // v0.20.22 · IssueLayer 图钉切 tab 时若讨论区处于收起态, 顺手展开让用户看到 issue 列表。
      if (collapsed) toggleCollapsed();
    }
  // toggleCollapsed / collapsed 依赖漂移会引起循环触发, 故按 tick 一路径走。
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabRequestTick]);

  useEffect(() => {
    if (!maskQc && tab === "mask_qc") setTab("comments");
  }, [maskQc, tab]);

  useEffect(() => {
    if (!maskQc?.activeIssue) return;
    setTab("mask_qc");
    if (collapsed) toggleCollapsed();
  // An active QC navigation is an explicit request to expose this tab. The
  // collapsed callbacks are intentionally omitted to avoid replaying it.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maskQc?.activeIssue?.id]);

  return (
    <div
      className={`flex h-full min-h-0 flex-col bg-card ${floating ? "" : "border-t border-border"}`}
    >
      <div className="flex items-center justify-between gap-1 pl-2 pr-2 pt-1.5">
        <div className="flex items-center gap-1" role="tablist" aria-label="讨论面板">
          {!floating && (
            // v0.20.22 · 收起 chevron: 只在嵌入布局显示 (浮层已是独立窗口, 无收起语义)。
            <button
              type="button"
              onClick={toggleCollapsed}
              aria-expanded={!collapsed}
              title={collapsed ? "展开讨论" : "收起讨论"}
              data-testid="discussion-toggle-collapsed"
              className="inline-flex h-6 w-6 cursor-pointer appearance-none items-center justify-center rounded border-0 bg-transparent p-0 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <Icon name={collapsed ? "chevRight" : "chevDown"} size={13} />
            </button>
          )}
          {TABS.filter((t) => t.key !== "mask_qc" || maskQc).map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              className={`${TAB_BUTTON_BASE} ${tab === t.key ? TAB_BUTTON_ACTIVE : TAB_BUTTON_INACTIVE}`}
              onClick={() => {
                setTab(t.key);
                if (collapsed) toggleCollapsed();
              }}
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
      {/* v0.20.22 · 完全收起时不渲染 tabpanel, 仅留 tab 头一条; 展开由 chevron 或 IssueLayer 图钉触发。 */}
      {!collapsed && (
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto" role="tabpanel">
          {tab === "mask_qc" ? (
            maskQc ? <MaskQcPanel {...maskQc} /> : null
          ) : tab === "issues" ? (
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
      )}
    </div>
  );
}
