/**
 * v0.11.4 · DiscussionPanel issues tab。
 *
 * 列出 kind=issue 的 feedback (含 pixel 锚点)，按 status 过滤；
 * 单击列表项 → useActiveIssueStore.focusIssue → model 把视口平移到对应图钉并高亮。
 * 反向 (图钉单击) 写 store.highlightId，本列表对应行加亮 + 滚动可见。
 *
 * status 配色 / 卡片样式复用 IssueListPanel.module.css，避免重复定义 tokens。
 */
import { useMemo, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { Button } from "@/components/ui/Button";
import { useFeedbacks, usePatchFeedback, useDeleteFeedback } from "@/hooks/useFeedbacks";
import type { FeedbackStatus, ListFeedbacksParams } from "@/api/feedbacks";
import { useActiveIssueStore } from "../state/useActiveIssueStore";
import styles from "./IssueListPanel.module.css";

interface Props {
  projectId: string;
  taskId: string;
}

const STATUS_FILTERS: { key: FeedbackStatus | "all"; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "open", label: "未解决" },
  { key: "resolved", label: "已解决" },
  { key: "wont_fix", label: "搁置" },
];

export function DiscussionIssuesTab({ projectId, taskId }: Props) {
  const [statusFilter, setStatusFilter] = useState<FeedbackStatus | "all">("all");
  const params: ListFeedbacksParams = useMemo(
    () => ({ project_id: projectId, task_id: taskId, kind: "issue" }),
    [projectId, taskId],
  );
  const { data, isLoading, isError } = useFeedbacks(params);
  const patchMut = usePatchFeedback(params);
  const deleteMut = useDeleteFeedback(params);
  const highlightId = useActiveIssueStore((s) => s.highlightId);
  const focusIssue = useActiveIssueStore((s) => s.focusIssue);

  const items = data?.items ?? [];
  const filtered = statusFilter === "all" ? items : items.filter((i) => i.status === statusFilter);

  const setStatus = (id: string, next: FeedbackStatus) => {
    patchMut.mutate({ id, payload: { status: next } });
  };

  return (
    <div className={styles.list}>
      <div className={styles.filterRow}>
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setStatusFilter(f.key)}
            className={`${styles.filterChip} ${statusFilter === f.key ? styles.filterChipActive : ""}`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {isLoading && <div className={styles.muted}>加载中…</div>}
      {isError && <div className={styles.error}>加载失败</div>}
      {!isLoading && !isError && filtered.length === 0 && (
        <div className={styles.muted}>当前任务暂无 issue。在画布工具栏「落点」可记录第一条。</div>
      )}

      {filtered.map((it) => {
        const hasPin = it.anchor_type === "pixel" && !!it.anchor_position;
        return (
          <div
            key={it.id}
            ref={(node) => {
              if (highlightId === it.id && node) node.scrollIntoView({ block: "nearest" });
            }}
            onClick={() => { if (hasPin) focusIssue(it.id); }}
            className={`${styles.card} ${styles[`statusCard_${it.status}`] ?? ""}${highlightId === it.id ? " " + (styles.cardHighlighted ?? "") : ""}${hasPin ? " " + (styles.cardClickable ?? "") : ""}`}
            data-testid={`discussion-issue-card-${it.id}`}
          >
            <div className={styles.cardHeader}>
              <span className={`${styles.statusChip} ${styles[`status_${it.status}`] ?? ""}`}>
                {it.status === "open" ? "未解决" : it.status === "resolved" ? "已解决" : "搁置"}
              </span>
              {it.severity && (
                <span className={`${styles.sevChip} ${styles[`sev_${it.severity}`] ?? ""}`}>
                  {it.severity === "blocker" ? "阻断" : it.severity === "warn" ? "警告" : "提示"}
                </span>
              )}
              {hasPin && (
                <span className={styles.anchorChip} title="像素锚点 · 单击定位">
                  <Icon name="crosshair" size={11} /> ({it.anchor_position!.x.toFixed(2)}, {it.anchor_position!.y.toFixed(2)})
                </span>
              )}
              <span className={styles.author}>
                {it.author_name ?? "—"} · {new Date(it.created_at).toLocaleString()}
              </span>
            </div>
            {it.title && <div className={styles.cardTitle}>{it.title}</div>}
            <div className={styles.cardBody}>{it.body}</div>
            <div className={styles.cardActions} onClick={(e) => e.stopPropagation()}>
              {it.status !== "resolved" && (
                <Button variant="ghost" size="sm" onClick={() => setStatus(it.id, "resolved")} title="标为已解决">
                  <Icon name="check" size={11} /> 解决
                </Button>
              )}
              {it.status !== "wont_fix" && (
                <Button variant="ghost" size="sm" onClick={() => setStatus(it.id, "wont_fix")} title="搁置">
                  搁置
                </Button>
              )}
              {it.status !== "open" && (
                <Button variant="ghost" size="sm" onClick={() => setStatus(it.id, "open")} title="重开">
                  重开
                </Button>
              )}
              <Button variant="ghost" size="sm" onClick={() => deleteMut.mutate(it.id)} title="删除">
                <Icon name="trash" size={11} />
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
