/**
 * v0.12.3 · 我的绩效（取经合集 §4.1 个人页）。
 *
 * 任意已认证用户看自己的 4 周产出趋势（叠加团队均线）+ 耗时直方图 + hero KPI。
 * 数据走实时 PG（/dashboard/me/performance），强制 self。
 */

import { useMemo } from "react";
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
import { useTheme } from "@/hooks/useTheme";
import { REJECT_REASON_TYPE_LABELS } from "@/pages/Review/rejectReasonTypes";
import styles from "./MyPerformancePage.module.css";

// 统计窗口固定 4 周：趋势图 / 团队均线 / 质量分 / 周环比均按周聚合写死 4 周，
// 故 KPI 也锁定同一窗口，避免「KPI 跟 period、趋势写死 4 周」的口径割裂。
const PERIOD = "4w";

const WEEK_LABELS = ["前 3 周", "前 2 周", "上周", "本周"];

/** 读取 tokens.css 语义色（恪守 §6：组件不写死颜色，运行时取 token）。 */
function cssVar(name: string): string {
  if (typeof window === "undefined") return "";
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export function MyPerformancePage() {
  const perfQ = useQuery({
    queryKey: ["me", "performance", PERIOD],
    queryFn: () => dashboardApi.getMyPerformance(PERIOD),
  });

  // 订阅主题变化:resolved 切换触发 re-render → 下面 useMemo 重读 token,
  // recharts 拿到最新色重绘,避免主题切换后图表颜色滞留。
  const { resolved } = useTheme();
  const accent = useMemo(() => cssVar("--color-accent"), [resolved]);
  const muted = useMemo(() => cssVar("--color-fg-subtle"), [resolved]);
  const danger = useMemo(() => cssVar("--color-danger"), [resolved]);
  const gridColor = useMemo(() => cssVar("--color-border"), [resolved]);

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

  const rejectData = useMemo(() => {
    if (!data) return [];
    return data.reject_reason_breakdown.map((r) => ({
      name:
        REJECT_REASON_TYPE_LABELS[
          r.reason_type as keyof typeof REJECT_REASON_TYPE_LABELS
        ] ?? r.reason_type,
      value: r.count,
    }));
  }, [data]);

  const classData = useMemo(() => {
    if (!data) return [];
    return data.class_distribution.map((c) => ({ name: c.class_name, value: c.count }));
  }, [data]);

  // top-N 类别覆盖率之外的剩余占比;类多时 ΣP 不到 100% 是 backend 有意行为。
  const otherClassPct = useMemo(() => {
    if (!data || data.class_distribution.length === 0) return 0;
    const sum = data.class_distribution.reduce((s, c) => s + c.pct, 0);
    return Math.max(0, 100 - sum);
  }, [data]);

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>我的绩效</h1>
          <p className={styles.subtitle}>
            自己的产出趋势对标团队均线，帮助自我改进。统计窗口：近 4 周，数据实时统计。
          </p>
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
            <KpiCard
              label="首过率"
              value={
                data.first_pass_yield === null
                  ? "—"
                  : `${Math.round(data.first_pass_yield * 100)}%`
              }
              suffix={data.first_pass_yield === null ? undefined : "一次通过"}
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
            <div className={styles.card}>
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

            {/* Reject 原因分布(质量归因 A1) */}
            <div className={styles.card}>
              <div className={styles.cardTitle}>Reject 原因分布</div>
              {rejectData.length === 0 ? (
                <div className={styles.empty}>所选范围内无被驳回记录 🎉</div>
              ) : (
                <div className={styles.chartWrap}>
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart
                      layout="vertical"
                      data={rejectData}
                      margin={{ top: 4, right: 12, bottom: 4, left: 0 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke={gridColor} horizontal={false} />
                      <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
                      <YAxis type="category" dataKey="name" width={72} tick={{ fontSize: 11 }} />
                      <Tooltip />
                      <Bar dataKey="value" name="次数" fill={danger} radius={[0, 3, 3, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>

            {/* 类别覆盖 top-N(质量归因 A1) */}
            <div className={styles.card}>
              <div className={styles.cardTitle}>类别覆盖(top {classData.length || ""})</div>
              {classData.length === 0 ? (
                <div className={styles.empty}>所选范围内暂无标注</div>
              ) : (
                <div className={styles.chartWrap}>
                  <ResponsiveContainer width="100%" height={Math.max(160, classData.length * 26)}>
                    <BarChart
                      layout="vertical"
                      data={classData}
                      margin={{ top: 4, right: 12, bottom: 4, left: 0 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke={gridColor} horizontal={false} />
                      <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
                      <YAxis type="category" dataKey="name" width={90} tick={{ fontSize: 11 }} />
                      <Tooltip />
                      <Bar dataKey="value" name="标注数" fill={accent} radius={[0, 3, 3, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
              {classData.length > 0 && otherClassPct > 0 && (
                <div className={styles.cardFooter}>
                  其他类别合计 {otherClassPct}%
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
