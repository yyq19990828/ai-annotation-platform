/**
 * v0.10.16 · DuckDB 离线分析面板（ROADMAP §1.6）。
 *
 * super_admin only，3 个固定面板：人均日吞吐 / reject 率分类型 / 标注耗时分布。
 * 数据来源 = Celery beat 每日 02:30 UTC 同步的 DuckDB 文件；尚未首次同步时端点
 * 返回 503，前端展示「数据初始化中」提示。
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { adminAnalyticsApi } from "@/api/adminAnalytics";
import { REJECT_REASON_TYPE_LABELS } from "@/pages/Review/rejectReasonTypes";
import styles from "./AnalyticsPage.module.css";

function BarFill({ pct }: { pct: number }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    ref.current?.style.setProperty("--analytics-bar-width", `${pct}%`);
  }, [pct]);
  return <div ref={ref} className={styles.barFill} />;
}

const RANGE_OPTIONS = [
  { value: 7, label: "近 7 天" },
  { value: 30, label: "近 30 天" },
  { value: 90, label: "近 90 天" },
];

export function AnalyticsPage() {
  const [days, setDays] = useState(30);

  const throughputQ = useQuery({
    queryKey: ["admin", "analytics", "throughput", days],
    queryFn: () => adminAnalyticsApi.throughputDaily(days),
  });
  const rejectQ = useQuery({
    queryKey: ["admin", "analytics", "reject", days],
    queryFn: () => adminAnalyticsApi.rejectRateByType(days),
  });
  const durationQ = useQuery({
    queryKey: ["admin", "analytics", "duration", days],
    queryFn: () => adminAnalyticsApi.durationDist(days),
  });

  const aggThroughput = useMemo(() => {
    const data = throughputQ.data?.data ?? [];
    const byDay = new Map<string, number>();
    for (const r of data) {
      byDay.set(r.day, (byDay.get(r.day) ?? 0) + r.event_count);
    }
    return Array.from(byDay.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [throughputQ.data]);

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>离线分析（DuckDB）</h1>
          <p className={styles.subtitle}>
            数据由 Celery beat 每日 02:30 UTC 增量同步；面板查询为固定 SQL，禁用任意 SQL 输入。
          </p>
        </div>
        <div className={styles.controls}>
          <span className={styles.control}>时间范围：</span>
          <select
            className={styles.select}
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            data-testid="analytics-range-select"
          >
            {RANGE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className={styles.grid}>
        {/* 人均日吞吐（按日聚合） */}
        <div className={styles.card} data-testid="panel-throughput">
          <div className={styles.cardTitle}>团队日吞吐（task_events.kind=annotate）</div>
          <div className={styles.cardHint}>每行 = 1 天的全团队提交事件计数</div>
          {throughputQ.isError && <NotReady error={throughputQ.error} />}
          {!throughputQ.isError && aggThroughput.length === 0 && (
            <div className={styles.empty}>所选范围内暂无数据</div>
          )}
          {aggThroughput.length > 0 && (
            <div className={styles.list}>
              {(() => {
                const max = Math.max(...aggThroughput.map(([, v]) => v));
                return aggThroughput.map(([day, n]) => (
                  <div key={day} className={styles.row}>
                    <span>{day.slice(0, 10)}</span>
                    <div className={styles.barTrack}>
                      <BarFill pct={max ? (n / max) * 100 : 0} />
                    </div>
                    <span>{n}</span>
                  </div>
                ));
              })()}
            </div>
          )}
        </div>

        {/* reject 率按类型分布 */}
        <div className={styles.card} data-testid="panel-reject-rate">
          <div className={styles.cardTitle}>Reject 原因分布</div>
          <div className={styles.cardHint}>
            分母只算 reject_reason_type IS NOT NULL（v0.10.16 起标注）
          </div>
          {rejectQ.isError && <NotReady error={rejectQ.error} />}
          {!rejectQ.isError && (rejectQ.data?.data ?? []).length === 0 && (
            <div className={styles.empty}>所选范围内无 reject 记录</div>
          )}
          {(rejectQ.data?.data ?? []).length > 0 && (
            <div className={styles.list}>
              {(rejectQ.data?.data ?? []).map((r) => (
                <div key={r.reason_type} className={styles.row}>
                  <span>
                    {REJECT_REASON_TYPE_LABELS[
                      r.reason_type as keyof typeof REJECT_REASON_TYPE_LABELS
                    ] ?? r.reason_type}
                  </span>
                  <div className={styles.barTrack}>
                    <BarFill pct={r.pct} />
                  </div>
                  <span>{r.count} · {r.pct.toFixed(1)}%</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 标注耗时分布 */}
        <div className={styles.card} data-testid="panel-duration">
          <div className={styles.cardTitle}>标注耗时分布</div>
          <div className={styles.cardHint}>task_events claim → submit 间隔（ms）</div>
          {durationQ.isError && <NotReady error={durationQ.error} />}
          {!durationQ.isError && durationQ.data && (
            <div className={styles.kv}>
              <span className={styles.kvLabel}>样本数</span>
              <span className={styles.kvValue}>{durationQ.data.data.n}</span>
              <span className={styles.kvLabel}>中位 (p50)</span>
              <span className={styles.kvValue}>{(durationQ.data.data.p50 / 1000).toFixed(1)}s</span>
              <span className={styles.kvLabel}>p95</span>
              <span className={styles.kvValue}>{(durationQ.data.data.p95 / 1000).toFixed(1)}s</span>
              <span className={styles.kvLabel}>均值</span>
              <span className={styles.kvValue}>{(durationQ.data.data.mean / 1000).toFixed(1)}s</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function NotReady({ error }: { error: unknown }) {
  const msg =
    error && typeof error === "object" && "message" in error
      ? String((error as { message: unknown }).message)
      : "数据初始化中（Celery beat 尚未首次同步）。";
  return <div className={styles.notReady}>{msg}</div>;
}
