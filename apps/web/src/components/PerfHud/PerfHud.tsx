import { useMemo, useState, type CSSProperties } from "react";
import { clsx } from "clsx";
import { Sparkline } from "@/components/ui/Sparkline";
import { useElementStyle } from "@/components/ui/useElementStyle";
import { useAuthStore } from "@/stores/authStore";
import { useMLBackendStats, type BackendSnapshot, type BackendHistory } from "./useMLBackendStats";
import { usePerfHudStore } from "./usePerfHudStore";
import styles from "./PerfHud.module.css";

/**
 * v0.9.11 · PerfHud GPU MVP 浮窗.
 *
 * 触发: Ctrl+Shift+P (workbench) / TopBar gear → "性能监控" / programmatic open.
 * 权限 gating: super_admin / project_admin only (其他角色 store 即便 open 也不渲染).
 * 数据源: /ws/ml-backend-stats, 1s 粒度. 关闭即断, 后端 Celery beat skip.
 */

function colorFor(pct: number | null | undefined): string {
  if (pct == null) return "var(--color-fg-muted, #888)";
  if (pct >= 90) return "var(--color-danger, #e54d4d)";
  if (pct >= 70) return "var(--color-warning, #e6a700)";
  return "var(--color-success, #2da44e)";
}

function MetricBar({
  label,
  value,
  unit,
  pct,
}: {
  label: string;
  value: string;
  unit?: string;
  pct: number | null | undefined;
}) {
  const color = colorFor(pct);
  const valueRef = useElementStyle<HTMLSpanElement>({ "--perf-hud-metric-color": color } as CSSProperties);
  const fillRef = useElementStyle<HTMLDivElement>({
    "--perf-hud-metric-width": `${Math.max(0, Math.min(100, pct ?? 0))}%`,
    "--perf-hud-metric-color": color,
  } as CSSProperties);
  return (
    <div className={styles.metric}>
      <div className={styles.metricHeader}>
        <span>{label}</span>
        <span ref={valueRef} className={styles.metricValue}>
          {value}
          {unit ? <span className={styles.metricUnit}>{unit}</span> : null}
        </span>
      </div>
      <div className={styles.metricTrack}>
        <div ref={fillRef} className={styles.metricFill} />
      </div>
    </div>
  );
}

function BackendPanel({
  snap,
  hist,
  expanded,
}: {
  snap: BackendSnapshot;
  hist: BackendHistory | undefined;
  expanded: boolean;
}) {
  const gpuUtil = snap.gpu_info?.gpu_utilization_percent ?? null;
  const vramUsed = snap.gpu_info?.memory_used_mb ?? null;
  const vramTotal = snap.gpu_info?.memory_total_mb ?? null;
  const vramPct = vramUsed != null && vramTotal ? (vramUsed / vramTotal) * 100 : null;
  const cpu = snap.host?.container_cpu_percent ?? null;
  const mem = snap.host?.container_memory_percent ?? null;
  const temp = snap.gpu_info?.gpu_temperature_celsius;
  const power = snap.gpu_info?.gpu_power_watts;
  const hitRate = snap.cache?.hit_rate;

  return (
    <div className={styles.backendPanel}>
      <MetricBar
        label="GPU util"
        value={gpuUtil != null ? `${gpuUtil}%` : "—"}
        pct={gpuUtil}
      />
      <MetricBar
        label="VRAM"
        value={vramUsed != null && vramTotal ? `${vramUsed} / ${vramTotal}` : "—"}
        unit="MB"
        pct={vramPct}
      />
      <MetricBar
        label="CPU"
        value={cpu != null ? `${cpu.toFixed(1)}%` : "—"}
        pct={cpu}
      />
      <MetricBar
        label="RAM"
        value={mem != null ? `${mem.toFixed(1)}%` : "—"}
        pct={mem}
      />
      {expanded && hist ? (
        <div className={styles.sparkGrid}>
          <SparkRow label="GPU" values={hist.gpuUtil} color="var(--color-success, #2da44e)" />
          <SparkRow label="VRAM" values={hist.vramPercent} color="var(--color-accent, #5e92ff)" />
          <SparkRow label="CPU" values={hist.cpu} color="var(--color-warning, #e6a700)" />
          <SparkRow label="RAM" values={hist.mem} color="var(--color-danger, #e54d4d)" />
        </div>
      ) : null}
      <div className={styles.backendMeta}>
        {snap.gpu_info?.device_name ? <span>{snap.gpu_info.device_name}</span> : null}
        {temp != null ? <span>· {temp}°C</span> : null}
        {power != null ? <span>· {power}W</span> : null}
        {hitRate != null ? <span>· cache {(hitRate * 100).toFixed(0)}%</span> : null}
        {snap.model_version ? <span>· {snap.model_version}</span> : null}
      </div>
    </div>
  );
}

