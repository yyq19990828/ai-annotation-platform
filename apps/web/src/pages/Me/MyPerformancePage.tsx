/**
 * v0.12.3 · 我的绩效（取经合集 §4.1 个人页）。
 *
 * 任意已认证用户看自己的 4 周产出趋势（叠加团队均线）+ 耗时直方图 + hero KPI。
 * 数据走实时 PG（/dashboard/me/performance），强制 self。
 */

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { dashboardApi } from "@/api/dashboard";
import styles from "./MyPerformancePage.module.css";

const PERIOD_OPTIONS = [
  { value: "7d", label: "近 7 天" },
  { value: "4w", label: "近 4 周" },
  { value: "1m", label: "近 1 月" },
];

const WEEK_LABELS = ["前 3 周", "前 2 周", "上周", "本周"];

/** 读取 tokens.css 语义色（恪守 §6：组件不写死颜色，运行时取 token）。 */
function cssVar(name: string): string {
  if (typeof window === "undefined") return "";
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export function MyPerformancePage() {
  const [period, setPeriod] = useState("4w");

  const perfQ = useQuery({
    queryKey: ["me", "performance", period],
    queryFn: () => dashboardApi.getMyPerformance(period),
  });

  const accent = cssVar("--color-accent");
  const muted = cssVar("--color-fg-subtle");
  const gridColor = cssVar("--color-border");

  const data = perfQ.data;

  const trendData = useMemo(() => {
    if (!data) return [];
    return WEEK_LABELS.map((label, i) => ({
      name: label,
      我的产出: data.trend_throughput[i] ?? 0,
      团队均线: data.team_trend_throughput[i] ?? 0,
    }));
  }, [data]);

  const histogramData = useMemo(() => {
    if (!data) return [];
    return data.duration_histogram.map((b) => ({
      name: `${Math.round(b.upper_ms / 1000)}s`,
      count: b.count,
    }));
  }, [data]);

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>我的绩效</h1>
          <p className={styles.subtitle}>
            自己的产出趋势对标团队均线，帮助自我改进。数据实时统计。
          </p>
        </div>
        <div className={styles.controls}>
          <span className={styles.control}>时间范围：</span>
          <select
            className={styles.select}
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            data-testid="my-perf-period-select"
          >
            {PERIOD_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {perfQ.isError && (
        <div className={styles.notReady}>绩效数据暂不可用，请稍后再试。</div>
      )}

      {data && (
        <>
          <div className={styles.kpiGrid}>
            <KpiCard label="本期产出" value={data.throughput.toLocaleString()} />
            <KpiCard label="质量分" value={`${data.quality_score}`} suffix="/100" />
            <KpiCard
              label="周环比"
              value={
                data.weekly_compare_pct === null
                  ? "—"
                  : `${data.weekly_compare_pct > 0 ? "+" : ""}${data.weekly_compare_pct}%`
              }
              positive={
                data.weekly_compare_pct !== null && data.weekly_compare_pct >= 0
              }
            />
            <KpiCard
              label="耗时 p50 / p95"
              value={
                data.p50_duration_ms !== null
                  ? `${Math.round(data.p50_duration_ms / 1000)}s / ${Math.round(
                      (data.p95_duration_ms ?? 0) / 1000,
                    )}s`
                  : "—"
              }
            />
          </div>

          <div className={styles.grid}>
            {/* 产出趋势 vs 团队均线 */}
            <div className={`${styles.card} ${styles.cardWide}`}>
              <div className={styles.cardTitle}>产出趋势 · 我 vs 团队均线（近 4 周）</div>
              <div className={styles.chartWrap}>
                <ResponsiveContainer width="100%" height={280}>
                  <LineChart data={trendData} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                    <Tooltip />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Line
                      type="monotone"
                      dataKey="我的产出"
                      stroke={accent}
                      strokeWidth={2}
                      dot={{ r: 3 }}
                    />
                    <Line
                      type="monotone"
                      dataKey="团队均线"
                      stroke={muted}
                      strokeWidth={2}
                      strokeDasharray="5 4"
                      dot={{ r: 2 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* 耗时直方图 */}
            <div className={`${styles.card} ${styles.cardWide}`}>
              <div className={styles.cardTitle}>标注耗时分布</div>
              {histogramData.length === 0 ? (
                <div className={styles.empty}>所选范围内暂无耗时样本</div>
              ) : (
                <div className={styles.chartWrap}>
                  <ResponsiveContainer width="100%" height={240}>
                    <BarChart data={histogramData} margin={{ top: 8, right: 8, bottom: 8, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
                      <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                      <Tooltip />
                      <Bar dataKey="count" name="次数" fill={accent} radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function KpiCard({
  label,
  value,
  suffix,
  positive,
}: {
  label: string;
  value: string;
  suffix?: string;
  positive?: boolean;
}) {
  return (
    <div className={styles.kpiCard}>
      <div className={styles.kpiLabel}>{label}</div>
      <div
        className={styles.kpiValue}
        data-positive={positive === undefined ? undefined : positive}
      >
        {value}
        {suffix && <span className={styles.kpiSuffix}>{suffix}</span>}
      </div>
    </div>
  );
}
