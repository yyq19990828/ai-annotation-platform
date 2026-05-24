/**
 * v0.10.58 · super_admin system health panel.
 */

import { useQuery } from "@tanstack/react-query";
import { adminSystemHealthApi, type SystemHealthStatus } from "@/api/adminSystemHealth";
import { Icon } from "@/components/ui/Icon";
import styles from "./SystemHealthPage.module.css";

const STATUS_LABEL: Record<SystemHealthStatus, string> = {
  ok: "正常",
  degraded: "降级",
  down: "不可用",
};

const STATUS_CLASS: Record<SystemHealthStatus, string> = {
  ok: styles.statusOk,
  degraded: styles.statusDegraded,
  down: styles.statusDown,
};

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
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>系统健康</h1>
          <p className={styles.subtitle}>
            PostgreSQL、Redis、MinIO 与 Celery worker 的实时探测结果。
          </p>
        </div>
        {data && (
          <div className={`${styles.overall} ${STATUS_CLASS[data.status]}`}>
            <Icon name="activity" size={14} />
            <span>{STATUS_LABEL[data.status]}</span>
            <span className={styles.version}>v{data.version}</span>
          </div>
        )}
      </div>

      {healthQ.isLoading && <div className={styles.message}>加载中…</div>}
      {healthQ.isError && (
        <div className={styles.message}>系统健康数据加载失败</div>
      )}

      {data && (
        <>
          <div className={styles.componentGrid}>
            {data.components.map((component) => (
              <div key={component.name} className={styles.componentCard}>
                <div className={styles.cardTopline}>
                  <span className={styles.componentName}>{component.label}</span>
                  <span className={`${styles.statusPill} ${STATUS_CLASS[component.status]}`}>
                    {STATUS_LABEL[component.status]}
                  </span>
                </div>
                <div className={styles.metricValue}>{formatLatency(component.latency_ms)}</div>
                {component.detail && (
                  <div className={styles.detailText}>{component.detail}</div>
                )}
              </div>
            ))}
          </div>

          <div className={styles.grid}>
            <section className={styles.panel}>
              <div className={styles.panelHeader}>
                <h2 className={styles.panelTitle}>Celery 队列</h2>
                <span className={styles.panelHint}>{data.celery.queues.length} 个队列</span>
              </div>
              {data.celery.queues.length === 0 ? (
                <div className={styles.empty}>暂无积压任务</div>
              ) : (
                <table className={styles.table}>
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
                        <td className={styles.numeric}>{queue.length}</td>
                        <td>
                          <span className={`${styles.statusPill} ${STATUS_CLASS[queue.status]}`}>
                            {STATUS_LABEL[queue.status]}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>

            <section className={styles.panel}>
              <div className={styles.panelHeader}>
                <h2 className={styles.panelTitle}>Celery Workers</h2>
                <span className={styles.panelHint}>active {data.celery.active_count}</span>
              </div>
              {data.celery.workers.length === 0 ? (
                <div className={styles.empty}>没有 worker 响应</div>
              ) : (
                <table className={styles.table}>
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
                        <td className={styles.numeric}>{worker.pool_max ?? "—"}</td>
                        <td>
                          <span className={`${styles.statusPill} ${STATUS_CLASS[worker.status]}`}>
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
