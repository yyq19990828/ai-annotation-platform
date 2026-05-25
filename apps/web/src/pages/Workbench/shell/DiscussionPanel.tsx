import { useState } from "react";
import styles from "./DiscussionPanel.module.css";

/**
 * v0.11.1 · B 组 · 工作台右栏下段统一讨论面板（骨架）。
 *
 * 只搭 Tabs 外壳：comments | history | issues。本切片不迁移任何数据/逻辑，
 * 内容区只放占位；逐 tab 内容在 v0.11.2（comments）/ v0.11.3（history）/ v0.11.4（issues）落地。
 *
 * 边界（B 组）：只统一绑当前 task/标注的 comment + issue + history(audit)；
 * bug（BugReportDrawer）与 reject（审核状态机）刻意不进。
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

export function DiscussionPanel(_props: DiscussionPanelProps) {
  const [tab, setTab] = useState<DiscussionTab>("comments");

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
        <span className={styles.placeholder}>即将上线</span>
      </div>
    </div>
  );
}
