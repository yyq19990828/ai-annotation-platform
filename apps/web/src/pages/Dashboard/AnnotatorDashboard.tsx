import { useMemo } from "react";
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
import { MyBatchesCard } from "./MyBatchesCard";
import { buildWorkbenchUrl, currentWorkbenchReturnTo } from "@/utils/workbenchNavigation";

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
      [...myProjects].sort((a: any, b: any) => {
        const ra = Math.max(0, (a.total_tasks ?? 0) - (a.completed_tasks ?? 0));
        const rb = Math.max(0, (b.total_tasks ?? 0) - (b.completed_tasks ?? 0));
        return rb - ra;
      }),
    [myProjects],
  );

  if (isLoading || !stats) {
    return (
      <div style={{ padding: "60px 28px", textAlign: "center", color: "var(--color-fg-subtle)" }}>
        加载中...
      </div>
    );
  }

  const weeklyTarget = stats.weekly_target ?? 200;
  const weeklyPct = Math.min(Math.round((stats.weekly_completed / weeklyTarget) * 100), 100);
  const noProjects = myProjects.length === 0;
  const trendPct = stats.weekly_compare_pct ?? undefined;

  return (
    <div style={{ padding: "20px 28px 40px", maxWidth: 1480, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 12 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 600, margin: "0 0 4px", letterSpacing: "-0.01em" }}>标注工作台</h1>
          <p style={{ color: "var(--color-fg-muted)", fontSize: 13, margin: 0 }}>查看任务进度，高效完成标注工作</p>
        </div>
        <Button variant="primary" onClick={() => navigate("/annotate")}>
          <Icon name="target" size={13} />进入标注页面
        </Button>
      </div>

      {/* M1 · 退回待重做提示 */}
      {(stats.rejected_tasks_count ?? 0) > 0 && (
        <div
          style={{
            margin: "0 0 16px",
            padding: "12px 16px",
            background: "color-mix(in oklab, var(--color-danger) 8%, transparent)",
            border: "1px solid color-mix(in oklab, var(--color-danger) 30%, transparent)",
            borderRadius: "var(--radius-md)",
            display: "flex", alignItems: "center", gap: 12,
          }}
        >
          <Icon name="warning" size={16} style={{ color: "var(--color-danger)", flexShrink: 0 }} />
          <div style={{ flex: 1 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: "var(--color-danger)" }}>
              {stats.rejected_tasks_count} 个任务被退回，需重做
            </span>
            <span style={{ fontSize: 12, color: "var(--color-fg-muted)", marginLeft: 8 }}>
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
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
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
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
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
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
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
      <Card style={{ marginTop: 16 }}>
        <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--color-border)" }}>
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>今日专注时段分布</h3>
          <p style={{ margin: "4px 0 0", fontSize: 11, color: "var(--color-fg-subtle)" }}>
            按小时聚合的标注分钟数（0-23 时）
          </p>
        </div>
        <div style={{ padding: "20px 16px" }}>
          <Histogram
            values={stats.hour_buckets ?? Array(24).fill(0)}
            height={80}
            xLabels={["00:00", ...Array(22).fill(""), "23:00"]}
          />
        </div>
      </Card>

      <div style={{ height: 16 }} />
      <MyBatchesCard />

      <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 12, marginTop: 16 }}>
        <Card>
          <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--color-border)" }}>
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>近 7 天标注趋势</h3>
          </div>
          <div style={{ padding: "20px 16px" }}>
            <Sparkline values={stats.daily_counts} color="var(--color-accent)" width={480} height={80} />
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, fontSize: 11, color: "var(--color-fg-subtle)" }}>
              <span>7 天前</span>
              <span>今天</span>
            </div>
          </div>
        </Card>

        <Card>
          <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--color-border)" }}>
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>本周目标进度</h3>
          </div>
          <div style={{ padding: 20, textAlign: "center" }}>
            <div style={{ position: "relative", width: 120, height: 120, margin: "0 auto 16px" }}>
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
              <div style={{
                position: "absolute", inset: 0,
                display: "flex", flexDirection: "column",
                alignItems: "center", justifyContent: "center",
              }}>
                <span style={{ fontSize: 22, fontWeight: 600 }}>{weeklyPct}%</span>
                <span style={{ fontSize: 11, color: "var(--color-fg-muted)" }}>完成率</span>
              </div>
            </div>
            <div style={{ fontSize: 13, color: "var(--color-fg-muted)" }}>
              {stats.weekly_completed} / {weeklyTarget} 个标注
            </div>
          </div>
        </Card>
      </div>

      <Card style={{ marginTop: 16 }}>
        <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--color-border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>我的项目</h3>
          <span style={{ fontSize: 12, color: "var(--color-fg-subtle)" }}>共 {sortedProjects.length} 个</span>
        </div>
        {noProjects ? (
          <div style={{ padding: "32px 16px", textAlign: "center", color: "var(--color-fg-subtle)", fontSize: 13 }}>
            <Icon name="folder" size={28} style={{ opacity: 0.25, marginBottom: 8 }} />
            <div>暂无分配项目</div>
            <div style={{ fontSize: 11.5, marginTop: 4 }}>请联系项目管理员将你加入项目成员</div>
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0, fontSize: 13 }}>
            <thead>
              <tr>
                {["项目", "类型", "进度", "待标", ""].map((h, i) => (
                  <th key={i} style={{
                    textAlign: "left", fontWeight: 500, fontSize: 12,
                    color: "var(--color-fg-muted)", padding: "10px 12px",
                    borderBottom: "1px solid var(--color-border)",
                    background: "var(--color-bg-sunken)",
                    ...(i === 0 ? { paddingLeft: 16 } : {}),
                    ...(i === 4 ? { paddingRight: 16 } : {}),
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedProjects.map((p: any) => {
                const remaining = Math.max(0, (p.total_tasks ?? 0) - (p.completed_tasks ?? 0));
                const pct = p.total_tasks ? Math.round(((p.completed_tasks ?? 0) / p.total_tasks) * 100) : 0;
                return (
                  <tr
                    key={p.id}
                    style={{ cursor: "pointer" }}
                    onClick={() => openWorkbench(p.id)}
                  >
                    <td style={{ padding: "10px 12px 10px 16px", borderBottom: "1px solid var(--color-border)" }}>
                      <div style={{ fontSize: 13, fontWeight: 500 }}>{p.name}</div>
                      <div style={{ fontSize: 11, color: "var(--color-fg-subtle)" }}>
                        <span className="mono">{p.display_id}</span>
                      </div>
                    </td>
                    <td style={{ padding: 12, borderBottom: "1px solid var(--color-border)", color: "var(--color-fg-muted)", fontSize: 12 }}>
                      {p.type_label}
                    </td>
                    <td style={{ padding: 12, borderBottom: "1px solid var(--color-border)", fontSize: 12, color: "var(--color-fg-muted)" }}>
                      {p.completed_tasks ?? 0} / {p.total_tasks ?? 0} <span className="mono">({pct}%)</span>
                    </td>
                    <td style={{ padding: 12, borderBottom: "1px solid var(--color-border)" }}>
                      <Badge variant={remaining > 0 ? "accent" : "outline"} style={{ fontSize: 11 }}>{remaining}</Badge>
                    </td>
                    <td style={{ padding: "10px 16px 10px 12px", borderBottom: "1px solid var(--color-border)", textAlign: "right" }}>
                      <Button
                        size="sm"
                        variant="primary"
                        onClick={(e: any) => { e.stopPropagation(); openWorkbench(p.id); }}
                      >
                        <Icon name="target" size={11} />打开
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>

    </div>
  );
}
