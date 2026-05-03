import { useMemo, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { Badge } from "@/components/ui/Badge";
import type { MyBatchItem } from "@/api/dashboard";

interface Props {
  batches: MyBatchItem[];
  selectedBatchId: string;
  onSelect: (b: MyBatchItem | null) => void;
}

interface Group {
  project_id: string;
  project_name: string;
  items: MyBatchItem[];
  remaining: number;
}

const STATUS_COLOR: Record<string, "accent" | "warning" | "danger" | "outline"> = {
  active: "outline",
  annotating: "accent",
  reviewing: "warning",
  rejected: "danger",
};

/** v0.7.1 · 标注工作台左侧栏：项目→批次的两级树（与 ReviewSidebar 对位）。
 *  仅展示我手里的批次（active / annotating / rejected / reviewing）。 */
export function AnnotateSidebar({ batches, selectedBatchId, onSelect }: Props) {
  const groups = useMemo<Group[]>(() => {
    const m = new Map<string, Group>();
    for (const b of batches) {
      const remaining = Math.max(0, b.total_tasks - b.completed_tasks);
      const g = m.get(b.project_id) ?? {
        project_id: b.project_id,
        project_name: b.project_name,
        items: [],
        remaining: 0,
      };
      g.items.push(b);
      g.remaining += remaining;
      m.set(b.project_id, g);
    }
    const arr = [...m.values()];
    arr.sort(
      (a, b) => b.remaining - a.remaining || a.project_name.localeCompare(b.project_name),
    );
    const STATUS_ORDER: Record<string, number> = {
      annotating: 0,
      rejected: 1,
      active: 2,
      reviewing: 3,
    };
    for (const g of arr) {
      g.items.sort((a, b) => {
        const ra = STATUS_ORDER[a.status] ?? 9;
        const rb = STATUS_ORDER[b.status] ?? 9;
        if (ra !== rb) return ra - rb;
        return a.batch_display_id.localeCompare(b.batch_display_id);
      });
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
        <Icon name="inbox" size={32} style={{ opacity: 0.25, marginBottom: 8 }} />
        <div>暂无分派批次</div>
        <div style={{ fontSize: 11, marginTop: 4 }}>请联系项目管理员将你加入批次</div>
      </div>
    );
  }

  return (
    <div style={{ padding: "8px 4px" }}>
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
              {g.remaining > 0 && (
                <Badge variant="accent" style={{ fontSize: 10, padding: "0 6px" }}>{g.remaining}</Badge>
              )}
            </button>

            {!isCollapsed && (
              <div style={{ marginLeft: 12, borderLeft: "1px solid var(--color-border-subtle, var(--color-border))" }}>
                {g.items.map((b) => {
                  const active = b.batch_id === selectedBatchId;
                  const remaining = Math.max(0, b.total_tasks - b.completed_tasks);
                  const variant = STATUS_COLOR[b.status] ?? "outline";
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
                        <Badge variant={variant} style={{ fontSize: 10, padding: "0 5px" }}>
                          {b.status === "annotating" ? "进行" : b.status === "rejected" ? "驳回" : b.status === "reviewing" ? "送审" : "未启"}
                        </Badge>
                      </div>
                      <div style={{ fontSize: 10.5, color: "var(--color-fg-subtle)", marginTop: 2 }}>
                        共 {b.total_tasks} · 完成 {b.completed_tasks}
                        {remaining > 0 && ` · 待标 ${remaining}`}
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
