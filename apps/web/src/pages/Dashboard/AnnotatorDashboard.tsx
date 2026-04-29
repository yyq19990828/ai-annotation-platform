import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Icon } from "@/components/ui/Icon";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { StatCard } from "@/components/ui/StatCard";
import { Sparkline } from "@/components/ui/Sparkline";
import { useToastStore } from "@/components/ui/Toast";
import { useAnnotatorStats } from "@/hooks/useDashboard";
import { useProjects } from "@/hooks/useProjects";
import { SelectProjectModal } from "@/components/dashboard/SelectProjectModal";

export function AnnotatorDashboard() {
  const { data: stats, isLoading } = useAnnotatorStats();
  const { data: myProjects = [] } = useProjects();
  const navigate = useNavigate();
  const pushToast = useToastStore((s) => s.push);
  const [pickerOpen, setPickerOpen] = useState(false);

  const startAnnotating = () => {
    if (myProjects.length === 0) {
      pushToast({ msg: "暂无分配项目，请联系管理员" });
      return;
    }
    if (myProjects.length === 1) {
      navigate(`/projects/${myProjects[0].id}/annotate`);
      return;
    }
    setPickerOpen(true);
  };

  const sortedProjects = useMemo(
    () =>
      [...myProjects].sort((a, b) => {
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

  const weeklyTarget = 200;
  const weeklyPct = Math.min(Math.round((stats.weekly_completed / weeklyTarget) * 100), 100);
  const noProjects = myProjects.length === 0;

  return (
    <div style={{ padding: "20px 28px 40px", maxWidth: 1480, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 600, margin: "0 0 4px", letterSpacing: "-0.01em" }}>我的工作台</h1>
          <p style={{ color: "var(--color-fg-muted)", fontSize: 13, margin: 0 }}>查看任务进度，高效完成标注工作</p>
        </div>
        <Button variant="primary" onClick={startAnnotating} disabled={noProjects} title={noProjects ? "暂无分配项目" : undefined}>
          <Icon name="target" size={13} />开始标注
        </Button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 20 }}>
        <StatCard icon="flag" label="待标任务" value={stats.assigned_tasks} />
        <StatCard icon="check" label="今日完成" value={stats.today_completed} />
        <StatCard icon="activity" label="本周完成" value={stats.weekly_completed} hint={`目标 ${weeklyTarget}`} />
        <StatCard icon="sparkles" label="准确率" value={`${stats.personal_accuracy}%`} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 12 }}>
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
            <div style={{ marginTop: 16 }}>
              <Button onClick={startAnnotating} disabled={noProjects}>
                <Icon name="target" size={12} />继续标注
              </Button>
            </div>
          </div>
        </Card>
      </div>

      <Card style={{ marginTop: 12 }}>
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
              {sortedProjects.map((p) => {
                const remaining = Math.max(0, (p.total_tasks ?? 0) - (p.completed_tasks ?? 0));
                const pct = p.total_tasks ? Math.round(((p.completed_tasks ?? 0) / p.total_tasks) * 100) : 0;
                return (
                  <tr
                    key={p.id}
                    style={{ cursor: "pointer" }}
                    onClick={() => navigate(`/projects/${p.id}/annotate`)}
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
                        onClick={(e) => { e.stopPropagation(); navigate(`/projects/${p.id}/annotate`); }}
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

      <SelectProjectModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        projects={sortedProjects}
        onPick={(id) => navigate(`/projects/${id}/annotate`)}
      />
    </div>
  );
}
