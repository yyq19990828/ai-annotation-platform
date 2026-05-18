/**
 * v0.8.7 F5.3 · Reviewer 实时 mini 仪表（在 ReviewWorkbench 右侧栏渲染）。
 *
 * 三个数：本日通过 / 本日退回 / 平均审核耗时秒。
 * 20s 自动 refetch（useReviewerTodayMini staleTime+interval）。
 */
import { useReviewerTodayMini } from "@/hooks/useDashboard";
import styles from "./ReviewerMiniPanel.module.css";

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
      className={styles.panel}
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
  const accentClass =
    accent === "success"
      ? styles.valueSuccess
      : accent === "danger"
        ? styles.valueDanger
        : styles.valueMuted;
  return (
    <div className={styles.stat}>
      <span className={styles.label}>{label}</span>
      <span
        className={`mono ${styles.value} ${accentClass}`}
      >
        {value}
      </span>
    </div>
  );
}
