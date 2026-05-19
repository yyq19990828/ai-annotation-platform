/**
 * I18 · 简易 issue 列表 (浮层卡片), 通过 WorkbenchShell 浮动按钮触发.
 * v0.10.20 后并入 DiscussionPanel Issues tab.
 */
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { useFeedbacks, usePatchFeedback, useDeleteFeedback } from "@/hooks/useFeedbacks";
import type { ListFeedbacksParams, FeedbackStatus } from "@/api/feedbacks";
import styles from "./IssueListPanel.module.css";

interface Props {
  open: boolean;
  projectId: string;
  taskId: string | undefined;
  onClose: () => void;
  onCreateNew: () => void;
}

export function IssueListPanel({ open, projectId, taskId, onClose, onCreateNew }: Props) {
  const params: ListFeedbacksParams = {
    project_id: projectId,
    task_id: taskId,
    kind: "issue",
  };
  const { data, isLoading, isError } = useFeedbacks(params, open);
  const patchMut = usePatchFeedback(params);
  const deleteMut = useDeleteFeedback(params);

  if (!open) return null;

  const items = data?.items ?? [];
  const openCount = items.filter((i) => i.status === "open").length;

  const setStatus = (id: string, next: FeedbackStatus) => {
    patchMut.mutate({ id, payload: { status: next } });
  };

  return (
    <div className={styles.backdrop} onClick={onClose} role="dialog" aria-modal="true">
      <div className={styles.panel} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <b className={styles.title}>
            <Icon name="flag" size={14} /> 问题列表 ({openCount} open / {items.length} 总)
          </b>
          <div className={styles.headerActions}>
            <Button size="sm" onClick={onCreateNew}><Icon name="plus" size={12} /> 新建</Button>
            <Button variant="ghost" size="sm" onClick={onClose}><Icon name="x" size={12} /></Button>
          </div>
        </div>

        <div className={styles.list}>
          {isLoading && <div className={styles.muted}>加载中…</div>}
          {isError && <div className={styles.error}>加载失败</div>}
          {!isLoading && !isError && items.length === 0 && (
            <div className={styles.muted}>当前任务暂无 issue。点「新建」记录第一条。</div>
          )}
          {items.map((it) => (
            <div key={it.id} className={`${styles.card} ${styles[`statusCard_${it.status}`] ?? ""}`}>
              <div className={styles.cardHeader}>
                <span className={`${styles.statusChip} ${styles[`status_${it.status}`] ?? ""}`}>
                  {it.status === "open" ? "未解决" : it.status === "resolved" ? "已解决" : "搁置"}
                </span>
                {it.severity && (
                  <span className={`${styles.sevChip} ${styles[`sev_${it.severity}`] ?? ""}`}>
                    {it.severity === "blocker" ? "阻断" : it.severity === "warn" ? "警告" : "提示"}
                  </span>
                )}
                {it.anchor_type === "pixel" && it.anchor_position && (
                  <span className={styles.anchorChip} title="像素锚点">
                    📍 ({it.anchor_position.x.toFixed(2)}, {it.anchor_position.y.toFixed(2)})
                  </span>
                )}
                <span className={styles.author}>
                  {it.author_name ?? "—"} · {new Date(it.created_at).toLocaleString()}
                </span>
              </div>
              {it.title && <div className={styles.cardTitle}>{it.title}</div>}
              <div className={styles.cardBody}>{it.body}</div>
              <div className={styles.cardActions}>
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
          ))}
        </div>
      </div>
    </div>
  );
}
