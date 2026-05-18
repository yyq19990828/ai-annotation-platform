import { useEffect, useRef, useState } from "react";
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
import type { RegistrationDayPoint } from "@/api/dashboard";
import styles from "./AdminDashboard.module.css";

export function AdminDashboard() {
  const { data: stats, isLoading } = useAdminStats();
  const { data: projects = [], isLoading: projectsLoading } = useProjects();
  const { data: audit } = useAuditLogs({ page: 1, page_size: 8 });
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const wizardOpen = searchParams.get("new") === "1";
  // v0.10.11 · 从 ProjectGrid "复制项目" 跳来时携带 ?from=<id>; Wizard 据此预填.
  const wizardSourceProjectId = searchParams.get("from") || undefined;
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
    next.delete("from");
    setSearchParams(next, { replace: true });
  };

  if (isLoading || !stats) {
    return (
      <div className={styles.loadingState}>
        加载中...
      </div>
    );
  }

  const projectsTotal = stats.total_projects || 1;

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.pageTitle}>平台概览</h1>
          <p className={styles.pageSubtitle}>全局平台运行状态与资源分布</p>
        </div>
        <div className={styles.headerActions}>
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
          <CreateProjectWizard
            open={wizardOpen}
            onClose={closeWizard}
            sourceProjectId={wizardSourceProjectId}
          />
        </div>
      </div>

      <div className={styles.statsGrid}>
        <StatCard icon="users" label="用户总数" value={stats.total_users} hint={`${stats.active_users} 在线`} />
        <StatCard icon="layers" label="项目总数" value={stats.total_projects} hint={`${stats.projects_in_progress} 进行中`} />
        <StatCard icon="target" label="任务总量" value={stats.total_tasks.toLocaleString()} />
        <StatCard icon="check" label="标注总量" value={stats.total_annotations.toLocaleString()} />
      </div>

      {/* v0.8.4 · 成员绩效入口 */}
      <div className={styles.entryCardShell}>
        <Card onClick={() => navigate("/admin/people")}>
          <div className={styles.entryCardContent}>
            <div className={styles.entryMain}>
              <Icon name="users" size={16} />
              <div>
                <div className={styles.entryTitle}>成员绩效</div>
                <div className={styles.entryDescription}>
                  全员效率卡片网格 + 抽屉下钻
                </div>
              </div>
            </div>
            <span className={styles.entryLink}>
              打开 <Icon name="chevRight" size={11} />
            </span>
          </div>
        </Card>
      </div>

      <div className={styles.distributionGrid}>
        <Card>
          <div className={styles.cardHeader}>
            <h3 className={styles.cardTitle}>项目状态分布</h3>
          </div>
          <div className={styles.cardBody}>
            <StatusBar label="进行中" count={stats.projects_in_progress} total={projectsTotal} color="var(--color-accent)" />
            <StatusBar label="已完成" count={stats.projects_completed} total={projectsTotal} color="var(--color-success)" />
            <StatusBar label="待审核" count={stats.projects_pending_review} total={projectsTotal} color="var(--color-warning)" />
            <StatusBar label="已归档" count={stats.projects_archived} total={projectsTotal} color="var(--color-fg-subtle)" />
          </div>
        </Card>

        <Card>
          <div className={styles.cardHeader}>
            <h3 className={styles.cardTitle}>用户角色分布</h3>
          </div>
          <div className={styles.cardBody}>
            {Object.entries(stats.role_distribution).map(([role, count]) => (
              <div key={role} className={styles.roleRow}>
                <div className={styles.roleBadge}>
                  <Badge variant="outline">{ROLE_LABELS[role as UserRole] ?? role}</Badge>
                </div>
                <span className={`mono ${styles.roleCount}`}>{count}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* v0.9.5 · AI 预标注队列卡片（仅在有 pre_annotated 批次时显示） */}
      {(stats.pre_annotated_batches ?? 0) > 0 && (
        <div className={styles.aiQueueShell}>
          <Card onClick={() => navigate("/ai-pre")}>
            <div className={styles.aiQueueCardContent}>
              <div className={styles.entryMainLarge}>
                <Icon name="wandSparkles" size={18} className={styles.aiIcon} />
                <div>
                  <div className={styles.aiQueueTitle}>
                    AI 预标注队列 · {stats.pre_annotated_batches} 批待接管
                  </div>
                  <div className={styles.aiQueueDescription}>
                    文本批量预标已跑完，等待人工分派接管
                  </div>
                </div>
              </div>
              <span className={styles.aiQueueLink}>
                进入 <Icon name="chevRight" size={11} />
              </span>
            </div>
          </Card>
        </div>
      )}

      <RegistrationSourceCard series={stats.registration_by_day ?? []} />

      <MLBackendsAndCostCard
        backendsTotal={stats.ml_backends_total}
        backendsConnected={stats.ml_backends_connected}
      />

      {/* v0.8.6 F6 · 失败预测入口（super_admin / project_admin 可见）; v0.9.12 改指向 /ai-pre/jobs */}
      <div className={styles.failedPredictionShell}>
        <Card onClick={() => navigate("/ai-pre/jobs?status=failed")}>
          <div className={styles.entryCardContent}>
            <div className={styles.entryMain}>
              <Icon name="warning" size={16} className={styles.warningIcon} />
              <div>
                <div className={styles.entryTitle}>失败预测管理</div>
                <div className={styles.entryDescription}>
                  查看 ML Backend 调用失败的预测，并按需重试 (单条最多 3 次)
                </div>
              </div>
            </div>
            <span className={styles.entryLink}>
              打开 <Icon name="chevRight" size={11} />
            </span>
          </div>
        </Card>
      </div>


      <div className={styles.cardTop}>
        <Card>
        <div className={styles.cardHeaderSplit}>
          <h3 className={styles.cardTitle}>近期审计活动</h3>
          <Button size="sm" variant="ghost" onClick={() => navigate("/audit")}>
            查看全部<Icon name="chevRight" size={11} />
          </Button>
        </div>
        {recentActivity.length === 0 ? (
          <div className={styles.emptyStateCompact}>
            <Icon name="activity" size={26} className={styles.emptyIcon} />
            <div>暂无业务事件</div>
          </div>
        ) : (
          <ul className={styles.activityList}>
            {recentActivity.map((it) => (
              <li
                key={it.id}
                className={styles.activityItem}
              >
                <Avatar initial={(it.actor_email ?? "?").slice(0, 1).toUpperCase()} size="sm" />
                <div className={styles.activityBody}>
                  <div className={styles.activityLine}>
                    <span className={styles.actorName}>{it.actor_email ?? "匿名"}</span>
                    <span className={styles.compactBadge}>
                      <Badge variant="accent">{auditActionLabel(it.action)}</Badge>
                    </span>
                    {it.target_type && (
                      <span className={styles.targetMeta}>
                        {it.target_type}
                        {it.target_id && (
                          <span className={`mono ${styles.targetId}`}>
                            {it.target_id.length > 24 ? it.target_id.slice(0, 8) + "…" : it.target_id}
                          </span>
                        )}
                      </span>
                    )}
                  </div>
                </div>
                <span className={styles.activityTime}>
                  {relativeTime(it.created_at)}
                </span>
              </li>
            ))}
          </ul>
        )}
        </Card>
      </div>

      <div className={styles.cardTop}>
        <Card>
        <div className={styles.cardHeaderSplit}>
          <h3 className={styles.cardTitle}>全平台项目</h3>
          <span className={styles.cardCount}>共 {projects.length} 个</span>
        </div>
        {projectsLoading && (
          <div className={styles.emptyState}>加载中...</div>
        )}
        {!projectsLoading && projects.length === 0 && (
          <div className={styles.emptyState}>
            暂无项目，点击右上角「新建项目」开始
          </div>
        )}
        {!projectsLoading && projects.length > 0 && (
          <table className={styles.projectTable}>
            <thead>
              <tr>
                {["项目", "负责人", "成员", "状态", ""].map((h, i) => (
                  <th
                    key={i}
                    className={[
                      styles.tableHeadCell,
                      i === 0 ? styles.tableHeadCellFirst : "",
                      i === 4 ? styles.tableHeadCellLast : "",
                    ].filter(Boolean).join(" ")}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {projects.map((p) => (
                <tr key={p.id} className={styles.projectRow} onClick={() => navigate(`/projects/${p.id}/settings`)}>
                  <td className={`${styles.tableCell} ${styles.tableCellFirst}`}>
                    <div className={styles.projectName}>{p.name}</div>
                    <div className={styles.projectMeta}>
                      <span className="mono">{p.display_id}</span> · {p.type_label}
                    </div>
                  </td>
                  <td className={styles.tableCell}>
                    <div className={styles.ownerCell}>
                      <Avatar initial={p.owner_name?.slice(0, 1) ?? "?"} size="sm" />
                      <span className={styles.ownerName}>{p.owner_name ?? "—"}</span>
                    </div>
                  </td>
                  <td className={`${styles.tableCell} ${styles.mutedCell}`}>
                    {p.member_count}
                  </td>
                  <td className={styles.tableCell}>
                    {p.status === "in_progress" && <Badge variant="accent" dot>进行中</Badge>}
                    {p.status === "completed" && <Badge variant="success" dot>已完成</Badge>}
                    {p.status === "pending_review" && <Badge variant="warning" dot>待审核</Badge>}
                    {p.status === "archived" && <Badge variant="outline" dot>已归档</Badge>}
                  </td>
                  <td className={`${styles.tableCell} ${styles.tableCellRight}`}>
                    <div className={styles.rowActions}>
                      {/* v0.10.11 · 「复制项目配置」入口 — 跳 Wizard 复制流, 用源项目配置预填. */}
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={(e) => {
                          e.stopPropagation();
                          navigate(`/dashboard?new=1&from=${p.id}`);
                        }}
                        title="复制项目配置（不复制数据集 / 任务 / 成员）"
                      >
                        <Icon name="copy" size={13} />复制
                      </Button>
                      <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); navigate(`/projects/${p.id}/settings`); }}>
                        <Icon name="settings" size={13} />设置
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        </Card>
      </div>
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
    <div className={styles.statusBar}>
      <div className={styles.statusBarHeader}>
        <span className={styles.statusLabel}>{label}</span>
        <span className={`mono ${styles.statusCount}`}>{count} ({pct}%)</span>
      </div>
      <ProgressBar value={pct} color={color} />
    </div>
  );
}

function RegistrationSourceCard({ series }: { series: RegistrationDayPoint[] }) {
  const totalInvite = series.reduce((s, d) => s + d.invite_count, 0);
  const totalOpen = series.reduce((s, d) => s + d.open_count, 0);
  const total = totalInvite + totalOpen;
  const peak = Math.max(1, ...series.map((d) => d.invite_count + d.open_count));

  return (
    <div className={styles.cardTop}>
      <Card>
        <div className={styles.cardHeaderSplit}>
          <h3 className={styles.cardTitle}>30 天注册来源</h3>
          <div className={styles.registrationMeta}>
            共 {total} 人 · 邀请 {totalInvite} · 开放 {totalOpen}
          </div>
        </div>
        <div className={styles.cardBody}>
          {total === 0 ? (
            <div className={styles.registrationEmpty}>
              过去 30 天暂无注册记录
            </div>
          ) : (
            <div>
              <div className={styles.registrationChart}>
                {series.map((d) => (
                  <RegistrationSourceBar key={d.date} point={d} peak={peak} />
                ))}
              </div>
              <div className={styles.registrationAxis}>
                <span>{series[0]?.date}</span>
                <span>{series[series.length - 1]?.date}</span>
              </div>
              <div className={styles.registrationLegend}>
                <span className={styles.legendItem}>
                  <span className={styles.inviteSwatch} />
                  邀请注册
                </span>
                <span className={styles.legendItem}>
                  <span className={styles.openSwatch} />
                  开放注册
                </span>
              </div>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}

function RegistrationSourceBar({ point, peak }: { point: RegistrationDayPoint; peak: number }) {
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = barRef.current;
    if (!node) return;

    node.style.setProperty("--registration-open-height", `${(point.open_count / peak) * 80}px`);
    node.style.setProperty("--registration-invite-height", `${(point.invite_count / peak) * 80}px`);
    node.style.setProperty("--registration-open-min-height", point.open_count ? "2px" : "0");
    node.style.setProperty("--registration-invite-min-height", point.invite_count ? "2px" : "0");
  }, [peak, point.invite_count, point.open_count]);

  return (
    <div
      ref={barRef}
      className={styles.registrationBar}
      title={`${point.date}\n邀请 ${point.invite_count} · 开放 ${point.open_count}`}
    >
      <div className={styles.openSegment} />
      <div className={`${styles.inviteSegment} ${point.open_count ? styles.stackedInviteSegment : ""}`} />
    </div>
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
      <div className={styles.mlCardHeader}>
        <div className={styles.mlTitleGroup}>
          <h3 className={styles.cardTitle}>ML 后端 · 预测成本</h3>
          <Badge variant={backendsConnected > 0 ? "success" : "outline"}>
            {backendsConnected} / {backendsTotal} 在线
          </Badge>
        </div>
        <div className={styles.mlActions}>
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
        <div className={styles.mlEmpty}>
          <Icon name="bot" size={28} className={styles.emptyIcon} />
          <div>暂无已注册的 ML 后端</div>
          <div className={styles.emptyHint}>在项目设置中添加模型服务</div>
        </div>
      ) : (
        <div className={styles.mlStatsGrid}>
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
