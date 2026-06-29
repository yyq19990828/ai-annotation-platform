import { useState, type CSSProperties } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { Icon } from "@/components/ui/Icon";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Avatar } from "@/components/ui/Avatar";
import { StatCard } from "@/components/ui/StatCard";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { useElementStyle } from "@/components/ui/useElementStyle";
import { useToastStore } from "@/components/ui/Toast";
import { useAdminStats, usePredictionCostStats } from "@/hooks/useDashboard";
import { useProjects } from "@/hooks/useProjects";
import { useAuditLogs } from "@/hooks/useAudit";
import { ROLE_LABELS } from "@/constants/roles";
import { CreateProjectWizard } from "@/components/projects/CreateProjectWizard";
import { ImportDatasetWizard } from "@/components/datasets/ImportDatasetWizard";
import { auditActionLabel } from "@/utils/auditLabels";
import { projectDisplayType } from "@/utils/projectDisplay";
import { buildWorkbenchUrl, currentWorkbenchReturnTo } from "@/utils/workbenchNavigation";
import type { ProjectResponse } from "@/api/projects";
import type { UserRole } from "@/types";
import type { RegistrationDayPoint } from "@/api/dashboard";

const WORKBENCH_PROJECT_TYPES = new Set(["image-det", "video-track", "lidar"]);

const CARD_HEADER_CLASS = "border-b border-border px-4 py-3.5";
const CARD_HEADER_SPLIT_CLASS = `${CARD_HEADER_CLASS} flex items-center justify-between`;
const CARD_TITLE_CLASS = "text-sm font-semibold";
const CARD_BODY_CLASS = "p-4";
const ENTRY_LINK_CLASS = "inline-flex items-center text-xs text-brand";
const TABLE_HEAD_CELL_CLASS =
  "border-b border-border bg-muted px-3 py-2.5 text-left text-xs font-medium whitespace-nowrap text-muted-foreground";
const TABLE_CELL_CLASS = "border-b border-border px-3 py-3 align-middle";

