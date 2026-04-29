import { useNavigate, useSearchParams } from "react-router-dom";
import { Icon } from "@/components/ui/Icon";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Avatar } from "@/components/ui/Avatar";
import { StatCard } from "@/components/ui/StatCard";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { useToastStore } from "@/components/ui/Toast";
import { useAdminStats } from "@/hooks/useDashboard";
import { useProjects } from "@/hooks/useProjects";
import { ROLE_LABELS } from "@/constants/roles";
import { CreateProjectWizard } from "@/components/projects/CreateProjectWizard";
import type { UserRole } from "@/types";

export function AdminDashboard() {
  const { data: stats, isLoading } = useAdminStats();
  const { data: projects = [], isLoading: projectsLoading } = useProjects();
  const navigate = useNavigate();
  const pushToast = useToastStore((s) => s.push);
  const [searchParams, setSearchParams] = useSearchParams();
  const wizardOpen = searchParams.get("new") === "1";

  const openWizard = () => {
    const next = new URLSearchParams(searchParams);
    next.set("new", "1");
    setSearchParams(next);
  };
  const closeWizard = () => {
    const next = new URLSearchParams(searchParams);
    next.delete("new");
    setSearchParams(next, { replace: true });
  };

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
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 24, marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 600, margin: "0 0 4px", letterSpacing: "-0.01em" }}>平台概览</h1>
          <p style={{ color: "var(--color-fg-muted)", fontSize: 13, margin: 0 }}>全局平台运行状态与资源分布</p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Button onClick={() => pushToast({ msg: "导入数据集面板已打开", sub: "支持 OSS / 本地 / 数据库" })}>
            <Icon name="upload" size={13} />导入数据集
          </Button>
          <Button variant="primary" onClick={openWizard}>
            <Icon name="plus" size={13} />新建项目
          </Button>
          <CreateProjectWizard open={wizardOpen} onClose={closeWizard} />
        </div>
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

      <Card style={{ marginTop: 16 }}>
        <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--color-border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>全平台项目</h3>
          <span style={{ fontSize: 12, color: "var(--color-fg-subtle)" }}>共 {projects.length} 个</span>
        </div>
        {projectsLoading && (
          <div style={{ padding: 32, textAlign: "center", color: "var(--color-fg-subtle)", fontSize: 13 }}>加载中...</div>
        )}
        {!projectsLoading && projects.length === 0 && (
          <div style={{ padding: 32, textAlign: "center", color: "var(--color-fg-subtle)", fontSize: 13 }}>
            暂无项目，点击右上角「新建项目」开始
          </div>
        )}
        {!projectsLoading && projects.length > 0 && (
          <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0, fontSize: 13 }}>
            <thead>
              <tr>
                {["项目", "负责人", "成员", "状态", ""].map((h, i) => (
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
              {projects.map((p) => (
                <tr key={p.id} style={{ cursor: "pointer" }} onClick={() => navigate(`/projects/${p.id}/settings`)}>
                  <td style={{ padding: "10px 12px 10px 16px", borderBottom: "1px solid var(--color-border)" }}>
                    <div style={{ fontSize: 13, fontWeight: 500 }}>{p.name}</div>
                    <div style={{ fontSize: 11, color: "var(--color-fg-subtle)" }}>
                      <span className="mono">{p.display_id}</span> · {p.type_label}
                    </div>
                  </td>
                  <td style={{ padding: 12, borderBottom: "1px solid var(--color-border)" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <Avatar initial={p.owner_name?.slice(0, 1) ?? "?"} size="sm" />
                      <span style={{ fontSize: 12.5 }}>{p.owner_name ?? "—"}</span>
                    </div>
                  </td>
                  <td style={{ padding: 12, borderBottom: "1px solid var(--color-border)", color: "var(--color-fg-muted)" }}>
                    {p.member_count}
                  </td>
                  <td style={{ padding: 12, borderBottom: "1px solid var(--color-border)" }}>
                    {p.status === "in_progress" && <Badge variant="accent" dot>进行中</Badge>}
                    {p.status === "completed" && <Badge variant="success" dot>已完成</Badge>}
                    {p.status === "pending_review" && <Badge variant="warning" dot>待审核</Badge>}
                    {p.status === "archived" && <Badge variant="outline" dot>已归档</Badge>}
                  </td>
                  <td style={{ padding: "10px 16px 10px 12px", borderBottom: "1px solid var(--color-border)", textAlign: "right" }}>
                    <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); navigate(`/projects/${p.id}/settings`); }}>
                      <Icon name="settings" size={13} />设置
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
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
