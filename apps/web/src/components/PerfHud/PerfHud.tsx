import { useMemo, useState } from "react";
import { Sparkline } from "@/components/ui/Sparkline";
import { useAuthStore } from "@/stores/authStore";
import { useMLBackendStats, type BackendSnapshot, type BackendHistory } from "./useMLBackendStats";
import { usePerfHudStore } from "./usePerfHudStore";

/**
 * v0.9.11 · PerfHud GPU MVP 浮窗.
 *
 * 触发: Ctrl+Shift+P (workbench) / TopBar gear → "性能监控" / programmatic open.
 * 权限 gating: super_admin / project_admin only (其他角色 store 即便 open 也不渲染).
 * 数据源: /ws/ml-backend-stats, 1s 粒度. 关闭即断, 后端 Celery beat skip.
 */

const PANEL_WIDTH = 280;
const PANEL_HEIGHT_COLLAPSED = 200;
const PANEL_HEIGHT_EXPANDED = 360;

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
  return (
    <div style={{ marginBottom: 6 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: 11,
          color: "var(--color-fg-muted, #888)",
          marginBottom: 2,
        }}
      >
        <span>{label}</span>
        <span style={{ color, fontFeatureSettings: "'tnum'" }}>
          {value}
          {unit ? <span style={{ opacity: 0.6, marginLeft: 2 }}>{unit}</span> : null}
        </span>
      </div>
      <div
        style={{
          height: 4,
          background: "var(--color-bg-subtle, #2a2a2a)",
          borderRadius: 2,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${Math.max(0, Math.min(100, pct ?? 0))}%`,
            background: color,
            transition: "width 0.3s ease, background 0.3s ease",
          }}
        />
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
    <div style={{ padding: "8px 10px" }}>
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
        <div style={{ marginTop: 8, display: "grid", gap: 4 }}>
          <SparkRow label="GPU" values={hist.gpuUtil} color="var(--color-success, #2da44e)" />
          <SparkRow label="VRAM" values={hist.vramPercent} color="var(--color-accent, #5e92ff)" />
          <SparkRow label="CPU" values={hist.cpu} color="var(--color-warning, #e6a700)" />
          <SparkRow label="RAM" values={hist.mem} color="var(--color-danger, #e54d4d)" />
        </div>
      ) : null}
      <div
        style={{
          marginTop: 8,
          fontSize: 10,
          color: "var(--color-fg-muted, #888)",
          display: "flex",
          flexWrap: "wrap",
          gap: 6,
        }}
      >
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
    <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10 }}>
      <span style={{ width: 32, color: "var(--color-fg-muted, #888)" }}>{label}</span>
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
      style={{
        position: "fixed",
        top: 60,
        right: 12,
        width: PANEL_WIDTH,
        height: expanded ? PANEL_HEIGHT_EXPANDED : PANEL_HEIGHT_COLLAPSED,
        background: "var(--color-bg-panel, #1e1e1e)",
        color: "var(--color-fg, #e0e0e0)",
        border: "1px solid var(--color-border, #333)",
        borderRadius: 6,
        boxShadow: "0 4px 16px rgba(0,0,0,0.35)",
        zIndex: 1000,
        display: "flex",
        flexDirection: "column",
        fontFamily: "var(--font-sans, system-ui)",
      }}
    >
      <div
        style={{
          padding: "6px 10px",
          borderBottom: "1px solid var(--color-border, #333)",
          display: "flex",
          alignItems: "center",
          gap: 6,
          fontSize: 12,
        }}
      >
        <span
          aria-hidden
          title={connected ? "实时连接中" : "未连接"}
          style={{
            width: 6,
            height: 6,
            borderRadius: 3,
            background: connected ? "#2da44e" : "#888",
          }}
        />
        <span style={{ flex: 1, fontWeight: 600 }}>性能监控</span>
        {backendIds.length > 1 ? (
          <select
            value={activeId ?? ""}
            onChange={(e) => setSelectedId(e.target.value)}
            style={{
              background: "transparent",
              color: "inherit",
              border: "1px solid var(--color-border, #444)",
              borderRadius: 3,
              fontSize: 11,
            }}
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
          style={{
            background: "transparent",
            color: "inherit",
            border: "none",
            cursor: "pointer",
            padding: "0 4px",
            fontSize: 12,
          }}
        >
          {expanded ? "▾" : "▴"}
        </button>
        <button
          type="button"
          onClick={close}
          aria-label="关闭"
          style={{
            background: "transparent",
            color: "inherit",
            border: "none",
            cursor: "pointer",
            padding: "0 4px",
            fontSize: 14,
          }}
        >
          ×
        </button>
      </div>
      <div style={{ flex: 1, overflow: "auto" }}>
        {activeSnap ? (
          <BackendPanel snap={activeSnap} hist={activeHist} expanded={expanded} />
        ) : (
          <div
            style={{
              padding: 16,
              fontSize: 12,
              color: "var(--color-fg-muted, #888)",
              textAlign: "center",
              lineHeight: 1.6,
            }}
          >
            {status === "connecting" ? "正在连接 /ws/ml-backend-stats…" : null}
            {status === "auth_failed" ? (
              <>
                鉴权失败 (1008)
                <div style={{ fontSize: 10, marginTop: 4 }}>
                  仅 super_admin / project_admin 可见此面板
                </div>
              </>
            ) : null}
            {status === "closed" ? (
              <>
                连接关闭
                <div style={{ fontSize: 10, marginTop: 4 }}>
                  确认 API + Celery beat 已重启
                </div>
              </>
            ) : null}
            {status === "connected" ? (
              <>
                等待 backend 上报…
                <div style={{ fontSize: 10, marginTop: 4 }}>
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
