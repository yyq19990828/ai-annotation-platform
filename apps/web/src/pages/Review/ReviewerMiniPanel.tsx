/**
 * v0.8.7 F5.3 · Reviewer 实时 mini 仪表（在 ReviewWorkbench 右侧栏渲染）。
 *
 * 三个数：本日通过 / 本日退回 / 平均审核耗时秒。
 * 20s 自动 refetch（useReviewerTodayMini staleTime+interval）。
 */
import { useReviewerTodayMini } from "@/hooks/useDashboard";

function formatSeconds(s: number | null): string {
  if (s === null || !Number.isFinite(s)) return "—";
  if (s < 60) return `${Math.round(s)} s`;
  const m = Math.floor(s / 60);
  const rest = Math.round(s - m * 60);
  return `${m}m ${rest}s`;
}

export function ReviewerMiniPanel() {
  const { data, isLoading } = useReviewerTodayMini();
  const approved = data?.approved_today ?? 0;
  const rejected = data?.rejected_today ?? 0;
  const avg = data?.avg_review_seconds ?? null;

  return (
    <div
      data-testid="reviewer-mini-panel"
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(3, 1fr)",
        gap: 8,
        padding: "10px 12px",
        background: "var(--color-bg-elev)",
        borderBottom: "1px solid var(--color-border)",
        fontSize: 11,
      }}
    >
      <Stat label="今日通过" value={isLoading ? "…" : approved.toString()} accent="success" />
      <Stat label="今日退回" value={isLoading ? "…" : rejected.toString()} accent="danger" />
      <Stat label="平均耗时" value={isLoading ? "…" : formatSeconds(avg)} accent="muted" />
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent: "success" | "danger" | "muted";
}) {
  const color =
    accent === "success"
      ? "var(--color-success, #22c55e)"
      : accent === "danger"
        ? "var(--color-danger, #ef4444)"
        : "var(--color-fg-muted)";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <span style={{ color: "var(--color-fg-subtle)", fontSize: 10 }}>{label}</span>
      <span
        className="mono"
        style={{
          fontSize: 16,
          fontWeight: 600,
          color,
        }}
      >
        {value}
      </span>
    </div>
  );
}
