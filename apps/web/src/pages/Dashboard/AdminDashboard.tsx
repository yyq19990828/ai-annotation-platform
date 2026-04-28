import { Icon } from "@/components/ui/Icon";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { StatCard } from "@/components/ui/StatCard";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { useAdminStats } from "@/hooks/useDashboard";
import { ROLE_LABELS } from "@/constants/roles";
import type { UserRole } from "@/types";

export function AdminDashboard() {
  const { data: stats, isLoading } = useAdminStats();

  if (isLoading || !stats) {
    return (
      <div style={{ padding: "60px 28px", textAlign: "center", color: "var(--color-fg-subtle)" }}>
        加载中...
      </div>
    );
  }

  const projectsTotal = stats.total_projects || 1;

  return (
    <div style={{ padding: "20px 28px 40px", maxWidth: 1480, margin: "0 auto" }}>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 20, fontWeight: 600, margin: "0 0 4px", letterSpacing: "-0.01em" }}>平台概览</h1>
        <p style={{ color: "var(--color-fg-muted)", fontSize: 13, margin: 0 }}>全局平台运行状态与资源分布</p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 20 }}>
        <StatCard icon="users" label="用户总数" value={stats.total_users} hint={`${stats.active_users} 在线`} />
        <StatCard icon="layers" label="项目总数" value={stats.total_projects} hint={`${stats.projects_in_progress} 进行中`} />
        <StatCard icon="target" label="任务总量" value={stats.total_tasks.toLocaleString()} />
        <StatCard icon="check" label="标注总量" value={stats.total_annotations.toLocaleString()} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
        <Card>
          <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--color-border)" }}>
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>项目状态分布</h3>
          </div>
          <div style={{ padding: 16 }}>
            <StatusBar label="进行中" count={stats.projects_in_progress} total={projectsTotal} color="var(--color-accent)" />
            <StatusBar label="已完成" count={stats.projects_completed} total={projectsTotal} color="var(--color-success)" />
            <StatusBar label="待审核" count={stats.projects_pending_review} total={projectsTotal} color="var(--color-warning)" />
            <StatusBar label="已归档" count={stats.projects_archived} total={projectsTotal} color="var(--color-fg-subtle)" />
          </div>
        </Card>

        <Card>
          <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--color-border)" }}>
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>用户角色分布</h3>
          </div>
          <div style={{ padding: 16 }}>
            {Object.entries(stats.role_distribution).map(([role, count]) => (
              <div key={role} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 0" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <Badge variant="outline">{ROLE_LABELS[role as UserRole] ?? role}</Badge>
                </div>
                <span className="mono" style={{ fontSize: 13, fontWeight: 500 }}>{count}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card>
        <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--color-border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>ML 后端状态</h3>
          <Badge variant={stats.ml_backends_connected > 0 ? "success" : "outline"}>
            {stats.ml_backends_connected} / {stats.ml_backends_total} 在线
          </Badge>
        </div>
        <div style={{ padding: "24px 16px", textAlign: "center", color: "var(--color-fg-subtle)", fontSize: 13 }}>
          {stats.ml_backends_total === 0 ? (
            <>
              <Icon name="bot" size={28} style={{ opacity: 0.25, marginBottom: 8 }} />
              <div>暂无已注册的 ML 后端</div>
              <div style={{ fontSize: 11.5, marginTop: 4 }}>在项目设置中添加模型服务</div>
            </>
          ) : (
            <div style={{ fontSize: 13 }}>
              已注册 {stats.ml_backends_total} 个模型后端，{stats.ml_backends_connected} 个在线
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}

function StatusBar({ label, count, total, color }: { label: string; count: number; total: number; color: string }) {
  const pct = Math.round((count / total) * 100);
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
        <span style={{ color: "var(--color-fg-muted)" }}>{label}</span>
        <span className="mono" style={{ fontWeight: 500 }}>{count} ({pct}%)</span>
      </div>
      <ProgressBar value={pct} color={color} />
    </div>
  );
}
