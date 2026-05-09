import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Icon } from "@/components/ui/Icon";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Avatar } from "@/components/ui/Avatar";
import { StatCard } from "@/components/ui/StatCard";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { useAdminStats, usePredictionCostStats } from "@/hooks/useDashboard";
import { useProjects } from "@/hooks/useProjects";
import { useAuditLogs } from "@/hooks/useAudit";
import { ROLE_LABELS } from "@/constants/roles";
import { CreateProjectWizard } from "@/components/projects/CreateProjectWizard";
import { ImportDatasetWizard } from "@/components/datasets/ImportDatasetWizard";
import { auditActionLabel } from "@/utils/auditLabels";
import type { UserRole } from "@/types";

export function AdminDashboard() {
  const { data: stats, isLoading } = useAdminStats();
  const { data: projects = [], isLoading: projectsLoading } = useProjects();
  const { data: audit } = useAuditLogs({ page: 1, page_size: 8 });
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const wizardOpen = searchParams.get("new") === "1";
  const [importOpen, setImportOpen] = useState(false);

  const recentActivity = (audit?.items ?? []).filter((it) => !it.action.startsWith("http.")).slice(0, 8);

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
          <Button onClick={() => setImportOpen(true)}>
            <Icon name="upload" size={13} />导入数据集
          </Button>
          <ImportDatasetWizard
            open={importOpen}
            onClose={() => setImportOpen(false)}
            onUploaded={() => navigate("/datasets")}
          />
          <Button variant="primary" onClick={openWizard}>
            <Icon name="plus" size={13} />新建项目
          </Button>
          <CreateProjectWizard open={wizardOpen} onClose={closeWizard} />
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, marginBottom: 12 }}>
        <StatCard icon="users" label="用户总数" value={stats.total_users} hint={`${stats.active_users} 在线`} />
        <StatCard icon="layers" label="项目总数" value={stats.total_projects} hint={`${stats.projects_in_progress} 进行中`} />
        <StatCard icon="target" label="任务总量" value={stats.total_tasks.toLocaleString()} />
        <StatCard icon="check" label="标注总量" value={stats.total_annotations.toLocaleString()} />
      </div>

      {/* v0.8.4 · 成员绩效入口 */}
      <Card
        onClick={() => navigate("/admin/people")}
        style={{
          cursor: "pointer",
          padding: "12px 16px",
          marginBottom: 20,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Icon name="users" size={16} />
          <div>
            <div style={{ fontSize: 13, fontWeight: 600 }}>成员绩效</div>
            <div style={{ fontSize: 11, color: "var(--color-fg-muted)" }}>
              全员效率卡片网格 + 抽屉下钻
            </div>
          </div>
        </div>
        <span style={{ fontSize: 12, color: "var(--color-accent)" }}>
          打开 <Icon name="chevRight" size={11} />
        </span>
      </Card>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 12, marginBottom: 16 }}>
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

      {/* v0.9.5 · AI 预标注队列卡片（仅在有 pre_annotated 批次时显示） */}
      {(stats.pre_annotated_batches ?? 0) > 0 && (
        <Card
          onClick={() => navigate("/ai-pre")}
          style={{
            cursor: "pointer",
            padding: 16,
            marginBottom: 12,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            background: "var(--color-ai-soft)",
            border: "1px solid var(--color-border)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <Icon name="wandSparkles" size={18} style={{ color: "var(--color-ai)" }} />
            <div>
              <div style={{ fontSize: 14, fontWeight: 600 }}>
                AI 预标注队列 · {stats.pre_annotated_batches} 批待接管
              </div>
              <div style={{ fontSize: 12, color: "var(--color-fg-muted)" }}>
                文本批量预标已跑完，等待人工分派接管
              </div>
            </div>
          </div>
          <span style={{ fontSize: 12, color: "var(--color-ai)" }}>
            进入 <Icon name="chevRight" size={11} />
          </span>
        </Card>
      )}

      <RegistrationSourceCard series={stats.registration_by_day ?? []} />

      <MLBackendsAndCostCard
        backendsTotal={stats.ml_backends_total}
        backendsConnected={stats.ml_backends_connected}
      />

      {/* v0.8.6 F6 · 失败预测入口（super_admin / project_admin 可见）; v0.9.12 改指向 /ai-pre/jobs */}
      <Card
        onClick={() => navigate("/ai-pre/jobs?status=failed")}
        style={{
          cursor: "pointer",
          padding: "12px 16px",
          marginTop: 12,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Icon name="warning" size={16} style={{ color: "var(--color-warning)" }} />
          <div>
            <div style={{ fontSize: 13, fontWeight: 600 }}>失败预测管理</div>
            <div style={{ fontSize: 11, color: "var(--color-fg-muted)" }}>
              查看 ML Backend 调用失败的预测，并按需重试 (单条最多 3 次)
            </div>
          </div>
        </div>
        <span style={{ fontSize: 12, color: "var(--color-accent)" }}>
          打开 <Icon name="chevRight" size={11} />
        </span>
      </Card>


      <Card style={{ marginTop: 16 }}>
        <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--color-border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>近期审计活动</h3>
          <Button size="sm" variant="ghost" onClick={() => navigate("/audit")}>
            查看全部<Icon name="chevRight" size={11} />
          </Button>
        </div>
        {recentActivity.length === 0 ? (
          <div style={{ padding: "24px 16px", textAlign: "center", color: "var(--color-fg-subtle)", fontSize: 13 }}>
            <Icon name="activity" size={26} style={{ opacity: 0.25, marginBottom: 8 }} />
            <div>暂无业务事件</div>
          </div>
        ) : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {recentActivity.map((it) => (
              <li
                key={it.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "10px 16px",
                  borderBottom: "1px solid var(--color-border)",
                  fontSize: 12.5,
                }}
              >
                <Avatar initial={(it.actor_email ?? "?").slice(0, 1).toUpperCase()} size="sm" />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontWeight: 500 }}>{it.actor_email ?? "匿名"}</span>
                    <Badge variant="accent" style={{ fontSize: 10 }}>{auditActionLabel(it.action)}</Badge>
                    {it.target_type && (
                      <span style={{ color: "var(--color-fg-muted)", fontSize: 11 }}>
                        {it.target_type}
                        {it.target_id && (
                          <span className="mono" style={{ marginLeft: 4 }}>
                            {it.target_id.length > 24 ? it.target_id.slice(0, 8) + "…" : it.target_id}
                          </span>
                        )}
                      </span>
                    )}
                  </div>
                </div>
                <span style={{ fontSize: 11, color: "var(--color-fg-subtle)", whiteSpace: "nowrap" }}>
                  {relativeTime(it.created_at)}
                </span>
              </li>
            ))}
          </ul>
        )}
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

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.round(diff / 60000);
  if (m < 1) return "刚刚";
  if (m < 60) return `${m} 分钟前`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} 小时前`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d} 天前`;
  return new Date(iso).toLocaleDateString("zh-CN");
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

