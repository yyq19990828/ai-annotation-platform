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
import { ProjectActionsMenu } from "./ProjectActionsMenu";
import { ProjectGrid } from "./ProjectGrid";
import { FilterDrawer, EMPTY_FILTERS, type DashboardFilters } from "./FilterDrawer";
import { buildWorkbenchUrl, currentWorkbenchReturnTo } from "@/utils/workbenchNavigation";
import { projectDisplayType } from "@/utils/projectDisplay";
import { statSeriesHint, statSparkValues, statTrendFromSeries } from "@/utils/projectStatsSeries";

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
// 按媒体维度 data_type 放行工作台,图像子类型(det/ocr/seg)同走图像栈,见 DashboardPage。
const WORKBENCH_DATA_TYPES = new Set(["image", "video", "lidar"]);

// 表格单元(列表视图)共用类
const TD_CLASS = "border-b border-border p-3 align-middle";
const TH_CLASS =
  "border-b border-border bg-muted px-3 py-2.5 text-left text-xs font-medium text-muted-foreground whitespace-nowrap first:pl-4 last:pr-4";
const BATCH_LINK_CLASS =
  "mt-1 inline-flex items-center gap-1 cursor-pointer appearance-none border-0 bg-transparent p-0 text-xs text-muted-foreground underline decoration-dotted underline-offset-2";

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
    <tr>
      <td className={`${TD_CLASS} pl-4`}>
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="flex size-7 shrink-0 items-center justify-center rounded-md border border-border bg-muted text-muted-foreground">
            <Icon name={DATA_TYPE_ICONS[p.data_type ?? "image"] || "image"} size={14} />
          </div>
          <div className="min-w-0">
            <div className="max-w-[220px] truncate text-sm font-medium">{p.name}</div>
            <div className="mt-0.5 flex min-w-0 items-baseline gap-2">
              <span className="mono text-xs leading-4 text-muted-foreground">{p.display_id}</span>
              <span className="leading-4 text-muted-foreground">·</span>
              <span className="truncate text-xs leading-4 text-muted-foreground">
                {projectDisplayType(p)}
              </span>
            </div>
          </div>
        </div>
      </td>
      <td className={TD_CLASS}>
        <div className="flex items-center gap-2">
          <Avatar initial={ownerInitial} size="sm" />
          <div>
            <div className="whitespace-nowrap text-sm">{p.owner_name ?? "—"}</div>
            <div className="text-xs text-muted-foreground">
              {(p.member_count ?? 0) > 0 ? `${p.member_count} 名成员` : "暂无成员"}
            </div>
          </div>
        </div>
      </td>
      <td className={`${TD_CLASS} min-w-[220px]`}>
        <ProgressBar value={pct} aiValue={aiPct} inProgressValue={startedPct} />
        <div className="mt-1 flex justify-between text-xs text-muted-foreground">
          <span className="mono">
            {p.completed_tasks.toLocaleString()} / {p.total_tasks.toLocaleString()}
            {(p.in_progress_tasks ?? 0) + p.review_tasks > 0 && (
              <span className="text-xs text-muted-foreground">
                {" · "}
                {(p.in_progress_tasks ?? 0) > 0 && <>{p.in_progress_tasks} 进行中</>}
                {(p.in_progress_tasks ?? 0) > 0 && p.review_tasks > 0 && " · "}
                {p.review_tasks > 0 && <>{p.review_tasks} 待审</>}
              </span>
            )}
          </span>
          <span className="font-medium text-foreground">{pct}%</span>
        </div>
        {(p.batch_summary?.total ?? 0) > 0 && (
          <div className="mt-[3px] text-xs text-muted-foreground">
            {p.batch_summary?.total} 个批次
            {(p.batch_summary?.assigned ?? 0) > 0 && (
              <> · {p.batch_summary?.assigned} 已分派</>
            )}
            {(p.batch_summary?.in_review ?? 0) > 0 && (
              <> · <span className="text-status-caution">{p.batch_summary?.in_review} 审核中</span></>
            )}
          </div>
        )}
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onSettings(p, "batches"); }}
          className={BATCH_LINK_CLASS}
          title="跳转到项目设置 → 批次管理"
        >
          <Icon name="layers" size={10} /> 查看批次分派
        </button>
      </td>
      <td className={TD_CLASS}>
        {p.ai_enabled ? (
          <Badge variant="ai">
            <Icon name="sparkles" size={10} />
            {p.ml_backend_id ? "已接入模型" : "未接入模型"}
          </Badge>
        ) : (
          <span className="whitespace-nowrap text-xs text-muted-foreground">未启用</span>
        )}
      </td>
      <td className={TD_CLASS}>
        {p.status === "in_progress" && <Badge variant="accent" dot>进行中</Badge>}
        {p.status === "completed" && <Badge variant="success" dot>已完成</Badge>}
        {p.status === "pending_review" && <Badge variant="warning" dot>待审核</Badge>}
      </td>
      <td className={TD_CLASS}>
        <div className="whitespace-nowrap text-xs">{due}</div>
        <div className="text-xs text-muted-foreground">更新 {updated}</div>
      </td>
      <td className={`${TD_CLASS} whitespace-nowrap pr-4 text-right`} onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-end gap-1">
          <Button size="sm" variant="ghost" onClick={() => onSettings(p)}>
            <Icon name="settings" size={12} />设置
          </Button>
          <Button size="sm" onClick={() => onOpen(p)}>
            打开 <Icon name="chevRight" size={11} />
          </Button>
          <ProjectActionsMenu project={p} canManage />
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
    if (p.data_type && WORKBENCH_DATA_TYPES.has(p.data_type)) {
      navigate(buildWorkbenchUrl(p.id, { returnTo: currentWorkbenchReturnTo(location) }));
    } else {
      pushToast({ msg: `项目 "${p.name}" 已打开`, sub: `${projectDisplayType(p)} 的标注界面尚未实现` });
    }
  };

  return (
    <div className="mx-auto max-w-[1480px] px-7 pb-10 pt-5 text-foreground max-[900px]:p-4">
      <div className="mb-5 flex items-end justify-between gap-6 max-[900px]:flex-col max-[900px]:items-start">
        <div>
          <h1 className="mb-1 text-xl font-semibold">Dashboard</h1>
          <p className="text-sm text-muted-foreground">管理平台全部项目、负责人、批次分派与导出入口</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => setImportOpen(true)}>
            <Icon name="upload" size={13} />导入数据集
          </Button>
          <ImportDatasetWizard
            open={importOpen}
            onClose={() => setImportOpen(false)}
            onUploaded={() => navigate("/datasets")}
          />
          <Button variant="primary" onClick={openWizard} data-testid="new-project-btn">
            <Icon name="plus" size={13} />新建项目
          </Button>
          <CreateProjectWizard
            open={wizardOpen}
            onClose={closeWizard}
            sourceProjectId={wizardSourceProjectId}
          />
        </div>
      </div>

      <div className="mb-5 grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3">
        <StatCard
          icon="layers"
          label="任务总量"
          value={(stats?.total_data ?? 0).toLocaleString()}
          trend={statTrendFromSeries(stats?.total_data_series)}
          sparkValues={statSparkValues(stats?.total_data_series)}
          sparkColor="var(--sc-brand)"
          hint={statSeriesHint(stats?.total_data_series)}
        />
        <StatCard
          icon="check"
          label="已完成任务"
          value={(stats?.completed ?? 0).toLocaleString()}
          trend={statTrendFromSeries(stats?.completed_series)}
          sparkValues={statSparkValues(stats?.completed_series)}
          sparkColor="var(--sc-positive)"
          hint={statSeriesHint(stats?.completed_series)}
        />
        <StatCard
          icon="sparkles"
          label="AI 派生标注率"
          value={`${stats?.ai_rate ?? 0}%`}
          trend={statTrendFromSeries(stats?.ai_rate_series)}
          sparkValues={statSparkValues(stats?.ai_rate_series)}
          sparkColor="var(--sc-chart-4)"
          hint={statSeriesHint(stats?.ai_rate_series)}
        />
        <StatCard
          icon="flag"
          label="待审核任务"
          value={(stats?.pending_review ?? 0).toLocaleString()}
          trend={statTrendFromSeries(stats?.pending_review_series)}
          sparkValues={statSparkValues(stats?.pending_review_series)}
          sparkColor="var(--sc-caution)"
          hint={statSeriesHint(stats?.pending_review_series)}
        />
      </div>

      <Card>
        <div className="flex items-center justify-between border-b border-border px-4 py-3.5 max-[900px]:flex-col max-[900px]:items-start">
          <div className="flex items-center gap-3 max-[900px]:flex-wrap">
            <h3 className="text-sm font-semibold">全部项目</h3>
            <TabRow tabs={[...FILTERS]} active={filter} onChange={setFilter} />
          </div>
          <div className="flex gap-2 max-[900px]:flex-wrap">
            <SearchInput placeholder="搜索项目..." value={query} onChange={setQuery} width={220} />
            <Button onClick={() => setFilterOpen(true)}>
              <Icon name="filter" size={13} />筛选
              {advancedActiveCount > 0 && (
                <span className="ml-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full border border-brand/30 bg-brand/10 px-1.5 text-2xs leading-none text-brand">
                  {advancedActiveCount}
                </span>
              )}
            </Button>
            <Button
              onClick={() => setViewMode(viewMode === "grid" ? "list" : "grid")}
              title={viewMode === "grid" ? "切换到列表视图" : "切换到网格视图"}
              className={viewMode === "grid" ? "bg-muted" : undefined}
            >
              <Icon name={viewMode === "grid" ? "list" : "grid"} size={13} />
            </Button>
          </div>
        </div>
        {viewMode === "grid" ? (
          isLoading ? (
            <div className="p-10 text-center text-muted-foreground">加载中...</div>
          ) : (
            <ProjectGrid
              projects={projects}
              onOpen={onOpenProject}
              canManage={() => true}
              onSettings={onSettings}
            />
          )
        ) : (
          <div className="w-full overflow-x-auto [overscroll-behavior-x:contain]">
            <table className="w-full min-w-[1040px] border-separate border-spacing-0 text-sm">
              <thead>
                <tr>
                  {["项目", "负责人", "进度", "AI 模型", "状态", "截止 / 更新", ""].map((h, i) => (
                    <th key={i} className={TH_CLASS}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {isLoading && (
                  <tr>
                    <td colSpan={7} className="p-10 text-center text-muted-foreground">加载中...</td>
                  </tr>
                )}
                {!isLoading && projects.map((p) => (
                  <AdminProjectRow key={p.id} p={p} onOpen={onOpenProject} onSettings={onSettings} />
                ))}
                {!isLoading && projects.length === 0 && (
                  <tr>
                    <td colSpan={7} className="p-10 text-center text-muted-foreground">没有匹配的项目</td>
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
