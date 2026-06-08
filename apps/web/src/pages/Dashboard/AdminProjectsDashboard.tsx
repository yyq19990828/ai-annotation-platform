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
import { useProjects, useProjectStats } from "@/hooks/useProjects";
import type { ProjectResponse } from "@/api/projects";
import { CreateProjectWizard } from "@/components/projects/CreateProjectWizard";
import { ImportDatasetWizard } from "@/components/datasets/ImportDatasetWizard";
import { ExportSection } from "./ExportSection";
import { ProjectActionsMenu } from "./ProjectActionsMenu";
import { ProjectGrid } from "./ProjectGrid";
import { FilterDrawer, EMPTY_FILTERS, type DashboardFilters } from "./FilterDrawer";
import { buildWorkbenchUrl, currentWorkbenchReturnTo } from "@/utils/workbenchNavigation";
import { projectDisplayType } from "@/utils/projectDisplay";
import { statSeriesHint, statSparkValues, statTrendFromSeries } from "@/utils/projectStatsSeries";
import styles from "./DashboardPage.module.css";

const DATA_TYPE_ICONS: Record<string, IconName> = {
  image: "image",
  video: "video",
  lidar: "cube",
};

const FILTERS = ["全部", "进行中", "待审核", "已完成"] as const;
const FILTER_STATUS_MAP: Record<string, string | undefined> = {
  "全部": undefined,
  "进行中": "in_progress",
  "待审核": "pending_review",
  "已完成": "completed",
};
const WORKBENCH_PROJECT_TYPES = new Set(["image-det", "video-track", "lidar"]);

function AdminProjectRow({
  p,
  onOpen,
  onSettings,
}: {
  p: ProjectResponse;
  onOpen: (p: ProjectResponse) => void;
  onSettings: (p: ProjectResponse, section?: string) => void;
}) {
  const total = p.total_tasks || 1;
  const pct = Math.round((p.completed_tasks / total) * 100);
  const aiPct = p.ai_enabled
    ? Math.round(((p.ai_completed_tasks ?? 0) / total) * 100)
    : 0;
  const startedPct = Math.round(
    ((p.in_progress_tasks ?? 0) + p.review_tasks + p.completed_tasks) / total * 100,
  );
  const due = p.due_date ?? "—";
  const updated = p.updated_at ? new Date(p.updated_at).toLocaleDateString("zh-CN") : "—";
  const ownerInitial = p.owner_name?.slice(0, 1) ?? "?";

  return (
    <tr className={styles.projectRow}>
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
              <span className={styles.projectType}>{projectDisplayType(p)}</span>
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
      </td>
      <td className={styles.projectCell}>
        {p.ai_enabled ? (
          <Badge variant="ai">
            <Icon name="sparkles" size={10} />
            {p.ml_backend_id ? "已接入模型" : "未接入模型"}
          </Badge>
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
      <td className={styles.projectCellActions} onClick={(e) => e.stopPropagation()}>
        <div className={styles.rowActions}>
          <ExportSection projectId={p.id} projectTypeKey={p.type_key} />
          <ProjectActionsMenu project={p} canManage onSettings={onSettings} />
          <Button size="sm" onClick={() => onOpen(p)}>
            打开 <Icon name="chevRight" size={11} />
          </Button>
        </div>
      </td>
    </tr>
  );
}

export function AdminProjectsDashboard() {
  const [filter, setFilter] = useState<string>("全部");
  const [query, setQuery] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);
  const [advanced, setAdvanced] = useState<DashboardFilters>(EMPTY_FILTERS);
  const [importOpen, setImportOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const pushToast = useToastStore((s) => s.push);
  const [searchParams, setSearchParams] = useSearchParams();
  const wizardOpen = searchParams.get("new") === "1";
  const wizardSourceProjectId = searchParams.get("from") || undefined;
  const viewMode: "list" | "grid" = searchParams.get("layout") === "grid" ? "grid" : "list";

  const setViewMode = (mode: "list" | "grid") => {
    const next = new URLSearchParams(searchParams);
    if (mode === "grid") next.set("layout", "grid");
    else next.delete("layout");
    setSearchParams(next, { replace: true });
  };

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

  const onSettings = (p: ProjectResponse, section?: string) =>
    navigate(`/projects/${p.id}/settings${section ? `?section=${section}` : ""}`);

  const onOpenProject = (p: ProjectResponse) => {
    if (WORKBENCH_PROJECT_TYPES.has(p.type_key)) {
      navigate(buildWorkbenchUrl(p.id, { returnTo: currentWorkbenchReturnTo(location) }));
    } else {
      pushToast({ msg: `项目 "${p.name}" 已打开`, sub: `${projectDisplayType(p)} 的标注界面尚未实现` });
    }
  };

  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>项目管理</h1>
          <p className={styles.pageSubtitle}>管理平台全部项目、负责人、批次分派与导出入口</p>
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
        <StatCard
          icon="layers"
          label="任务总量"
          value={(stats?.total_data ?? 0).toLocaleString()}
          trend={statTrendFromSeries(stats?.total_data_series)}
          sparkValues={statSparkValues(stats?.total_data_series)}
          sparkColor="var(--color-accent)"
          hint={statSeriesHint(stats?.total_data_series)}
        />
        <StatCard
          icon="check"
          label="已完成任务"
          value={(stats?.completed ?? 0).toLocaleString()}
          trend={statTrendFromSeries(stats?.completed_series)}
          sparkValues={statSparkValues(stats?.completed_series)}
          sparkColor="var(--color-success)"
          hint={statSeriesHint(stats?.completed_series)}
        />
        <StatCard
          icon="sparkles"
          label="AI 派生标注率"
          value={`${stats?.ai_rate ?? 0}%`}
          trend={statTrendFromSeries(stats?.ai_rate_series)}
          sparkValues={statSparkValues(stats?.ai_rate_series)}
          sparkColor="var(--color-ai)"
          hint={statSeriesHint(stats?.ai_rate_series)}
        />
        <StatCard
          icon="flag"
          label="待审核任务"
          value={(stats?.pending_review ?? 0).toLocaleString()}
          trend={statTrendFromSeries(stats?.pending_review_series)}
          sparkValues={statSparkValues(stats?.pending_review_series)}
          sparkColor="var(--color-warning)"
          hint={statSeriesHint(stats?.pending_review_series)}
        />
      </div>

      <Card>
        <div className={styles.cardHeader}>
          <div className={styles.cardTitleRow}>
            <h3 className={styles.cardTitle}>全部项目</h3>
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
            <div className={styles.emptyState}>加载中...</div>
          ) : (
            <ProjectGrid
              projects={projects}
              onOpen={onOpenProject}
              canManage={() => true}
              onSettings={onSettings}
            />
          )
        ) : (
          <div className={styles.projectTableScroller}>
            <table className={styles.projectTable}>
              <thead>
                <tr>
                  {["项目", "负责人", "进度", "AI 模型", "状态", "截止 / 更新", ""].map((h, i) => (
                    <th key={i}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {isLoading && (
                  <tr>
                    <td colSpan={7} className={styles.tableEmptyCell}>加载中...</td>
                  </tr>
                )}
                {!isLoading && projects.map((p) => (
                  <AdminProjectRow key={p.id} p={p} onOpen={onOpenProject} onSettings={onSettings} />
                ))}
                {!isLoading && projects.length === 0 && (
                  <tr>
                    <td colSpan={7} className={styles.tableEmptyCell}>没有匹配的项目</td>
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
    </div>
  );
}