import type { RegistrationDayPoint } from "@/api/dashboard";

function RegistrationSourceCard({ series }: { series: RegistrationDayPoint[] }) {
  const totalInvite = series.reduce((s, d) => s + d.invite_count, 0);
  const totalOpen = series.reduce((s, d) => s + d.open_count, 0);
  const total = totalInvite + totalOpen;
  const peak = Math.max(1, ...series.map((d) => d.invite_count + d.open_count));

  return (
    <Card style={{ marginTop: 16 }}>
      <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--color-border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>30 天注册来源</h3>
        <div style={{ fontSize: 12, color: "var(--color-fg-muted)" }}>
          共 {total} 人 · 邀请 {totalInvite} · 开放 {totalOpen}
        </div>
      </div>
      <div style={{ padding: 16 }}>
        {total === 0 ? (
          <div style={{ textAlign: "center", color: "var(--color-fg-subtle)", fontSize: 13, padding: "20px 0" }}>
            过去 30 天暂无注册记录
          </div>
        ) : (
          <div>
            <div
              style={{
                display: "flex",
                alignItems: "flex-end",
                gap: 3,
                height: 80,
                marginBottom: 8,
              }}
            >
              {series.map((d) => {
                const inviteH = (d.invite_count / peak) * 80;
                const openH = (d.open_count / peak) * 80;
                return (
                  <div
                    key={d.date}
                    title={`${d.date}\n邀请 ${d.invite_count} · 开放 ${d.open_count}`}
                    style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "flex-end", gap: 1 }}
                  >
                    <div style={{ height: openH, background: "var(--color-success)", borderRadius: "2px 2px 0 0", minHeight: d.open_count ? 2 : 0 }} />
                    <div style={{ height: inviteH, background: "var(--color-accent)", borderRadius: openH ? 0 : "2px 2px 0 0", minHeight: d.invite_count ? 2 : 0 }} />
                  </div>
                );
              })}
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--color-fg-subtle)" }}>
              <span>{series[0]?.date}</span>
              <span>{series[series.length - 1]?.date}</span>
            </div>
            <div style={{ display: "flex", gap: 16, marginTop: 10, fontSize: 12 }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <span style={{ width: 10, height: 10, background: "var(--color-accent)", borderRadius: 2 }} />
                邀请注册
              </span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <span style={{ width: 10, height: 10, background: "var(--color-success)", borderRadius: 2 }} />
                开放注册
              </span>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

// v0.8.6 F4 · ML 后端状态 + 预测成本联合卡片
function MLBackendsAndCostCard({
  backendsTotal,
  backendsConnected,
}: {
  backendsTotal: number;
  backendsConnected: number;
}) {
  const navigate = useNavigate();
  const [range, setRange] = useState<"7d" | "30d">("30d");
  const { data: cost, isLoading } = usePredictionCostStats(range);

  const failureRatePct = cost ? (cost.failure_rate * 100).toFixed(1) : "—";
  const avgMs = cost?.avg_inference_time_ms ?? null;
  const p95Ms = cost?.p95_inference_time_ms ?? null;
  const totalCost = cost?.total_cost ?? 0;
  const totalCalls = cost?.total_predictions ?? 0;

  return (
    <Card>
      <div
        style={{
          padding: "14px 16px",
          borderBottom: "1px solid var(--color-border)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>ML 后端 · 预测成本</h3>
          <Badge variant={backendsConnected > 0 ? "success" : "outline"}>
            {backendsConnected} / {backendsTotal} 在线
          </Badge>
        </div>
        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
          <Button size="sm" variant="ghost" onClick={() => navigate("/model-market")}>
            集成总览<Icon name="chevRight" size={11} />
          </Button>
          {(["7d", "30d"] as const).map((r) => (
            <Button
              key={r}
              size="sm"
              variant={range === r ? "primary" : "ghost"}
              onClick={() => setRange(r)}
            >
              {r === "7d" ? "近 7 天" : "近 30 天"}
            </Button>
          ))}
        </div>
      </div>
      {backendsTotal === 0 ? (
        <div
          style={{
            padding: "24px 16px",
            textAlign: "center",
            color: "var(--color-fg-subtle)",
            fontSize: 13,
          }}
        >
          <Icon name="bot" size={28} style={{ opacity: 0.25, marginBottom: 8 }} />
          <div>暂无已注册的 ML 后端</div>
          <div style={{ fontSize: 11.5, marginTop: 4 }}>在项目设置中添加模型服务</div>
        </div>
      ) : (
        <div
          style={{
            padding: "16px",
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
            gap: 12,
          }}
        >
          <StatCard
            icon="activity"
            label="本期调用数"
            value={isLoading ? "…" : totalCalls.toLocaleString()}
          />
          <StatCard
            icon="clock"
            label="平均耗时"
            value={
              isLoading
                ? "…"
                : avgMs !== null
                  ? `${Math.round(avgMs)} ms`
                  : "—"
            }
            hint={
              p95Ms !== null && !isLoading
                ? `P95 ${Math.round(p95Ms)} ms`
                : undefined
            }
          />
          <StatCard
            icon="warning"
            label="失败率"
            value={isLoading ? "…" : `${failureRatePct}%`}
            hint={cost ? `${cost.failed_predictions} 次失败` : undefined}
          />
          <StatCard
            icon="sparkles"
            label="总成本"
            value={isLoading ? "…" : `$${totalCost.toFixed(4)}`}
            hint={cost ? `${cost.total_tokens.toLocaleString()} tokens` : undefined}
          />
        </div>
      )}
    </Card>
  );
}
