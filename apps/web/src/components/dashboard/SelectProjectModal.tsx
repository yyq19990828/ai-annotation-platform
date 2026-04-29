import { Modal } from "@/components/ui/Modal";
import { Badge } from "@/components/ui/Badge";
import { Icon } from "@/components/ui/Icon";
import type { ProjectResponse } from "@/api/projects";

interface Props {
  open: boolean;
  onClose: () => void;
  projects: ProjectResponse[];
  onPick: (id: string) => void;
}

export function SelectProjectModal({ open, onClose, projects, onPick }: Props) {
  return (
    <Modal open={open} onClose={onClose} title="选择项目开始标注" width={560}>
      {projects.length === 0 ? (
        <div style={{ padding: 24, textAlign: "center", color: "var(--color-fg-subtle)" }}>
          暂无分配项目
        </div>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {projects.map((p) => {
            const remaining = Math.max(0, (p.total_tasks ?? 0) - (p.completed_tasks ?? 0));
            return (
              <li key={p.id}>
                <button
                  onClick={() => { onPick(p.id); onClose(); }}
                  style={{
                    width: "100%",
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "12px 14px",
                    border: "1px solid var(--color-border)",
                    borderRadius: "var(--radius-md)",
                    background: "var(--color-bg-elev)",
                    cursor: "pointer",
                    marginBottom: 8,
                    fontFamily: "inherit",
                    color: "var(--color-fg)",
                    textAlign: "left",
                  }}
                >
                  <Icon name="folder" size={16} style={{ color: "var(--color-fg-muted)" }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 500 }}>{p.name}</div>
                    <div style={{ fontSize: 11.5, color: "var(--color-fg-subtle)" }}>
                      <span className="mono">{p.display_id}</span> · {p.type_label}
                    </div>
                  </div>
                  <Badge variant={remaining > 0 ? "accent" : "outline"} style={{ fontSize: 11 }}>
                    待标 {remaining}
                  </Badge>
                  <Icon name="chevRight" size={13} style={{ color: "var(--color-fg-subtle)" }} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Modal>
  );
}
