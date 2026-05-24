import { useMemo, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { Icon, type IconName } from "@/components/ui/Icon";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { Avatar } from "@/components/ui/Avatar";
import { StatCard } from "@/components/ui/StatCard";
import { SearchInput } from "@/components/ui/SearchInput";
import { TabRow } from "@/components/ui/TabRow";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { useToastStore } from "@/components/ui/Toast";
import { Can } from "@/components/guards/Can";
import { useProjects, useProjectStats } from "@/hooks/useProjects";
import { type ProjectResponse } from "@/api/projects";
import { ExportSection } from "./ExportSection";
import { CreateProjectWizard } from "@/components/projects/CreateProjectWizard";
import { ImportDatasetWizard } from "@/components/datasets/ImportDatasetWizard";
import { useAuthStore } from "@/stores/authStore";
import { useAuditLogs } from "@/hooks/useAudit";
import { auditActionLabel } from "@/utils/auditLabels";
import { FilterDrawer, EMPTY_FILTERS, type DashboardFilters } from "./FilterDrawer";
import { ProjectGrid } from "./ProjectGrid";
import { ProjectActionsMenu } from "./ProjectActionsMenu";
import { buildWorkbenchUrl, currentWorkbenchReturnTo } from "@/utils/workbenchNavigation";

import styles from "./DashboardPage.module.css";

// v0.10.28 · 列表图标改读媒体维度 data_type (image / video / lidar).
const DATA_TYPE_ICONS: Record<string, IconName> = {
  image: "image",
  video: "video",
  lidar: "cube",
};
const WORKBENCH_PROJECT_TYPES = new Set(["image-det", "video-track"]);

function ProjectRow({
  p,
  onOpen,
  canManage,
  onSettings,
}: {
  p: ProjectResponse;
  onOpen: (p: ProjectResponse) => void;
  canManage: boolean;
  onSettings: (p: ProjectResponse, section?: string) => void;
}) {
  const total = p.total_tasks || 1;
  const pct = Math.round((p.completed_tasks / total) * 100);
  // v0.7.0：aiPct = AI 派生标注覆盖的任务数 / 总任务数（替换 v0.6.x 的启发式 pct * 0.6）
  const aiPct = p.ai_enabled
    ? Math.round(((p.ai_completed_tasks ?? 0) / total) * 100)
    : 0;
  // v0.6.7：「已动工」副条 = (in_progress + review + completed) / total，让 0 完成但有进度的项目可见
  const startedPct = Math.round(
    ((p.in_progress_tasks ?? 0) + p.review_tasks + p.completed_tasks) / total * 100,
  );
  const due = p.due_date ?? "—";
  const updated = p.updated_at ? new Date(p.updated_at).toLocaleDateString("zh-CN") : "—";
  const ownerInitial = p.owner_name?.slice(0, 1) ?? "?";

  return (
    <tr className={styles.projectRow} onClick={() => onOpen(p)}>
      <td className={styles.projectCellPrimary}>
        <div className={styles.projectIdentity}>
          <div className={styles.projectTypeIcon}>
            <Icon name={DATA_TYPE_ICONS[p.data_type ?? "image"] || "image"} size={14} />
          </div>
          <div className={styles.projectText}>
            <div className={styles.projectName}>{p.name}</div>
            <div className={styles.projectMeta}>
              <span className={`mono ${styles.projectId}`}>{p.display_id}</span>
              <span className={styles.metaDot}>·</span>
              <span className={styles.projectType}>{p.type_label}</span>
            </div>
          </div>
        </div>
      </td>
      <td className={styles.projectCell}>
        <div className={styles.ownerCell}>
          <Avatar initial={ownerInitial} size="sm" />
          <div>
            <div className={styles.ownerName}>{p.owner_name ?? "—"}</div>
            <div className={styles.ownerSubtext}>
              {(p.member_count ?? 0) > 0 ? `${p.member_count} 名成员` : "暂无成员"}
            </div>
          </div>
        </div>
      </td>
      <td className={styles.progressCell}>
        <ProgressBar value={pct} aiValue={aiPct} inProgressValue={startedPct} />
        <div className={styles.progressMeta}>
          <span className="mono">
            {p.completed_tasks.toLocaleString()} / {p.total_tasks.toLocaleString()}
            {(p.in_progress_tasks ?? 0) + p.review_tasks > 0 && (
              <span className={styles.progressDetail}>
                {" · "}
                {(p.in_progress_tasks ?? 0) > 0 && <>{p.in_progress_tasks} 进行中</>}
                {(p.in_progress_tasks ?? 0) > 0 && p.review_tasks > 0 && " · "}
                {p.review_tasks > 0 && <>{p.review_tasks} 待审</>}
              </span>
            )}
          </span>
          <span className={styles.progressPct}>{pct}%</span>
        </div>
        {canManage && (
          <>
            {(p.batch_summary?.total ?? 0) > 0 && (
              <div className={styles.batchSummary}>
                {p.batch_summary?.total} 个批次
                {(p.batch_summary?.assigned ?? 0) > 0 && (
                  <> · {p.batch_summary?.assigned} 已分派</>
                )}
                {(p.batch_summary?.in_review ?? 0) > 0 && (
                  <> · <span className={styles.batchReviewing}>{p.batch_summary?.in_review} 审核中</span></>
                )}
              </div>
            )}
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onSettings(p, "batches"); }}
              className={styles.batchLink}
              title="跳转到项目设置 → 批次管理"
            >
              <Icon name="layers" size={10} /> 查看批次分派
            </button>
          </>
        )}
      </td>
      <td className={styles.projectCell}>
        {p.ai_enabled ? (
          <Badge variant="ai"><Icon name="sparkles" size={10} />{p.ai_model ?? "未接入模型"}</Badge>
        ) : (
          <span className={styles.mutedSmall}>未启用</span>
        )}
      </td>
      <td className={styles.projectCell}>
        {p.status === "in_progress" && <Badge variant="accent" dot>进行中</Badge>}
        {p.status === "completed" && <Badge variant="success" dot>已完成</Badge>}
        {p.status === "pending_review" && <Badge variant="warning" dot>待审核</Badge>}
      </td>
      <td className={styles.projectCell}>
        <div className={styles.dueDate}>{due}</div>
        <div className={styles.updatedAt}>更新 {updated}</div>
      </td>
      <td className={styles.projectCellActions}>
        <div className={styles.rowActions}>
          <ExportSection projectId={p.id} projectTypeKey={p.type_key} />
          <ProjectActionsMenu
            project={p}
            canManage={canManage}
            onSettings={onSettings}
          />
          <Button size="sm">打开 <Icon name="chevRight" size={11} /></Button>
        </div>
      </td>
    </tr>
  );
}

