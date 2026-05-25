import { useEffect, useRef, useState } from "react";
import { CommentsPanel } from "./CommentsPanel";
import { DiscussionIssuesTab } from "./DiscussionIssuesTab";
import { useActiveIssueStore } from "../state/useActiveIssueStore";
import styles from "./DiscussionPanel.module.css";

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
 * 仍在 DISCUSSION_PANEL_ENABLED flag 后；旧 CommentsPanel/IssueListPanel 路径保留 (v0.11.5 才删)。
 * 边界：只统一 comment + issue + history(audit)；bug / reject 刻意不进。
 */
type DiscussionTab = "comments" | "history" | "issues";

const TABS: { key: DiscussionTab; label: string }[] = [
  { key: "comments", label: "评论" },
  { key: "history", label: "历史" },
  { key: "issues", label: "Issue" },
];

interface DiscussionPanelProps {
  annotationId: string | null;
  taskId: string | null;
  projectId: string | null;
  currentUserId: string | null;
}

export function DiscussionPanel({ annotationId, taskId, projectId, currentUserId }: DiscussionPanelProps) {
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
    <div className={styles.panel}>
      <div className={styles.tabRow} role="tablist" aria-label="讨论面板">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            className={`${styles.tabButton} ${tab === t.key ? styles.tabButtonActive : ""}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className={styles.content} role="tabpanel">
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
            hideTabs
            forceTab={tab}
          />
        )}
      </div>
    </div>
  );
}
