import { Icon } from "@/components/ui/Icon";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { StatCard } from "@/components/ui/StatCard";
import { Sparkline } from "@/components/ui/Sparkline";
import { useAnnotatorStats } from "@/hooks/useDashboard";
import { useToastStore } from "@/components/ui/Toast";

export function AnnotatorDashboard() {
  const { data: stats, isLoading } = useAnnotatorStats();
  const pushToast = useToastStore((s) => s.push);
  const startAnnotating = () =>
    pushToast({ msg: "请从分配给你的项目中选择一个开始", sub: "项目列表面板将在后续版本上线" });

  if (isLoading || !stats) {
    return (
      <div style={{ padding: "60px 28px", textAlign: "center", color: "var(--color-fg-subtle)" }}>
        加载中...
      </div>
    );
  }

  const weeklyTarget = 200;
  const weeklyPct = Math.min(Math.round((stats.weekly_completed / weeklyTarget) * 100), 100);

  return (
    <div style={{ padding: "20px 28px 40px", maxWidth: 1480, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 600, margin: "0 0 4px", letterSpacing: "-0.01em" }}>我的工作台</h1>
          <p style={{ color: "var(--color-fg-muted)", fontSize: 13, margin: 0 }}>查看任务进度，高效完成标注工作</p>
        </div>
        <Button variant="primary" onClick={startAnnotating}>
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
              <Button onClick={startAnnotating}>
                <Icon name="target" size={12} />继续标注
              </Button>
            </div>
          </div>
        </Card>
      </div>

      <Card style={{ marginTop: 12 }}>
        <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--color-border)" }}>
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>个人统计</h3>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 0 }}>
          <StatItem label="累计完成" value={stats.total_completed.toLocaleString()} />
          <StatItem label="今日完成" value={String(stats.today_completed)} />
          <StatItem label="准确率" value={`${stats.personal_accuracy}%`} color="var(--color-success)" />
        </div>
      </Card>
    </div>
  );
}

function StatItem({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ padding: "16px 20px", borderRight: "1px solid var(--color-border)" }}>
      <div style={{ fontSize: 11.5, color: "var(--color-fg-muted)", marginBottom: 4 }}>{label}</div>
      <div className="mono" style={{ fontSize: 18, fontWeight: 600, color: color ?? "var(--color-fg)" }}>{value}</div>
    </div>
  );
}