export function AdminDashboard() {
  const { data: stats, isLoading } = useAdminStats();
  const { data: projects = [], isLoading: projectsLoading } = useProjects();
  const { data: audit } = useAuditLogs({ page: 1, page_size: 8, business_only: true });
  const navigate = useNavigate();
  const location = useLocation();
  const pushToast = useToastStore((s) => s.push);
  const [searchParams, setSearchParams] = useSearchParams();
  const wizardOpen = searchParams.get("new") === "1";
  // v0.10.11 · 从 ProjectGrid "复制项目" 跳来时携带 ?from=<id>; Wizard 据此预填.
  const wizardSourceProjectId = searchParams.get("from") || undefined;
  const [importOpen, setImportOpen] = useState(false);

  const recentActivity = audit?.items ?? [];

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

  // B-46 · 项目行「打开」入口 — 与其它 dashboard 一致: 工作台型项目进工作台, 其余 toast 提示.
  const onOpenProject = (p: ProjectResponse) => {
    if (WORKBENCH_PROJECT_TYPES.has(p.type_key)) {
      navigate(buildWorkbenchUrl(p.id, { returnTo: currentWorkbenchReturnTo(location) }));
    } else {
      pushToast({ msg: `项目 "${p.name}" 已打开`, sub: `${projectDisplayType(p)} 的标注界面尚未实现` });
    }
  };

  if (isLoading || !stats) {
    return (
      <div className="px-7 py-15 text-center text-muted-foreground">
        加载中...
      </div>
    );
  }

  const projectsTotal = stats.total_projects || 1;

  return (
    <div className="mx-auto max-w-[1480px] px-7 pb-10 pt-5 text-foreground max-[900px]:p-4">
      <div className="mb-5 flex items-end justify-between gap-6 max-[900px]:flex-col max-[900px]:items-start">
        <div>
          <h1 className="mb-1 text-xl font-semibold">Overview</h1>
          <p className="text-sm text-muted-foreground">全局平台运行状态与资源分布</p>
        </div>
        <div className="flex gap-2 max-[900px]:flex-wrap">
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

      <div className="mb-3 grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-3">
        <StatCard icon="users" label="用户总数" value={stats.total_users} hint={`${stats.active_users} 在线`} />
        <StatCard icon="layers" label="项目总数" value={stats.total_projects} hint={`${stats.projects_in_progress} 进行中`} />
        <StatCard icon="target" label="任务总量" value={stats.total_tasks.toLocaleString()} />
        <StatCard icon="check" label="标注总量" value={stats.total_annotations.toLocaleString()} />
      </div>

      {/* v0.8.4 · 成员绩效入口 */}
      <div className="mb-5 cursor-pointer">
        <Card onClick={() => navigate("/admin/people")}>
          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <div className="flex items-center gap-2.5">
              <Icon name="users" size={16} />
              <div>
                <div className="text-sm font-semibold">成员绩效</div>
                <div className="text-xs text-muted-foreground">
                  全员效率卡片网格 + 抽屉下钻
                </div>
              </div>
            </div>
            <span className={ENTRY_LINK_CLASS}>
              打开 <Icon name="chevRight" size={11} />
            </span>
          </div>
        </Card>
      </div>

      <div className="mb-4 grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-3">
        <Card>
          <div className={CARD_HEADER_CLASS}>
            <h3 className={CARD_TITLE_CLASS}>项目状态分布</h3>
          </div>
          <div className={CARD_BODY_CLASS}>
            <StatusBar label="进行中" count={stats.projects_in_progress} total={projectsTotal} color="var(--sc-brand)" />
            <StatusBar label="已完成" count={stats.projects_completed} total={projectsTotal} color="var(--sc-positive)" />
            <StatusBar label="待审核" count={stats.projects_pending_review} total={projectsTotal} color="var(--sc-caution)" />
            <StatusBar label="已归档" count={stats.projects_archived} total={projectsTotal} color="var(--sc-muted-foreground)" />
          </div>
        </Card>

        <Card>
          <div className={CARD_HEADER_CLASS}>
            <h3 className={CARD_TITLE_CLASS}>用户角色分布</h3>
          </div>
          <div className={CARD_BODY_CLASS}>
            {Object.entries(stats.role_distribution).map(([role, count]) => (
              <div key={role} className="flex items-center justify-between py-1.5">
                <div className="flex items-center gap-2">
                  <Badge variant="outline">{ROLE_LABELS[role as UserRole] ?? role}</Badge>
                </div>
                <span className="mono text-sm font-medium">{count}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* v0.9.5 · AI 预标注队列卡片（仅在有 pre_annotated 批次时显示） */}
      {(stats.pre_annotated_batches ?? 0) > 0 && (
        <div className="mb-3 cursor-pointer [&>*]:border [&>*]:border-border [&>*]:bg-status-info-soft">
          <Card onClick={() => navigate("/ai-pre")}>
            <div className="flex items-center justify-between p-4">
              <div className="flex items-center gap-3">
                <Icon name="wandSparkles" size={18} className="text-status-info" />
                <div>
                  <div className="text-sm font-semibold">
                    AI 预标注队列 · {stats.pre_annotated_batches} 批待接管
                  </div>
                  <div className="text-xs text-muted-foreground">
                    文本批量预标已跑完，等待人工分派接管
                  </div>
                </div>
              </div>
              <span className="inline-flex items-center text-xs text-status-info">
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
      <div className="mt-3 cursor-pointer">
        <Card onClick={() => navigate("/ai-pre/jobs?status=failed")}>
          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <div className="flex items-center gap-2.5">
              <Icon name="warning" size={16} className="text-status-caution" />
              <div>
                <div className="text-sm font-semibold">失败预测管理</div>
                <div className="text-xs text-muted-foreground">
                  查看 ML Backend 调用失败的预测，并按需重试 (单条最多 3 次)
                </div>
              </div>
            </div>
            <span className={ENTRY_LINK_CLASS}>
              打开 <Icon name="chevRight" size={11} />
            </span>
          </div>
        </Card>
      </div>


      <div className="mt-4">
        <Card>
        <div className={CARD_HEADER_SPLIT_CLASS}>
          <h3 className={CARD_TITLE_CLASS}>近期审计活动</h3>
          <Button size="sm" variant="ghost" onClick={() => navigate("/audit")}>
            查看全部<Icon name="chevRight" size={11} />
          </Button>
        </div>
        {recentActivity.length === 0 ? (
          <div className="flex flex-col items-center px-4 py-6 text-center text-sm text-muted-foreground">
            <Icon name="activity" size={26} className="mb-2 opacity-25" />
            <div>暂无业务事件</div>
          </div>
        ) : (
          <ul className="m-0 list-none p-0">
            {recentActivity.map((it) => (
              <li
                key={it.id}
                className="flex items-center gap-2.5 border-b border-border px-4 py-2.5 text-sm"
              >
                <Avatar initial={(it.actor_email ?? "?").slice(0, 1).toUpperCase()} size="sm" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="font-medium">{it.actor_email ?? "匿名"}</span>
                    <span className="[&>*]:text-2xs">
                      <Badge variant="accent">{auditActionLabel(it.action)}</Badge>
                    </span>
                    {it.target_type && (
                      <span className="text-xs text-muted-foreground">
                        {it.target_type}
                        {it.target_id && (
                          <span className="mono ml-1">
                            {it.target_id.length > 24 ? it.target_id.slice(0, 8) + "…" : it.target_id}
                          </span>
                        )}
                      </span>
                    )}
                  </div>
                </div>
                <span className="whitespace-nowrap text-xs text-muted-foreground">
                  {relativeTime(it.created_at)}
                </span>
              </li>
            ))}
          </ul>
        )}
        </Card>
      </div>

      <div className="mt-4">
        <Card>
        <div className={CARD_HEADER_SPLIT_CLASS}>
          <h3 className={CARD_TITLE_CLASS}>全平台项目</h3>
          <span className="text-xs text-muted-foreground">共 {projects.length} 个</span>
        </div>
        {projectsLoading && (
          <div className="p-8 text-center text-sm text-muted-foreground">加载中...</div>
        )}
        {!projectsLoading && projects.length === 0 && (
          <div className="p-8 text-center text-sm text-muted-foreground">
            暂无项目，点击右上角「新建项目」开始
          </div>
        )}
        {!projectsLoading && projects.length > 0 && (
          <div className="w-full overflow-x-auto [overscroll-behavior-x:contain]">
            <table className="w-full min-w-[760px] border-separate border-spacing-0 text-sm">
              <thead>
                <tr>
                  {["项目", "负责人", "成员", "状态", ""].map((h, i) => (
                    <th
                      key={i}
                      className={[
                        TABLE_HEAD_CELL_CLASS,
                        i === 0 ? "pl-4" : "",
                        i === 4 ? "pr-4" : "",
                      ].filter(Boolean).join(" ")}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {projects.map((p) => (
                  <tr key={p.id} className="cursor-pointer" onClick={() => navigate(`/projects/${p.id}/settings`)}>
                    <td className={`${TABLE_CELL_CLASS} py-2.5 pl-4`}>
                      <div className="max-w-[240px] overflow-hidden text-ellipsis whitespace-nowrap text-sm font-medium">{p.name}</div>
                      <div className="max-w-[240px] overflow-hidden text-ellipsis whitespace-nowrap text-xs text-muted-foreground">
                        <span className="mono">{p.display_id}</span> · {projectDisplayType(p)}
                      </div>
                    </td>
                    <td className={TABLE_CELL_CLASS}>
                      <div className="flex min-w-0 items-center gap-2">
                        <Avatar initial={p.owner_name?.slice(0, 1) ?? "?"} size="sm" />
                        <span className="max-w-[160px] overflow-hidden text-ellipsis whitespace-nowrap text-sm">{p.owner_name ?? "—"}</span>
                      </div>
                    </td>
                    <td className={`${TABLE_CELL_CLASS} text-muted-foreground`}>
                      {p.member_count}
                    </td>
                    <td className={TABLE_CELL_CLASS}>
                      {p.status === "in_progress" && <Badge variant="accent" dot>进行中</Badge>}
                      {p.status === "completed" && <Badge variant="success" dot>已完成</Badge>}
                      {p.status === "pending_review" && <Badge variant="warning" dot>待审核</Badge>}
                      {p.status === "archived" && <Badge variant="outline" dot>已归档</Badge>}
                    </td>
                    <td className={`${TABLE_CELL_CLASS} py-2.5 pr-4 text-right whitespace-nowrap`}>
                      <div className="inline-flex items-center gap-1 whitespace-nowrap">
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
                        {/* B-46 · 「打开」入口 — 进工作台标注界面（样式与项目总览统一） */}
                        <Button size="sm" onClick={(e) => { e.stopPropagation(); onOpenProject(p); }}>
                          打开 <Icon name="chevRight" size={11} />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
    <div className="mb-3">
      <div className="mb-1 flex justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="mono font-medium">{count} ({pct}%)</span>
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
    <div className="mt-4">
      <Card>
        <div className={CARD_HEADER_SPLIT_CLASS}>
          <h3 className={CARD_TITLE_CLASS}>30 天注册来源</h3>
          <div className="text-xs text-muted-foreground">
            共 {total} 人 · 邀请 {totalInvite} · 开放 {totalOpen}
          </div>
        </div>
        <div className={CARD_BODY_CLASS}>
          {total === 0 ? (
            <div className="py-5 text-center text-sm text-muted-foreground">
              过去 30 天暂无注册记录
            </div>
          ) : (
            <div>
              <div className="mb-2 flex h-20 items-end gap-1">
                {series.map((d) => (
                  <RegistrationSourceBar key={d.date} point={d} peak={peak} />
                ))}
              </div>
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>{series[0]?.date}</span>
                <span>{series[series.length - 1]?.date}</span>
              </div>
              <div className="mt-2.5 flex gap-4 text-xs">
                <span className="inline-flex items-center gap-1.5">
                  <span className="size-2.5 rounded-sm bg-brand" />
                  邀请注册
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="size-2.5 rounded-sm bg-emerald-500" />
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
  const barRef = useElementStyle<HTMLDivElement>({
    "--registration-open-height": `${(point.open_count / peak) * 80}px`,
    "--registration-invite-height": `${(point.invite_count / peak) * 80}px`,
    "--registration-open-min-height": point.open_count ? "2px" : "0",
    "--registration-invite-min-height": point.invite_count ? "2px" : "0",
  } as CSSProperties);

  return (
    <div
      ref={barRef}
      className="flex flex-1 flex-col justify-end gap-px"
      title={`${point.date}\n邀请 ${point.invite_count} · 开放 ${point.open_count}`}
    >
      <div className="h-[var(--registration-open-height)] min-h-[var(--registration-open-min-height)] rounded-t-sm bg-emerald-500" />
      <div
        className={`h-[var(--registration-invite-height)] min-h-[var(--registration-invite-min-height)] bg-brand ${point.open_count ? "rounded-none" : "rounded-t-sm"}`}
      />
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
      <div className={`${CARD_HEADER_CLASS} flex flex-wrap items-center justify-between gap-3`}>
        <div className="flex items-center gap-2.5">
          <h3 className={CARD_TITLE_CLASS}>ML 后端 · 预测成本</h3>
          <Badge variant={backendsConnected > 0 ? "success" : "outline"}>
            {backendsConnected} / {backendsTotal} 在线
          </Badge>
        </div>
        <div className="flex items-center gap-1">
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
        <div className="px-4 py-6 text-center text-sm text-muted-foreground">
          <Icon name="bot" size={28} className="mb-2 opacity-25" />
          <div>暂无已注册的 ML 后端</div>
          <div className="mt-1 text-xs">在项目设置中添加模型服务</div>
        </div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-3 p-4">
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
