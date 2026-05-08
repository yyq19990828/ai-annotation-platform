/**
 * v0.9.8 · Topbar 全局预标 job 徽章.
 *
 * 紫色徽章显示 in-progress job 数, 0 时不渲染. 点击展开 popover 列每个 job
 * (项目名 / 进度 / 跳转链接), 让 admin 跑完后切到别处也能看到。
 */

import { useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { Icon } from "@/components/ui/Icon";
import { useGlobalPreannotationJobs } from "@/hooks/useGlobalPreannotationJobs";

export function PreannotateJobsBadge() {
  const { runningJobs } = useGlobalPreannotationJobs();
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  const sorted = useMemo(
    () => [...runningJobs].sort((a, b) => b.receivedAt - a.receivedAt),
    [runningJobs],
  );

  if (runningJobs.length === 0) return null;

  const jumpToProject = (projectId: string) => {
    setOpen(false);
    navigate(`/ai-pre?project_id=${projectId}`);
  };

  return (
    <div style={{ position: "relative" }}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        title={`${runningJobs.length} 个预标 job 进行中`}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          padding: "4px 9px",
          background: "color-mix(in oklab, var(--color-ai) 18%, transparent)",
          border: "1px solid var(--color-ai)",
          borderRadius: 999,
          color: "var(--color-ai)",
          cursor: "pointer",
          fontSize: 11,
          fontWeight: 600,
          lineHeight: 1.2,
        }}
      >
        <Icon name="sparkles" size={12} />
        <span>{runningJobs.length}</span>
      </button>

      {open && (
        <>
          <div
            onClick={() => setOpen(false)}
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 200,
            }}
          />
          <div
            role="dialog"
            aria-label="预标进行中"
            style={{
              position: "absolute",
              right: 0,
              top: "calc(100% + 6px)",
              zIndex: 201,
              minWidth: 320,
              maxWidth: 400,
              background: "var(--color-bg-elevated)",
              border: "1px solid var(--color-border)",
              borderRadius: "var(--radius-md)",
              boxShadow: "var(--shadow-lg)",
              padding: 8,
              display: "flex",
              flexDirection: "column",
              gap: 4,
            }}
          >
            <div
              style={{
                padding: "6px 10px 8px",
                fontSize: 11,
                fontWeight: 600,
                color: "var(--color-fg-muted)",
                borderBottom: "1px solid var(--color-border)",
              }}
            >
              预标进行中 ({runningJobs.length})
            </div>
            {sorted.map((j) => {
              const pct = j.total > 0 ? Math.round((j.current / j.total) * 100) : 0;
              return (
                <button
                  key={j.job_id}
                  type="button"
                  onClick={() => jumpToProject(j.project_id)}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "stretch",
                    gap: 4,
                    padding: "8px 10px",
                    border: "none",
                    background: "transparent",
                    color: "var(--color-fg)",
                    textAlign: "left",
                    borderRadius: "var(--radius-sm)",
                    cursor: "pointer",
                    transition: "background 120ms ease",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "var(--color-bg-sunken)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "transparent";
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 12,
                      fontSize: 12,
                      fontWeight: 500,
                    }}
                  >
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {j.project_name ?? j.project_id.slice(0, 8)}
                    </span>
                    <span style={{ color: "var(--color-fg-muted)", fontVariantNumeric: "tabular-nums" }}>
                      {j.current}/{j.total} · {pct}%
                    </span>
                  </div>
                  <div
                    style={{
                      height: 3,
                      background: "var(--color-border)",
                      borderRadius: 2,
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        height: "100%",
                        width: `${pct}%`,
                        background: "var(--color-ai)",
                        transition: "width 200ms ease",
                      }}
                    />
                  </div>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
