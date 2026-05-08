/**
 * v0.9.7 · AIPreAnnotate 顶部水平 stepper.
 *
 * 4 步进度引导, 不强制翻页(admin 重复使用同一项目跑多次预标, 强制 wizard
 * 翻页反而麻烦). 点徽章滚到对应 anchor section.
 */

import { Icon } from "@/components/ui/Icon";
import { FS_XS, FS_SM } from "../styles";

export type StepStatus = "pending" | "active" | "complete";

export interface StepDef {
  id: 1 | 2 | 3 | 4;
  label: string;
  anchor: string;
  status: StepStatus;
}

interface Props {
  steps: StepDef[];
}

export function PreannotateStepper({ steps }: Props) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "10px 14px",
        background: "var(--color-bg-elev)",
        border: "1px solid var(--color-border)",
        borderRadius: "var(--radius-lg)",
        boxShadow: "var(--shadow-sm)",
        overflowX: "auto",
      }}
      role="navigation"
      aria-label="预标流程"
    >
      {steps.map((s, i) => (
        <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 6, flex: "0 0 auto" }}>
          <button
            type="button"
            onClick={() => scrollToAnchor(s.anchor)}
            style={badgeButtonStyle(s.status)}
            aria-current={s.status === "active" ? "step" : undefined}
            aria-label={`第 ${s.id} 步：${s.label}`}
          >
            <span style={badgeCircleStyle(s.status)}>
              {s.status === "complete" ? <Icon name="check" size={11} /> : s.id}
            </span>
            <span style={{ fontSize: FS_SM, fontWeight: s.status === "active" ? 600 : 500 }}>
              {s.label}
            </span>
          </button>
          {i < steps.length - 1 && (
            <span
              aria-hidden
              style={{
                width: 24,
                height: 1,
                background:
                  s.status === "complete" ? "var(--color-ai)" : "var(--color-border)",
                flex: "0 0 auto",
              }}
            />
          )}
        </div>
      ))}
    </div>
  );
}

function scrollToAnchor(anchor: string) {
  const el = document.querySelector(anchor);
  if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
}

function badgeButtonStyle(status: StepStatus): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    padding: "4px 10px 4px 4px",
    background: "transparent",
    border: "none",
    borderRadius: "var(--radius-pill)",
    cursor: "pointer",
    color:
      status === "active"
        ? "var(--color-fg)"
        : status === "complete"
          ? "var(--color-fg-muted)"
          : "var(--color-fg-subtle)",
    fontFamily: "inherit",
    transition: "background 120ms ease",
  };
}

function badgeCircleStyle(status: StepStatus): React.CSSProperties {
  const base: React.CSSProperties = {
    width: 22,
    height: 22,
    borderRadius: "50%",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: FS_XS,
    fontWeight: 600,
    transition: "background 120ms ease, color 120ms ease",
    flex: "0 0 auto",
  };
  if (status === "complete") {
    return {
      ...base,
      background: "var(--color-ai)",
      color: "#fff",
    };
  }
  if (status === "active") {
    return {
      ...base,
      background: "var(--color-ai-soft)",
      color: "var(--color-ai)",
      border: "1.5px solid var(--color-ai)",
    };
  }
  return {
    ...base,
    background: "var(--color-bg-sunken)",
    color: "var(--color-fg-subtle)",
    border: "1px solid var(--color-border)",
  };
}
