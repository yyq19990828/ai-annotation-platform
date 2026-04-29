import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import type { TaskResponse } from "@/types";
import { classColor } from "../stage/colors";

interface TaskQueuePanelProps {
  open: boolean;
  projectName: string;
  projectDisplayId: string;
  classes: string[];
  activeClass: string;
  tasks: TaskResponse[];
  taskId: string | undefined;
  taskIdx: number;
  onBack: () => void;
  onToggle: () => void;
  onSetActiveClass: (c: string) => void;
  onSelectTask: (id: string) => void;
}

const stripStyle: React.CSSProperties = {
  display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
  height: "100%", gap: 8, cursor: "pointer", userSelect: "none",
  background: "var(--color-bg-elev)", border: "none", width: "100%", padding: 0,
  color: "var(--color-fg-muted)",
};

export function TaskQueuePanel({
  open, projectName, projectDisplayId, classes, activeClass,
  tasks, taskId, taskIdx,
  onBack, onToggle, onSetActiveClass, onSelectTask,
}: TaskQueuePanelProps) {
  if (!open) {
    return (
      <div style={{ borderRight: "1px solid var(--color-border)", overflow: "hidden" }}>
        <button onClick={onToggle} title="展开任务列表" style={stripStyle}>
          <Icon name="chevRight" size={13} />
          <span style={{ fontSize: 10, writingMode: "vertical-rl", letterSpacing: 1, opacity: 0.6 }}>任务列表</span>
        </button>
      </div>
    );
  }

  return (
    <div
      style={{
        background: "var(--color-bg-elev)", borderRight: "1px solid var(--color-border)",
        display: "flex", flexDirection: "column", overflow: "hidden",
      }}
    >
      <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--color-border)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
          <Button variant="ghost" size="sm" onClick={onBack} style={{ padding: "2px 6px" }}>
            <Icon name="chevLeft" size={11} />返回总览
          </Button>
          <Button variant="ghost" size="sm" onClick={onToggle} title="收起任务列表" style={{ padding: "2px 6px" }}>
            <Icon name="chevLeft" size={11} />
          </Button>
        </div>
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>{projectName}</div>
        <div style={{ fontSize: 11, color: "var(--color-fg-muted)" }}>
          <span className="mono">{projectDisplayId}</span> · {classes.length} 个类别
        </div>
      </div>

      <div style={{ padding: "10px 14px 6px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ fontSize: 12, fontWeight: 600 }}>任务队列</div>
        <span className="mono" style={{ fontSize: 11, color: "var(--color-fg-subtle)" }}>{taskIdx + 1} / {tasks.length}</span>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "0 8px 10px" }}>
        {tasks.map((t) => {
          const isActive = t.id === taskId;
          const statusLabel =
            t.status === "completed" ? "已完成"
            : t.status === "review" ? "待审核"
            : t.total_annotations > 0 ? "进行中"
            : t.total_predictions > 0 ? "AI 已预标"
            : "未开始";
          return (
            <div
              key={t.id}
              onClick={() => onSelectTask(t.id)}
              style={{
                padding: "8px 10px", margin: "2px 0",
                borderRadius: "var(--radius-md)",
                background: isActive ? "var(--color-accent-soft)" : "transparent",
                border: "1px solid " + (isActive ? "oklch(0.85 0.06 252)" : "transparent"),
                cursor: "pointer",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span className="mono" style={{ fontSize: 11.5, fontWeight: 500 }}>{t.display_id}</span>
                {t.total_annotations > 0 && (
                  <Badge variant="accent" style={{ fontSize: 10, padding: "1px 6px" }}>{t.total_annotations}</Badge>
                )}
              </div>
              <div style={{ fontSize: 11, color: "var(--color-fg-muted)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {t.file_name}
              </div>
              <div style={{ fontSize: 10.5, color: isActive ? "var(--color-accent-fg)" : "var(--color-fg-subtle)", marginTop: 2 }}>
                {statusLabel}
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ borderTop: "1px solid var(--color-border)", padding: "10px 14px" }}>
        <div style={{ fontSize: 11, color: "var(--color-fg-muted)", marginBottom: 6 }}>类别 (按数字键切换)</div>
        {classes.map((c, i) => (
          <div
            key={c}
            onClick={() => onSetActiveClass(c)}
            style={{
              display: "flex", alignItems: "center", gap: 8,
              padding: "5px 8px", borderRadius: "var(--radius-sm)", cursor: "pointer",
              background: activeClass === c ? "var(--color-bg-sunken)" : "transparent",
              fontSize: 12.5,
            }}
          >
            <span style={{ width: 10, height: 10, borderRadius: 2, background: classColor(c) }} />
            <span style={{ flex: 1 }}>{c}</span>
            <span style={{
              display: "inline-block", padding: "1px 5px",
              background: "var(--color-bg-sunken)", border: "1px solid var(--color-border)",
              borderBottomWidth: 2, borderRadius: 3,
              fontFamily: "var(--font-mono)", fontSize: 10.5, color: "var(--color-fg-muted)", lineHeight: 1,
            }}>{i + 1}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
