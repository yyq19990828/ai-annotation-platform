import { useMemo, type MouseEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Icon } from "@/components/ui/Icon";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { StatCard } from "@/components/ui/StatCard";
import { Sparkline } from "@/components/ui/Sparkline";
import { Histogram } from "@/components/ui/Histogram";
import { SectionDivider } from "@/components/ui/SectionDivider";
import { useAnnotatorStats } from "@/hooks/useDashboard";
import { useProjects } from "@/hooks/useProjects";
import type { ProjectResponse } from "@/api/projects";
import { MyBatchesCard } from "./MyBatchesCard";
import { buildWorkbenchUrl, currentWorkbenchReturnTo } from "@/utils/workbenchNavigation";
import { projectDisplayType } from "@/utils/projectDisplay";
import styles from "./AnnotatorDashboard.module.css";

function formatMs(ms: number | null | undefined): string {
  if (ms == null) return "—";
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return `${m}m${s.toString().padStart(2, "0")}s`;
}

export function AnnotatorDashboard() {
  const { data: stats, isLoading } = useAnnotatorStats();
  const { data: myProjects = [] } = useProjects();
  const navigate = useNavigate();
  const location = useLocation();
  const openWorkbench = (projectId: string) =>
    navigate(buildWorkbenchUrl(projectId, { returnTo: currentWorkbenchReturnTo(location) }));

  const sortedProjects = useMemo(
    () =>
      [...myProjects].sort((a: ProjectResponse, b: ProjectResponse) => {
        const ra = Math.max(0, (a.total_tasks ?? 0) - (a.completed_tasks ?? 0));
        const rb = Math.max(0, (b.total_tasks ?? 0) - (b.completed_tasks ?? 0));
        return rb - ra;
      }),
    [myProjects],
  );

  if (isLoading || !stats) {
    return (
      <div className={styles.loading}>
        加载中...
      </div>
    );
  }

  const weeklyTarget = stats.weekly_target ?? 200;
  const weeklyPct = Math.min(Math.round((stats.weekly_completed / weeklyTarget) * 100), 100);
  const noProjects = myProjects.length === 0;
  const trendPct = stats.weekly_compare_pct ?? undefined;

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>标注工作台</h1>
          <p className={styles.subtitle}>查看任务进度，高效完成标注工作</p>
        </div>
        <Button variant="primary" onClick={() => navigate("/annotate")}>
          <Icon name="target" size={13} />进入标注页面
        </Button>
      </div>

      {/* M1 · 退回待重做提示 */}
      {(stats.rejected_tasks_count ?? 0) > 0 && (
        <div className={styles.rejectedAlert}>
          <Icon name="warning" size={16} className={styles.rejectedIcon} />
          <div className={styles.rejectedContent}>
            <span className={styles.rejectedTitle}>
              {stats.rejected_tasks_count} 个任务被退回，需重做
            </span>
            <span className={styles.rejectedText}>
              请进入工作台查看退回原因并重新提交
            </span>
          </div>
          <Button size="sm" variant="danger" onClick={() => navigate("/annotate")}>
            进入工作台
          </Button>
        </div>
      )}

      {/* 产能 */}
      <SectionDivider label="产能" hint="完成数 / 单题耗时" />
      <div className={styles.statsGridFour}>
        <StatCard icon="flag" label="待标任务" value={stats.assigned_tasks} />
        <StatCard icon="check" label="今日完成" value={stats.today_completed} />
        <StatCard
          icon="activity"
          label="本周完成"
          value={stats.weekly_completed}
          trend={trendPct}
          hint={`目标 ${weeklyTarget}`}
          sparkValues={stats.daily_counts}
        />
        <StatCard
          icon="clock"
          label="平均单题耗时"
          value={formatMs(stats.median_duration_ms)}
          hint="中位 / 30 天"
        />
      </div>

      {/* 质量 */}
      <SectionDivider label="质量" hint="原创比例 / 退回率 / 重审次数" />
      <div className={styles.statsGridThree}>
        <StatCard icon="sparkles" label="原创比例" value={`${stats.personal_accuracy}%`} />
        <StatCard
          icon="alert-triangle"
          label="被退回率"
          value={stats.rejected_rate == null ? "—" : `${stats.rejected_rate}%`}
          hint="所有提交"
        />
        <StatCard
          icon="rotate-ccw"
          label="重审次数 avg"
          value={stats.reopened_avg == null ? "—" : stats.reopened_avg.toFixed(2)}
          hint="人均"
        />
      </div>

      {/* 投入（依赖心跳；本期占位） */}
      <SectionDivider label="投入" hint="活跃时长 / 连续天数（待心跳上线）" />
      <div className={styles.statsGridThree}>
        <StatCard
          icon="clock"
          label="今日活跃时长"
          value={stats.active_minutes_today == null ? "—" : `${stats.active_minutes_today}m`}
          hint="心跳依赖"
        />
        <StatCard
          icon="flame"
          label="连续标注天数"
          value={stats.streak_days == null ? "—" : `${stats.streak_days}天`}
          hint="心跳依赖"
        />
        <StatCard icon="layers" label="累计标注" value={stats.total_completed} />
      </div>

      {/* v0.8.5 · 24-bar 当日专注时段分布 */}
      <div className={styles.cardStack}>
        <Card>
        <div className={styles.cardHeaderPlain}>
          <h3 className={styles.cardTitle}>今日专注时段分布</h3>
          <p className={styles.cardHint}>
            按小时聚合的标注分钟数（0-23 时）
          </p>
        </div>
        <div className={styles.cardBody}>
          <Histogram
            values={stats.hour_buckets ?? Array(24).fill(0)}
            height={80}
            xLabels={["00:00", ...Array(22).fill(""), "23:00"]}
          />
        </div>
        </Card>
      </div>

      <div className={styles.gap} />
      <MyBatchesCard />

      <div className={styles.analyticsGrid}>
        <Card>
          <div className={styles.cardHeaderPlain}>
            <h3 className={styles.cardTitle}>近 7 天标注趋势</h3>
          </div>
          <div className={styles.cardBody}>
            <Sparkline values={stats.daily_counts} color="var(--color-accent)" width={480} height={80} />
            <div className={styles.sparklineLabels}>
              <span>7 天前</span>
              <span>今天</span>
            </div>
          </div>
        </Card>

        <Card>
          <div className={styles.cardHeaderPlain}>
            <h3 className={styles.cardTitle}>本周目标进度</h3>
          </div>
          <div className={styles.goalBody}>
            <div className={styles.goalChart}>
              <svg viewBox="0 0 120 120" width={120} height={120}>
                <circle cx="60" cy="60" r="52" fill="none" stroke="var(--color-border)" strokeWidth="8" />
                <circle
                  cx="60" cy="60" r="52" fill="none"
                  stroke="var(--color-accent)" strokeWidth="8"
                  strokeLinecap="round"
                  strokeDasharray={`${weeklyPct * 3.27} ${327 - weeklyPct * 3.27}`}
                  transform="rotate(-90 60 60)"
                />
              </svg>
              <div className={styles.goalCenter}>
                <span className={styles.goalPct}>{weeklyPct}%</span>
                <span className={styles.goalLabel}>完成率</span>
              </div>
            </div>
            <div className={styles.goalMeta}>
              {stats.weekly_completed} / {weeklyTarget} 个标注
            </div>
          </div>
        </Card>
      </div>

      <div className={styles.cardStack}>
        <Card>
        <div className={styles.cardHeaderSplit}>
          <h3 className={styles.cardTitle}>我的项目</h3>
          <span className={styles.cardCount}>共 {sortedProjects.length} 个</span>
        </div>
        {noProjects ? (
          <div className={styles.emptyState}>
            <Icon name="folder" size={28} className={styles.emptyIcon} />
            <div>暂无分配项目</div>
            <div className={styles.emptyHint}>请联系项目管理员将你加入项目成员</div>
          </div>
        ) : (
          <div className={styles.tableScroller}>
            <table className={styles.table}>
              <thead>
                <tr>
                  {["项目", "类型", "进度", "待标", ""].map((h, i) => (
                    <th key={i}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedProjects.map((p) => {
                  const remaining = Math.max(0, (p.total_tasks ?? 0) - (p.completed_tasks ?? 0));
                  const pct = p.total_tasks ? Math.round(((p.completed_tasks ?? 0) / p.total_tasks) * 100) : 0;
                  return (
                    <tr
                      key={p.id}
                      className={styles.clickableRow}
                      onClick={() => openWorkbench(p.id)}
                    >
                      <td>
                        <div className={styles.projectName}>{p.name}</div>
                        <div className={styles.projectId}>
                          <span className="mono">{p.display_id}</span>
                        </div>
                      </td>
                      <td className={styles.mutedCell}>
                        {projectDisplayType(p)}
                      </td>
                      <td className={styles.mutedCell}>
                        {p.completed_tasks ?? 0} / {p.total_tasks ?? 0} <span className="mono">({pct}%)</span>
                      </td>
                      <td>
                        <span className={styles.smallBadge}>
                          <Badge variant={remaining > 0 ? "accent" : "outline"}>{remaining}</Badge>
                        </span>
                      </td>
                      <td className={styles.actionCell}>
                        <Button
                          size="sm"
                          variant="primary"
                          onClick={(e: MouseEvent<HTMLButtonElement>) => { e.stopPropagation(); openWorkbench(p.id); }}
                        >
                          <Icon name="target" size={11} />打开
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        </Card>
      </div>

    </div>
  );
}
