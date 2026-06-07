/**
 * v0.10.16 · DuckDB 离线分析面板（ROADMAP §1.6）。
 *
 * super_admin only，4 个固定面板：团队日吞吐 / reject 率分类型 / 标注耗时分布 / 工时热力图。
 * 数据来源 = Celery beat 每日 02:30 UTC 同步的 DuckDB 文件；尚未首次同步时端点
 * 返回 503，前端展示「数据初始化中」提示。
 *
 * v0.12.7 · 吞吐 / reject 面板升级为 recharts；新增工时热力图（星期几 × 小时）。
 */

import { useMemo, useState, type CSSProperties } from "react";
import { useQuery } from "@tanstack/react-query";
import { useElementStyle } from "@/components/ui/useElementStyle";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { adminAnalyticsApi } from "@/api/adminAnalytics";
import { useTheme } from "@/hooks/useTheme";
import { REJECT_REASON_TYPE_LABELS } from "@/pages/Review/rejectReasonTypes";
import styles from "./AnalyticsPage.module.css";

/** 读取 tokens.css 语义色（恪守 §6：组件不写死颜色，运行时取 token）。 */
function cssVar(name: string): string {
  if (typeof window === "undefined") return "";
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

const RANGE_OPTIONS = [
  { value: 7, label: "近 7 天" },
  { value: 30, label: "近 30 天" },
  { value: 90, label: "近 90 天" },
];

// DuckDB dayofweek() 约定 0=周日 .. 6=周六。下标对齐该约定。
const WEEKDAY_LABELS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
const HOURS = Array.from({ length: 24 }, (_, h) => h);

export function AnalyticsPage() {
  const [days, setDays] = useState(30);
  // 订阅主题变化:resolved 切换会触发本组件 re-render,
  // accent/gridColor 的 useMemo 重读 token,recharts 拿到新色重绘。
  const { resolved } = useTheme();

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
  const heatmapQ = useQuery({
    queryKey: ["admin", "analytics", "heatmap", days],
    queryFn: () => adminAnalyticsApi.activityHeatmap(days),
  });

  const accent = useMemo(() => {
    void resolved;
    return cssVar("--color-accent");
  }, [resolved]);
  const gridColor = useMemo(() => {
    void resolved;
    return cssVar("--color-border");
  }, [resolved]);

  const aggThroughput = useMemo(() => {
    const data = throughputQ.data?.data ?? [];
    const byDay = new Map<string, number>();
    for (const r of data) {
      byDay.set(r.day, (byDay.get(r.day) ?? 0) + r.event_count);
    }
    return Array.from(byDay.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([day, n]) => ({ day: day.slice(0, 10), n }));
  }, [throughputQ.data]);

  const rejectData = useMemo(() => {
    return (rejectQ.data?.data ?? []).map((r) => ({
      name:
        REJECT_REASON_TYPE_LABELS[
          r.reason_type as keyof typeof REJECT_REASON_TYPE_LABELS
        ] ?? r.reason_type,
      count: r.count,
    }));
  }, [rejectQ.data]);

  const heatmap = useMemo(() => {
    const cells = heatmapQ.data?.data ?? [];
    const byKey = new Map<string, number>();
    let max = 0;
    for (const c of cells) {
      byKey.set(`${c.weekday}-${c.hour}`, c.count);
      if (c.count > max) max = c.count;
    }
    return { byKey, max };
  }, [heatmapQ.data]);

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
        {/* 团队日吞吐（按日聚合） */}
        <div className={styles.card} data-testid="panel-throughput">
          <div className={styles.cardTitle}>团队日吞吐（task_events.kind=annotate）</div>
          <div className={styles.cardHint}>每点 = 1 天的全团队提交事件计数</div>
          {throughputQ.isError && <NotReady error={throughputQ.error} />}
          {!throughputQ.isError && aggThroughput.length === 0 && (
            <div className={styles.empty}>所选范围内暂无数据</div>
          )}
          {aggThroughput.length > 0 && (
            <div className={styles.chartWrap}>
              <ResponsiveContainer width="100%" height={240}>
                <LineChart
                  data={aggThroughput}
                  margin={{ top: 8, right: 16, bottom: 8, left: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
                  <XAxis dataKey="day" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <Tooltip />
                  <Line
                    type="monotone"
                    dataKey="n"
                    name="提交数"
                    stroke={accent}
                    strokeWidth={2}
                    dot={{ r: 2 }}
                  />
                </LineChart>
              </ResponsiveContainer>
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
          {!rejectQ.isError && rejectData.length === 0 && (
            <div className={styles.empty}>所选范围内无 reject 记录</div>
          )}
          {rejectData.length > 0 && (
            <div className={styles.chartWrap}>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart
                  layout="vertical"
                  data={rejectData}
                  margin={{ top: 4, right: 12, bottom: 4, left: 0 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke={gridColor}
                    horizontal={false}
                  />
                  <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={84}
                    tick={{ fontSize: 11 }}
                  />
                  <Tooltip />
                  <Bar dataKey="count" name="次数" fill={accent} radius={[0, 3, 3, 0]} />
                </BarChart>
              </ResponsiveContainer>
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

        {/* 工时热力图（星期几 × 小时） */}
        <div
          className={`${styles.card} ${styles.cardWide}`}
          data-testid="panel-heatmap"
        >
          <div className={styles.cardTitle}>工时热力图（started_at · 星期 × 小时）</div>
          <div className={styles.cardHint}>颜色深浅 = 该时段 annotate 事件计数占比</div>
          {heatmapQ.isError && <NotReady error={heatmapQ.error} />}
          {!heatmapQ.isError && heatmap.max === 0 && (
            <div className={styles.empty}>所选范围内暂无工时数据</div>
          )}
          {!heatmapQ.isError && heatmap.max > 0 && (
            <div className={styles.heatmap}>
              {WEEKDAY_LABELS.map((label, weekday) => (
                <div key={weekday} className={styles.heatmapRow}>
                  <span className={styles.heatmapRowLabel}>{label}</span>
                  {HOURS.map((hour) => {
                    const count = heatmap.byKey.get(`${weekday}-${hour}`) ?? 0;
                    const intensity =
                      count > 0 ? Math.max(0.06, count / heatmap.max) : 0.06;
                    return (
                      <HeatCell
                        key={hour}
                        intensity={intensity}
                        title={`${label} ${String(hour).padStart(2, "0")}:00 · ${count}`}
                      />
                    );
                  })}
                </div>
              ))}
              <div className={styles.heatmapAxis}>
                <span className={styles.heatmapRowLabel} />
                {HOURS.map((hour) => (
                  <span key={hour} className={styles.heatmapHourLabel}>
                    {hour % 6 === 0 ? hour : ""}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// 热力图格子:强度走 CSS 变量(opacity),颜色来自 token --color-accent(§6 合规)。
function HeatCell({ intensity, title }: { intensity: number; title: string }) {
  const ref = useElementStyle<HTMLDivElement>({
    "--heat-opacity": String(intensity),
  } as CSSProperties);
  return <div ref={ref} className={styles.heatmapCell} title={title} />;
}

function NotReady({ error }: { error: unknown }) {
  const msg =
    error && typeof error === "object" && "message" in error
      ? String((error as { message: unknown }).message)
      : "数据初始化中（Celery beat 尚未首次同步）。";
  return <div className={styles.notReady}>{msg}</div>;
}