function SparkRow({ label, values, color }: { label: string; values: number[]; color: string }) {
  if (values.length < 2) return null;
  return (
    <div className={styles.sparkRow}>
      <span className={styles.sparkLabel}>{label}</span>
      <Sparkline values={values} color={color} width={220} height={20} />
    </div>
  );
}

export function PerfHud() {
  const visible = usePerfHudStore((s) => s.visible);
  const expanded = usePerfHudStore((s) => s.expanded);
  const close = usePerfHudStore((s) => s.close);
  const setExpanded = usePerfHudStore((s) => s.setExpanded);
  const role = useAuthStore((s) => s.user?.role);
  const isAdmin = role === "super_admin" || role === "project_admin";

  const { snapshots, history, connected, status } = useMLBackendStats();
  const backendIds = useMemo(() => Object.keys(snapshots), [snapshots]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const activeId = selectedId ?? backendIds[0] ?? null;
  const activeSnap = activeId ? snapshots[activeId] : null;
  const activeHist = activeId ? history[activeId] : undefined;

  if (!visible || !isAdmin) return null;

  return (
    <div
      role="dialog"
      aria-label="GPU 性能监控"
      className={clsx(styles.panel, expanded && styles.panelExpanded)}
    >
      <div className={styles.header}>
        <span
          aria-hidden
          title={connected ? "实时连接中" : "未连接"}
          className={clsx(styles.statusDot, connected && styles.statusDotConnected)}
        />
        <span className={styles.headerTitle}>性能监控</span>
        {backendIds.length > 1 ? (
          <select
            value={activeId ?? ""}
            onChange={(e) => setSelectedId(e.target.value)}
            className={styles.backendSelect}
          >
            {backendIds.map((id) => (
              <option key={id} value={id}>
                {snapshots[id].backend_name ?? id.slice(0, 6)}
              </option>
            ))}
          </select>
        ) : null}
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          aria-label={expanded ? "收起趋势图" : "展开趋势图"}
          title={expanded ? "收起" : "展开 60s 趋势"}
          className={styles.iconButton}
        >
          {expanded ? "▾" : "▴"}
        </button>
        <button
          type="button"
          onClick={close}
          aria-label="关闭"
          className={styles.closeButton}
        >
          ×
        </button>
      </div>
      <div className={styles.body}>
        {activeSnap ? (
          <BackendPanel snap={activeSnap} hist={activeHist} expanded={expanded} />
        ) : (
          <div className={styles.empty}>
            {status === "connecting" ? "正在连接 /ws/ml-backend-stats…" : null}
            {status === "auth_failed" ? (
              <>
                鉴权失败 (1008)
                <div className={styles.emptyHint}>
                  仅 super_admin / project_admin 可见此面板
                </div>
              </>
            ) : null}
            {status === "closed" ? (
              <>
                连接关闭
                <div className={styles.emptyHint}>
                  确认 API + Celery beat 已重启
                </div>
              </>
            ) : null}
            {status === "connected" ? (
              <>
                等待 backend 上报…
                <div className={styles.emptyHint}>
                  Celery beat 1s task 是否在跑？(check{" "}
                  <code>publish-ml-backend-stats</code>)
                </div>
              </>
            ) : null}
            {status === "idle" ? "未连接" : null}
          </div>
        )}
      </div>
    </div>
  );
}
