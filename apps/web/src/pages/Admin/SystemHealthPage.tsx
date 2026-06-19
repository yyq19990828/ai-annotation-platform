/**
 * v0.10.58 · super_admin system health panel.
 * v0.17.3 · module.css → Tailwind(tw-scope)。
 */

import { useQuery } from "@tanstack/react-query";
import { adminSystemHealthApi, type SystemHealthStatus } from "@/api/adminSystemHealth";
import { Icon } from "@/components/ui/Icon";

const STATUS_LABEL: Record<SystemHealthStatus, string> = {
  ok: "正常",
  degraded: "降级",
  down: "不可用",
};

// 状态色 → 设计 §2.3:ok=emerald / degraded=amber / down=rose(柔底 + 边 + 暗色提亮)
const STATUS_CLASS: Record<SystemHealthStatus, string> = {
  ok: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  degraded: "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400",
  down: "border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400",
};

const PILL_BASE =
  "inline-flex items-center rounded-sm border px-1.5 py-0.5 text-[11px] font-semibold";

const TABLE_CLASS =
  "w-full border-collapse text-xs [&_td]:border-b [&_td]:border-border [&_td]:px-2.5 [&_td]:py-2 [&_td]:text-left [&_th]:border-b [&_th]:border-border [&_th]:bg-muted [&_th]:px-2.5 [&_th]:py-2 [&_th]:text-left [&_th]:font-medium [&_th]:text-muted-foreground [&_tr:last-child_td]:border-b-0";

function formatLatency(value: number | null): string {
  return value == null ? "—" : `${value.toFixed(1)}ms`;
}

function formatHeartbeat(value: number | null): string {
  if (value == null) return "未知";
  if (value < 60) return `${Math.round(value)}s`;
  const minutes = value / 60;
  if (minutes < 60) return `${minutes.toFixed(1)}m`;
  return `${(minutes / 60).toFixed(1)}h`;
}

export function SystemHealthPage() {
  const healthQ = useQuery({
    queryKey: ["admin", "system-health"],
    queryFn: () => adminSystemHealthApi.get(),
    refetchInterval: 12_000,
    retry: false,
  });

  const data = healthQ.data;

  return (
    <div className="flex flex-col gap-4 px-6 py-5 text-foreground">
      <div className="flex items-center justify-between gap-4 max-md:flex-col max-md:items-start">
        <div>
          <h1 className="text-xl font-semibold">系统健康</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            PostgreSQL、Redis、MinIO 与 Celery worker 的实时探测结果。
          </p>
        </div>
        {data && (
          <div
            className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-semibold ${STATUS_CLASS[data.status]}`}
          >
            <Icon name="activity" size={14} />
            <span>{STATUS_LABEL[data.status]}</span>
            <span className="font-medium text-muted-foreground">v{data.version}</span>
          </div>
        )}
      </div>

      {healthQ.isLoading && <div className="p-[18px] text-center text-xs text-muted-foreground">加载中…</div>}
      {healthQ.isError && (
        <div className="p-[18px] text-center text-xs text-muted-foreground">系统健康数据加载失败</div>
      )}

      {data && (
        <>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3">
            {data.components.map((component) => (
              <div
                key={component.name}
                className="min-h-[112px] rounded-md border border-border bg-card p-3.5"
              >
                <div className="flex items-center justify-between gap-2.5">
                  <span className="text-[13px] font-semibold">{component.label}</span>
                  <span className={`${PILL_BASE} ${STATUS_CLASS[component.status]}`}>
                    {STATUS_LABEL[component.status]}
                  </span>
                </div>
                <div className="mt-[18px] text-[22px] font-semibold tabular-nums">
                  {formatLatency(component.latency_ms)}
                </div>
                {component.detail && (
                  <div className="mt-2 text-[11px] leading-[1.4] text-rose-600 dark:text-rose-400">
                    {component.detail}
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] gap-4 max-md:grid-cols-1">
            <section className="overflow-hidden rounded-md border border-border bg-card">
              <div className="flex items-center justify-between gap-2.5 border-b border-border px-3.5 py-3">
                <h2 className="text-[13px] font-semibold">Celery 队列</h2>
                <span className="text-[11px] text-muted-foreground">{data.celery.queues.length} 个队列</span>
              </div>
              {data.celery.queues.length === 0 ? (
                <div className="p-[18px] text-center text-xs text-muted-foreground">暂无积压任务</div>
              ) : (
                <table className={TABLE_CLASS}>
                  <thead>
                    <tr>
                      <th>Queue</th>
                      <th>Length</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.celery.queues.map((queue) => (
                      <tr key={queue.name}>
                        <td>{queue.name}</td>
                        <td className="tabular-nums">{queue.length}</td>
                        <td>
                          <span className={`${PILL_BASE} ${STATUS_CLASS[queue.status]}`}>
                            {STATUS_LABEL[queue.status]}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>

            <section className="overflow-hidden rounded-md border border-border bg-card">
              <div className="flex items-center justify-between gap-2.5 border-b border-border px-3.5 py-3">
                <h2 className="text-[13px] font-semibold">Celery Workers</h2>
                <span className="text-[11px] text-muted-foreground">active {data.celery.active_count}</span>
              </div>
              {data.celery.workers.length === 0 ? (
                <div className="p-[18px] text-center text-xs text-muted-foreground">没有 worker 响应</div>
              ) : (
                <table className={TABLE_CLASS}>
                  <thead>
                    <tr>
                      <th>Worker</th>
                      <th>Heartbeat</th>
                      <th>Pool</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.celery.workers.map((worker) => (
                      <tr key={worker.name}>
                        <td>{worker.name}</td>
                        <td>{formatHeartbeat(worker.last_heartbeat_seconds_ago)}</td>
                        <td className="tabular-nums">{worker.pool_max ?? "—"}</td>
                        <td>
                          <span className={`${PILL_BASE} ${STATUS_CLASS[worker.status]}`}>
                            {STATUS_LABEL[worker.status]}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  );
}
