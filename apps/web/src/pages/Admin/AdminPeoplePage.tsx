import { useMemo, useState, type CSSProperties, type KeyboardEvent, type MouseEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Icon } from "@/components/ui/Icon";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Avatar } from "@/components/ui/Avatar";
import { Sparkline } from "@/components/ui/Sparkline";
import { Histogram } from "@/components/ui/Histogram";
import { RadialProgress } from "@/components/ui/RadialProgress";
import { useElementStyle } from "@/components/ui/useElementStyle";
import { useAdminPeople, useAdminPersonDetail } from "@/hooks/useDashboard";
import { REJECT_REASON_TYPE_LABELS } from "@/pages/Review/rejectReasonTypes";
import { dashboardApi, type AdminPersonItem } from "@/api/dashboard";
import { useToastStore } from "@/components/ui/Toast";
import styles from "./AdminPeoplePage.module.css";

const ROLE_OPTS = [
  { v: "", label: "全部" },
  { v: "annotator", label: "标注员" },
  { v: "reviewer", label: "审核员" },
];
const PERIOD_OPTS = [
  { v: "today", label: "今日" },
  { v: "7d", label: "本周" },
  { v: "1m", label: "本月" },
];
const SORT_OPTS = [
  { v: "throughput", label: "产能↓" },
  { v: "quality", label: "质量↓" },
  { v: "activity", label: "活跃↓" },
  { v: "weekly_compare", label: "周环比↓" },
];

export function AdminPeoplePage() {
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();
  const role = sp.get("role") || "";
  const period = sp.get("period") || "7d";
  const sort = sp.get("sort") || "throughput";
  const q = sp.get("q") || "";

  const [activeUserId, setActiveUserId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const pushToast = useToastStore((s) => s.push);

  const handleExport = async () => {
    setExporting(true);
    try {
      await dashboardApi.exportPeople({
        role: role || undefined,
        period,
        sort,
        q: q || undefined,
      });
    } catch (e) {
      pushToast({
        kind: "error",
        msg: "导出失败",
        sub: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setExporting(false);
    }
  };

  const { data, isLoading } = useAdminPeople({
    role: role || undefined,
    period,
    sort,
    q: q || undefined,
  });

  const items = data?.items ?? [];

  const setQuery = (key: string, value: string) => {
    const next = new URLSearchParams(sp);
    if (value) next.set(key, value);
    else next.delete(key);
    setSp(next, { replace: true });
  };

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>
            成员绩效
          </h1>
          <p className={styles.subtitle}>
            全员效率卡片网格 · 点击卡片查看详情
          </p>
        </div>
        <div className={styles.headerActions}>
          <Button variant="ghost" onClick={handleExport} disabled={exporting}>
            <Icon name="download" size={13} />
            {exporting ? "导出中…" : "导出 CSV"}
          </Button>
          <Button variant="ghost" onClick={() => navigate("/dashboard")}>
            <Icon name="chevron-left" size={13} />返回总览
          </Button>
        </div>
      </div>

      {/* sticky filter bar */}
      <div className={styles.stickyCard}>
        <Card>
        <div className={styles.filterBar}>
          <FilterGroup
            label="角色"
            opts={ROLE_OPTS}
            value={role}
            onChange={(v: string) => setQuery("role", v)}
          />
          <FilterGroup
            label="时间"
            opts={PERIOD_OPTS}
            value={period}
            onChange={(v: string) => setQuery("period", v)}
          />
          <FilterGroup
            label="排序"
            opts={SORT_OPTS}
            value={sort}
            onChange={(v: string) => setQuery("sort", v)}
          />
          <input
            type="search"
            placeholder="姓名 / 邮箱"
            defaultValue={q}
            onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
              if (e.key === "Enter") setQuery("q", e.currentTarget.value);
            }}
            className={styles.searchInput}
          />
        </div>
        </Card>
      </div>

      {isLoading ? (
        <div className={styles.loading}>
          加载中...
        </div>
      ) : items.length === 0 ? (
        <Card>
          <div className={styles.emptyCard}>
            <Icon name="users" size={36} className={styles.emptyIcon} />
            <div className={styles.emptyTitle}>暂无成员数据</div>
            <div className={styles.emptyText}>
              调整筛选条件重试
            </div>
          </div>
        </Card>
      ) : (
        <div className={styles.grid}>
          {items.map((it) => (
            <PersonCard
              key={it.user_id}
              item={it}
              onClick={() => setActiveUserId(it.user_id)}
            />
          ))}
        </div>
      )}

      {activeUserId && (
        <PersonDrawer
          userId={activeUserId}
          onClose={() => setActiveUserId(null)}
        />
      )}
    </div>
  );
}