const FILTERS = ["全部", "进行中", "待审核", "已完成"] as const;
const FILTER_STATUS_MAP: Record<string, string | undefined> = {
  "全部": undefined,
  "进行中": "in_progress",
  "待审核": "pending_review",
  "已完成": "completed",
};

export function DashboardPage() {
  const [filter, setFilter] = useState<string>("全部");
  const [query, setQuery] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);
  // v0.7.2 · 高级筛选状态（不写 URL，避免 search 参数过长；TabRow 状态切换仍同步到此处）
  const [advanced, setAdvanced] = useState<DashboardFilters>(EMPTY_FILTERS);
  const pushToast = useToastStore((s) => s.push);
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const wizardOpen = searchParams.get("new") === "1";
  // v0.10.11 · 从 ProjectGrid "复制项目" 跳来时携带 ?from=<id>; Wizard 据此预填.
  const wizardSourceProjectId = searchParams.get("from") || undefined;
  // B-35 · 内部 list/grid 切换使用独立的 layout 参数，避免与外层 DashboardRouter 的 view=projects 冲突
  // （否则超管点击网格切换会把 view=projects 覆盖成 view=grid，被路由回平台概览）。
  const viewMode: "list" | "grid" = searchParams.get("layout") === "grid" ? "grid" : "list";
  const setViewMode = (mode: "list" | "grid") => {
    const next = new URLSearchParams(searchParams);
    if (mode === "grid") next.set("layout", "grid");
    else next.delete("layout");
    setSearchParams(next, { replace: true });
  };
  const [importOpen, setImportOpen] = useState(false);
  const currentUser = useAuthStore((s) => s.user);

  const canManageProject = (p: ProjectResponse): boolean => {
    if (!currentUser) return false;
    if (currentUser.role === "super_admin") return true;
    return p.owner_id === currentUser.id;
  };

  const onSettings = (p: ProjectResponse, section?: string) =>
    navigate(`/projects/${p.id}/settings${section ? `?section=${section}` : ""}`);

  const onOpenProject = (p: ProjectResponse) => {
    if (WORKBENCH_PROJECT_TYPES.has(p.type_key)) {
      navigate(buildWorkbenchUrl(p.id, { returnTo: currentWorkbenchReturnTo(location) }));
    } else {
      pushToast({ msg: `项目 "${p.name}" 已打开`, sub: `类型 ${p.type_label} 的标注界面尚未实现` });
    }
  };

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

  // 合并 TabRow 状态（filter）+ FilterDrawer 状态（advanced）；TabRow 优先（advanced.status 仅在 drawer 内调整时取代 TabRow）
  const effectiveStatus = advanced.status ?? FILTER_STATUS_MAP[filter];
  const { data: projects = [], isLoading } = useProjects({
    status: effectiveStatus,
    search: query || undefined,
    data_type: advanced.data_type.length > 0 ? advanced.data_type : undefined,
    member_id: advanced.member_id,
    created_from: advanced.created_from,
    created_to: advanced.created_to,
  });

  const advancedActiveCount = useMemo(() => {
    let n = 0;
    if (advanced.data_type.length) n += 1;
    if (advanced.member_id) n += 1;
    if (advanced.created_from || advanced.created_to) n += 1;
    if (advanced.status && advanced.status !== FILTER_STATUS_MAP[filter]) n += 1;
    return n;
  }, [advanced, filter]);

  const { data: stats } = useProjectStats();
  const { data: audit } = useAuditLogs({ page: 1, page_size: 8 });
  const recentActivity = (audit?.items ?? []).filter((it) => !it.action.startsWith("http.")).slice(0, 8);

  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>项目总览</h1>
          <p className={styles.pageSubtitle}>管理你的标注项目,跟踪进度与 AI 辅助效率</p>
        </div>
        <div className={styles.headerActions}>
          <Can permission="dataset.create">
            <Button onClick={() => setImportOpen(true)}>
              <Icon name="upload" size={13} />导入数据集
            </Button>
            <ImportDatasetWizard
              open={importOpen}
              onClose={() => setImportOpen(false)}
              onUploaded={() => navigate("/datasets")}
            />
          </Can>
          <Can permission="project.create">
            <Button variant="primary" onClick={openWizard}>
              <Icon name="plus" size={13} />新建项目
            </Button>
            <CreateProjectWizard open={wizardOpen} onClose={closeWizard} sourceProjectId={wizardSourceProjectId} />
          </Can>
        </div>
      </div>

      <div className={styles.statsGrid}>
        <StatCard icon="layers" label="数据总量" value={(stats?.total_data ?? 0).toLocaleString()} trend={12} sparkValues={[42, 50, 48, 56, 60, 65, 78, 82, 89, 95, 102, 108]} sparkColor="var(--color-accent)" hint="近 12 周" />
        <StatCard icon="check" label="已完成标注" value={(stats?.completed ?? 0).toLocaleString()} trend={8} sparkValues={[20, 28, 24, 36, 42, 48, 56, 62, 68, 74, 80, 86]} sparkColor="var(--color-success)" hint="近 12 周" />
        <StatCard icon="sparkles" label="AI 接管率" value={`${stats?.ai_rate ?? 0}%`} trend={5} sparkValues={[42, 48, 50, 52, 55, 56, 58, 59, 60, 61, 62, 62]} sparkColor="var(--color-ai)" hint="自动通过" />
        <StatCard icon="flag" label="待审核" value={(stats?.pending_review ?? 0).toLocaleString()} trend={-14} sparkValues={[820, 760, 920, 880, 760, 700, 680, 620, 580, 540, 480, 412]} sparkColor="var(--color-warning)" hint="近 12 周" />
      </div>

      <Card>
        <div className={styles.cardHeader}>
          <div className={styles.cardTitleRow}>
            <h3 className={styles.cardTitle}>我的项目</h3>
            <TabRow tabs={[...FILTERS]} active={filter} onChange={setFilter} />
          </div>
          <div className={styles.cardActions}>
            <SearchInput placeholder="搜索项目..." value={query} onChange={setQuery} width={220} />
            <Button onClick={() => setFilterOpen(true)}>
              <Icon name="filter" size={13} />筛选
              {advancedActiveCount > 0 && (
                <span className={styles.filterCount}>{advancedActiveCount}</span>
              )}
            </Button>
            <Button
              onClick={() => setViewMode(viewMode === "grid" ? "list" : "grid")}
              title={viewMode === "grid" ? "切换到列表视图" : "切换到网格视图"}
              className={viewMode === "grid" ? styles.viewToggleActive : undefined}
            >
              <Icon name={viewMode === "grid" ? "list" : "grid"} size={13} />
            </Button>
          </div>
        </div>
        {viewMode === "grid" ? (
          isLoading ? (
            <div className={styles.emptyState}>
              加载中...
            </div>
          ) : (
            <ProjectGrid
              projects={projects}
              onOpen={onOpenProject}
              canManage={canManageProject}
              onSettings={onSettings}
            />
          )
        ) : (
        <div className={styles.projectTableScroller}>
          <table className={styles.projectTable}>
            <thead>
              <tr>
                {["项目", "负责人", "进度", "AI 模型", "状态", "截止 / 更新", ""].map((h, i) => (
                  <th key={i}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr>
                  <td colSpan={7} className={styles.tableEmptyCell}>
                    加载中...
                  </td>
                </tr>
              )}
              {!isLoading && projects.map((p) => (
                <ProjectRow
                  key={p.id}
                  p={p}
                  onOpen={onOpenProject}
                  canManage={canManageProject(p)}
                  onSettings={onSettings}
                />
              ))}
              {!isLoading && projects.length === 0 && (
                <tr>
                  <td colSpan={7} className={styles.tableEmptyCell}>
                    没有匹配的项目
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        )}
      </Card>

      <FilterDrawer
        open={filterOpen}
        onClose={() => setFilterOpen(false)}
        initial={advanced}
        onApply={setAdvanced}
      />

      <div className={styles.bottomGrid}>
        <Card>
          <div className={styles.cardHeader}>
            <h3 className={styles.cardTitle}>AI 预标注队列</h3>
          </div>
          <div className={styles.aiQueueEmpty}>
            <Icon name="sparkles" size={28} className={styles.emptyIcon} />
            <div>暂无运行中的预标注任务</div>
            <div className={styles.emptyHint}>在标注工作台中点击"AI 一键预标"启动</div>
          </div>
        </Card>

        <Card>
          <div className={styles.cardHeader}>
            <h3 className={styles.cardTitle}>近期活动</h3>
          </div>
          {recentActivity.length === 0 ? (
            <div className={styles.activityEmpty}>
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
                    <div className={styles.activityMeta}>
                      <span className={styles.activityActor}>{it.actor_email ?? "匿名"}</span>
                      <Badge variant="accent">{auditActionLabel(it.action)}</Badge>
                      {it.target_type && (
                        <span className={styles.activityTarget}>
                          {it.target_type}
                          {it.target_id && (
                            <span className={`mono ${styles.activityTargetId}`}>
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
