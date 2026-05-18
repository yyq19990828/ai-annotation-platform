import { useMemo, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { Badge } from "@/components/ui/Badge";
import type { ReviewingBatchItem } from "@/api/dashboard";
import styles from "./ReviewSidebar.module.css";

interface Props {
  batches: ReviewingBatchItem[];
  selectedBatchId: string;
  onSelect: (b: ReviewingBatchItem | null) => void;
}

interface Group {
  project_id: string;
  project_name: string;
  items: ReviewingBatchItem[];
  pending: number;
}

/** v0.7.1 B-18 · 质检审核左侧栏：项目→批次的两级树。
 *  自动展开当前选中批次所在的项目；其他项目默认折叠。 */
export function ReviewSidebar({ batches, selectedBatchId, onSelect }: Props) {
  const groups = useMemo<Group[]>(() => {
    const m = new Map<string, Group>();
    for (const b of batches) {
      const g = m.get(b.project_id) ?? {
        project_id: b.project_id,
        project_name: b.project_name,
        items: [],
        pending: 0,
      };
      g.items.push(b);
      g.pending += b.review_tasks;
      m.set(b.project_id, g);
    }
    const arr = [...m.values()];
    arr.sort((a, b) => b.pending - a.pending || a.project_name.localeCompare(b.project_name));
    for (const g of arr) {
      g.items.sort((a, b) => b.review_tasks - a.review_tasks || a.batch_display_id.localeCompare(b.batch_display_id));
    }
    return arr;
  }, [batches]);

  const selectedProjectId = useMemo(
    () => batches.find((b) => b.batch_id === selectedBatchId)?.project_id ?? null,
    [batches, selectedBatchId],
  );

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggle = (pid: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(pid)) next.delete(pid);
      else next.add(pid);
      return next;
    });

  if (batches.length === 0) {
    return (
      <div className={styles.emptyState}>
        <Icon name="check" size={32} className={styles.emptyIcon} />
        <div>暂无可审核批次</div>
      </div>
    );
  }

  return (
    <div className={styles.root}>
      <button
        type="button"
        onClick={() => onSelect(null)}
        className={`${styles.allButton} ${selectedBatchId === "" ? styles.allButtonActive : ""}`}
      >
        <Icon name="layers" size={12} />
        <span>全部待审任务</span>
      </button>

      {groups.map((g) => {
        const isCollapsed = collapsed.has(g.project_id) && g.project_id !== selectedProjectId;
        return (
          <div key={g.project_id} className={styles.projectGroup}>
            <button
              type="button"
              onClick={() => toggle(g.project_id)}
              className={styles.projectButton}
            >
              <Icon name={isCollapsed ? "chevRight" : "chevDown"} size={11} />
              <span className={styles.ellipsis}>
                {g.project_name}
              </span>
              {g.pending > 0 && (
                <span className={styles.countBadge}>
                  <Badge variant="warning">{g.pending}</Badge>
                </span>
              )}
            </button>

            {!isCollapsed && (
              <div className={styles.batchList}>
                {g.items.map((b) => {
                  const active = b.batch_id === selectedBatchId;
                  const remaining = Math.max(0, b.total_tasks - b.completed_tasks - b.review_tasks);
                  return (
                    <button
                      key={b.batch_id}
                      type="button"
                      onClick={() => onSelect(b)}
                      className={`${styles.batchButton} ${active ? styles.batchButtonActive : ""}`}
                    >
                      <div className={styles.batchTitleRow}>
                        <span className={`mono ${styles.batchId}`}>
                          {b.batch_display_id}
                        </span>
                        <span className={styles.batchName}>
                          {b.batch_name}
                        </span>
                        {b.review_tasks > 0 && (
                          <span className={styles.statusBadge}>
                            <Badge variant="warning">
                              {b.review_tasks}
                            </Badge>
                          </span>
                        )}
                      </div>
                      <div className={styles.batchMeta}>
                        共 {b.total_tasks} 任务 · 完成 {b.completed_tasks}
                        {remaining > 0 && ` · 未交 ${remaining}`}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