function FilterGroup({
  label,
  opts,
  value,
  onChange,
}: {
  label: string;
  opts: Array<{ v: string; label: string }>;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className={styles.filterGroup}>
      <span className={styles.filterLabel}>{label}</span>
      <div className={styles.filterOptions}>
        {opts.map((o) => (
          <button
            key={o.v}
            type="button"
            onClick={() => onChange(o.v)}
            className={`${styles.filterButton} ${value === o.v ? styles.filterButtonActive : ""}`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function PersonCard({ item, onClick }: { item: AdminPersonItem; onClick: () => void }) {
  const trend = item.weekly_compare_pct;
  return (
    <Card onClick={onClick}>
      <div className={styles.personCardInner}>
      <div className={styles.personTop}>
        <Avatar initial={item.name?.charAt(0) || "?"} size="md" />
        <div className={styles.personBody}>
          <div className={styles.personTitle}>
            <span className={styles.truncate}>
              {item.name}
            </span>
            <span className={`${styles.statusDot} ${item.status === "online" ? styles.statusDotOnline : ""}`} />
          </div>
          <div className={styles.projectMeta}>
            <Badge
              variant={
                item.role === "annotator" ? "accent" : "ai"
              }
            >
              {item.role}
            </Badge>
            {item.project_count} 项目
          </div>
        </div>
        <RadialProgress
          value={Math.round(
            (item.throughput_score + item.quality_score + item.activity_score) / 3,
          )}
          size={36}
          thickness={4}
        />
      </div>

      <div>
        <div
          className={styles.metric}
        >
          {item.main_metric.toLocaleString()}
          {trend != null && (
            <span
              className={`${styles.trend} ${trend >= 0 ? styles.trendUp : styles.trendDown}`}
            >
              {trend >= 0 ? "↑" : "↓"} {Math.abs(trend)}%
            </span>
          )}
        </div>
        <div className={styles.metricLabel}>
          {item.main_metric_label}
        </div>
      </div>

      <PercentBars
        rows={[
          { label: "产能", value: item.throughput_score },
          { label: "质量", value: item.quality_score },
          { label: "活跃", value: item.activity_score },
        ]}
      />

      <Sparkline values={item.sparkline_7d} color="var(--color-accent)" width={252} height={24} />

      {item.alerts.length > 0 && (
        <div className={styles.alerts}>
          {item.alerts.includes("high_rejected") && (
            <Badge variant="danger">
              退回率 {item.rejected_rate}% &gt; 15%
            </Badge>
          )}
          {item.alerts.includes("drop_30") && (
            <Badge variant="warning">
              周环比降幅 &gt; 30%
            </Badge>
          )}
        </div>
      )}
      </div>
    </Card>
  );
}

function PercentBars({ rows }: { rows: Array<{ label: string; value: number }> }) {
  return (
    <div className={styles.bars}>
      {rows.map((r) => (
        <div key={r.label} className={styles.barRow}>
          <span className={styles.barLabel}>{r.label}</span>
          <div className={styles.barTrack}>
            <PercentBarFill value={r.value} />
          </div>
          <span className={styles.barValue}>
            {Math.round(r.value)}
          </span>
        </div>
      ))}
    </div>
  );
}

function PercentBarFill({ value }: { value: number }) {
  const width = Math.min(100, Math.max(0, value));
  const ref = useElementStyle<HTMLDivElement>({ "--bar-width": `${width}%` } as CSSProperties);
  return <div ref={ref} className={styles.barFill} />;
}

function PersonDrawer({ userId, onClose }: { userId: string; onClose: () => void }) {
  const navigate = useNavigate();
  const { data, isLoading } = useAdminPersonDetail(userId, "4w");

  // v0.12.5 · 项目维度下钻:跳到该项目 review 队列按本人 assignee 过滤(复用后端 assignee_id 过滤)。
  const drillToProject = (projectId: string) => {
    navigate(`/review?project=${projectId}&assignee=${userId}`);
    onClose();
  };
  const histogramValues = useMemo(() => (data?.duration_histogram ?? []).map((b) => b.count), [data]);
  const xLabels = useMemo(
    () => (data?.duration_histogram ?? []).map((b) => `${Math.round(b.upper_ms / 1000)}s`),
    [data],
  );

  return (
    <div
      onClick={onClose}
      className={styles.drawerBackdrop}
    >
      <div
        onClick={(e: MouseEvent<HTMLDivElement>) => e.stopPropagation()}
        className={styles.drawerPanel}
      >
        <div className={styles.drawerHeader}>
          <div className={styles.drawerTitle}>
            {data?.name ?? "成员详情"}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className={styles.closeButton}
          >
            <Icon name="x" size={16} />
          </button>
        </div>

        <div className={styles.drawerBody}>
          {isLoading || !data ? (
            <div className={styles.drawerLoading}>
              加载中...
            </div>
          ) : (
            <div className={styles.drawerStack}>
              <div className={styles.kpiGrid}>
                <KpiCell label="产能" value={data.throughput} />
                <KpiCell label="质量" value={`${data.quality_score}%`} />
                <KpiCell
                  label="活跃"
                  value={data.active_minutes == null ? "—" : `${data.active_minutes}m`}
                />
                <KpiCell label="综合分" value={data.composite_score} />
                <KpiCell
                  label="首过率"
                  value={
                    data.first_pass_yield == null
                      ? "—"
                      : `${Math.round(data.first_pass_yield * 100)}%`
                  }
                />
              </div>

              <Card>
                <div className={styles.sectionTitle}>
                  4 周趋势
                </div>
                <div className={styles.sectionBody}>
                  <div className={styles.chartLabel}>产能</div>
                  <Sparkline values={data.trend_throughput} width={480} height={48} color="var(--color-accent)" />
                  <div className={`${styles.chartLabel} ${styles.chartLabelSpaced}`}>质量分</div>
                  <Sparkline values={data.trend_quality} width={480} height={48} color="var(--color-success)" />
                </div>
              </Card>

              {data.duration_histogram.length > 0 && (
                <Card>
                  <div className={styles.sectionTitle}>
                    任务耗时分布
                    {data.p50_duration_ms != null && (
                      <span className={styles.sectionTitleMeta}>
                        p50 {Math.round(data.p50_duration_ms / 1000)}s · p95 {Math.round((data.p95_duration_ms ?? 0) / 1000)}s
                      </span>
                    )}
                  </div>
                  <div className={styles.sectionBody}>
                    <Histogram values={histogramValues} xLabels={xLabels} />
                  </div>
                </Card>
              )}

              {data.project_distribution.length > 0 && (
                <Card>
                  <div className={styles.sectionTitle}>
                    项目分布
                    <span className={styles.sectionTitleMeta}>点击进入该项目审核队列</span>
                  </div>
                  <div className={styles.distribution}>
                    {data.project_distribution.map((p) => (
                      <button
                        type="button"
                        key={p.project_id}
                        className={`${styles.distributionRow} ${styles.distributionLink}`}
                        onClick={() => drillToProject(p.project_id)}
                        title="进入该项目审核队列(已按本人过滤)"
                      >
                        <span>{p.project_name}</span>
                        <span className={styles.distributionCount}>
                          {p.count}
                        </span>
                      </button>
                    ))}
                  </div>
                </Card>
              )}

              {data.reject_reason_breakdown.length > 0 && (
                <Card>
                  <div className={styles.sectionTitle}>Reject 原因分布</div>
                  <div className={styles.distribution}>
                    {data.reject_reason_breakdown.map((r) => (
                      <div key={r.reason_type} className={styles.distributionRow}>
                        <span>
                          {REJECT_REASON_TYPE_LABELS[
                            r.reason_type as keyof typeof REJECT_REASON_TYPE_LABELS
                          ] ?? r.reason_type}
                        </span>
                        <span className={styles.distributionCount}>
                          {r.count} · {r.pct}%
                        </span>
                      </div>
                    ))}
                  </div>
                </Card>
              )}

              {data.class_distribution.length > 0 && (
                <Card>
                  <div className={styles.sectionTitle}>类别覆盖(top {data.class_distribution.length})</div>
                  <div className={styles.distribution}>
                    {data.class_distribution.map((c) => (
                      <div key={c.class_name} className={styles.distributionRow}>
                        <span>{c.class_name}</span>
                        <span className={styles.distributionCount}>
                          {c.count} · {c.pct}%
                        </span>
                      </div>
                    ))}
                  </div>
                </Card>
              )}

              {data.timeline.length > 0 && (
                <Card>
                  <div className={styles.sectionTitle}>
                    最近 timeline ({data.timeline.length})
                  </div>
                  <div className={styles.timeline}>
                    {data.timeline.map((t, i) => (
                      <div
                        key={i}
                        className={styles.timelineRow}
                      >
                        <Badge variant="outline">{t.action}</Badge>
                        {t.task_display_id && (
                          <span className={`mono ${styles.timelineTask}`}>
                            {t.task_display_id}
                          </span>
                        )}
                        <span className={styles.timelineAt}>
                          {t.at ? new Date(t.at).toLocaleString("zh-CN") : "—"}
                        </span>
                      </div>
                    ))}
                  </div>
                </Card>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function KpiCell({ label, value }: { label: string; value: string | number }) {
  return (
    <div className={styles.kpiCell}>
      <div className={styles.kpiLabel}>{label}</div>
      <div className={styles.kpiValue}>
        {value}
      </div>
    </div>
  );
}
