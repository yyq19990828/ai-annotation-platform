import { useMemo, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { Badge } from "@/components/ui/Badge";
import type { ReviewingBatchItem } from "@/api/dashboard";

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
      <div style={{ padding: "32px 16px", textAlign: "center", color: "var(--color-fg-subtle)", fontSize: 12 }}>
        <Icon name="check" size={32} style={{ opacity: 0.25, marginBottom: 8 }} />
        <div>暂无可审核批次</div>
      </div>
    );
  }

  return (
    <div style={{ padding: "8px 4px" }}>
      <button
        type="button"
        onClick={() => onSelect(null)}
        style={{
          width: "100%",
          padding: "8px 12px",
          marginBottom: 6,
          borderRadius: "var(--radius-md)",
          border: "1px solid var(--color-border)",
          background: selectedBatchId === "" ? "var(--color-accent-soft)" : "transparent",
          color: "var(--color-fg)",
          fontFamily: "inherit",
          fontSize: 12.5,
          textAlign: "left",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        <Icon name="layers" size={12} />
        <span>全部待审任务</span>
      </button>

      {groups.map((g) => {
        const isCollapsed = collapsed.has(g.project_id) && g.project_id !== selectedProjectId;
        return (
          <div key={g.project_id} style={{ marginBottom: 4 }}>
            <button
              type="button"
              onClick={() => toggle(g.project_id)}
              style={{
                width: "100%",
                padding: "6px 10px",
                background: "transparent",
                border: "none",
                fontFamily: "inherit",
                fontSize: 12,
                fontWeight: 600,
                color: "var(--color-fg-muted)",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: 6,
                textAlign: "left",
              }}
            >
              <Icon name={isCollapsed ? "chevRight" : "chevDown"} size={11} />
              <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {g.project_name}
              </span>
              {g.pending > 0 && (
                <Badge variant="warning" style={{ fontSize: 10, padding: "0 6px" }}>{g.pending}</Badge>
              )}
            </button>

            {!isCollapsed && (
              <div style={{ marginLeft: 12, borderLeft: "1px solid var(--color-border-subtle, var(--color-border))" }}>
                {g.items.map((b) => {
                  const active = b.batch_id === selectedBatchId;
                  const remaining = Math.max(0, b.total_tasks - b.completed_tasks - b.review_tasks);
                  return (
                    <button
                      key={b.batch_id}
                      type="button"
                      onClick={() => onSelect(b)}
                      style={{
                        width: "100%",
                        padding: "8px 10px",
                        margin: "2px 0",
                        borderRadius: "var(--radius-sm)",
                        border: "none",
                        background: active ? "var(--color-accent-soft)" : "transparent",
                        color: "var(--color-fg)",
                        fontFamily: "inherit",
                        fontSize: 12.5,
                        textAlign: "left",
                        cursor: "pointer",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span className="mono" style={{ fontSize: 11, color: "var(--color-accent)", fontWeight: 600 }}>
                          {b.batch_display_id}
                        </span>
                        <span
                          style={{
                            flex: 1,
                            minWidth: 0,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {b.batch_name}
                        </span>
                        {b.review_tasks > 0 && (
                          <Badge variant="warning" style={{ fontSize: 10, padding: "0 5px" }}>
                            {b.review_tasks}
                          </Badge>
                        )}
                      </div>
                      <div style={{ fontSize: 10.5, color: "var(--color-fg-subtle)", marginTop: 2 }}>
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
