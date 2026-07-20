/**
 * v0.23.4 P3 · 注册管理 tab — orchestrator shell.
 *
 * Plan §4.1 / §6.1 / §10: this file is the only place that owns the registry
 * queries and renders the role-aware tab structure. It:
 *   - reads `usePermissions()` and gates Super Admin vs Project Admin tabs;
 *   - owns the topology / runtime-snapshot / gpu-resources / overview queries;
 *   - merges topology + snapshot via the pure view-model (no URL-join);
 *   - collects diagnostics for the Issue Center;
 *   - renders a single header with counts + search + status filter + 刷新 +
 *     Super Admin "注册实例" entry;
 *   - delegates to the five section components under `registry/`.
 *
 * Mutations invalidate topology + all + overview + gpu-resources (extended in
 * useGlobalRegistry.ts). Role projection is server-side (P1) — this view does
 * NOT add client-side hiding as the only gate; it simply does not render what
 * the server already nulled (plan §5 + Appendix A.6).
 */
import { useMemo, useState, type ReactNode } from "react";

import { useQuery } from "@tanstack/react-query";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/shadcn/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/shadcn/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/shadcn/ui/tooltip";
import { adminMlIntegrationsApi } from "@/api/adminMlIntegrations";
import { usePermissions } from "@/hooks/usePermissions";

import {
  collectDiagnostics,
  mergeTopologyAndSnapshot,
} from "./runtimeTopology";
import { GlobalBackendFormModal } from "./GlobalBackendFormModal";
import { ServicePoolsSection } from "./registry/ServicePoolsSection";
import { BackendInstancesSection } from "./registry/BackendInstancesSection";
import { GPUResourcesSection } from "./registry/GPUResourcesSection";
import { ProjectBindingsSection } from "./registry/ProjectBindingsSection";
import { IssueCenter } from "./registry/IssueCenter";
import type {
  RegistryFilters,
  RegistryScope,
} from "./registry/registryTypes";

type StatusFilter = RegistryFilters["statusFilter"];

export function RegisteredBackendsTab(): ReactNode {
  const { role } = usePermissions();
  const isSuperAdmin = role === "super_admin";

  const [filters, setFilters] = useState<RegistryFilters>({
    search: "",
    statusFilter: "all",
  });
  const [tab, setTab] = useState<string>("pools");
  const [registerOpen, setRegisterOpen] = useState(false);

  // ── queries ──────────────────────────────────────────────────────────────
  // Plan §9.1 + §9.3: topology is the registry default read model and is
  // always fetched (both roles); runtime-snapshot / gpu-resources / overview
  // are SUPER_ADMIN-only.
  const topologyQ = useQuery({
    queryKey: ["admin", "ml-integrations", "topology"],
    queryFn: () => adminMlIntegrationsApi.topology(),
    staleTime: 60_000,
  });

  const snapshotQ = useQuery({
    queryKey: ["admin", "ml-integrations", "runtime-snapshot"],
    queryFn: () => adminMlIntegrationsApi.runtimeSnapshot(),
    staleTime: 30_000,
    enabled: isSuperAdmin,
  });

  const gpuQ = useQuery({
    queryKey: ["admin", "ml-integrations", "gpu-resources"],
    queryFn: () => adminMlIntegrationsApi.gpuResources(),
    staleTime: 60_000,
    enabled: isSuperAdmin,
  });

  const overviewQ = useQuery({
    queryKey: ["admin", "ml-integrations", "overview"],
    queryFn: () => adminMlIntegrationsApi.overview(),
    staleTime: 60_000,
    enabled: isSuperAdmin,
  });

  const allQ = useQuery({
    queryKey: ["admin", "ml-integrations", "all"],
    queryFn: () => adminMlIntegrationsApi.listAll(),
    staleTime: 60_000,
  });

  const refreshAll = () => {
    topologyQ.refetch();
    if (isSuperAdmin) {
      snapshotQ.refetch();
      gpuQ.refetch();
      overviewQ.refetch();
    }
    allQ.refetch();
  };

  // ── view-model merge ──────────────────────────────────────────────────────
  // topologyQ.data may be undefined while loading; once loaded it is non-null.
  // We narrow here so the rest of the component (and the RegistryScope it
  // builds) can rely on a non-null TopologyResponse.
  const topology = topologyQ.data ?? null;
  const snapshot = isSuperAdmin ? snapshotQ.data ?? null : null;
  const vm = useMemo(() => {
    if (!topology) return null;
    return mergeTopologyAndSnapshot(topology, snapshot);
  }, [topology, snapshot]);

  const diagnostics = useMemo(() => {
    if (!topology) return [];
    return collectDiagnostics(
      topology,
      snapshot,
      isSuperAdmin ? gpuQ.data?.resources ?? null : null,
    );
  }, [topology, snapshot, gpuQ.data, isSuperAdmin]);

  // ── loading / error / partial-fail ────────────────────────────────────────
  // Topology is load-bearing for every tab; if it fails and we have nothing
  // cached, surface a full error block. If only runtime-snapshot fails, keep
  // the topology view and mark partial (plan §6.3).
  if (topologyQ.isLoading) {
    return <LoadingShell label="加载服务池拓扑…" />;
  }
  if (topologyQ.isError && !topology) {
    return (
      <ErrorShell
        message={`拓扑加载失败：${(topologyQ.error as Error)?.message ?? "未知错误"}`}
        onRetry={() => topologyQ.refetch()}
      />
    );
  }
  if (!vm || !topology) {
    return <LoadingShell label="组装视图模型…" />;
  }
  // After the guards above, both `vm` and `topology` are non-null. Bind a
  // narrowed local so TS carries the non-nullability into RegistryScope.
  const narrowedTopology = topology;
  const narrowedVm = vm;

  // ── header counts ─────────────────────────────────────────────────────────
  const totalPools = narrowedVm.pools.length;
  const routableInstances = narrowedVm.pools.reduce(
    (sum, p) => sum + p.availability.routable,
    0,
  );
  const totalInstances = narrowedVm.pools.reduce((sum, p) => sum + p.availability.total, 0);
  const anomalyCount = diagnostics.length;
  const affectedProjects = isSuperAdmin && overviewQ.data
    ? countAffectedProjects(overviewQ.data.projects, narrowedVm.pools)
    : null;

  const scope: RegistryScope = {
    isSuperAdmin,
    vm: narrowedVm,
    topology: narrowedTopology,
    servicePools: null,
    backends: allQ.data?.items ?? [],
    gpuResources: isSuperAdmin ? gpuQ.data?.resources ?? null : null,
    overview: isSuperAdmin ? overviewQ.data ?? null : null,
    diagnostics,
    routerMode: narrowedVm.router_mode,
  };

  return (
    // TooltipProvider: several descendants (CopyableId, FreshnessIndicator,
    // SourceErrorBadge) use Radix Tooltip, which requires a provider ancestor.
    <TooltipProvider>
      <div className="flex flex-col gap-4">
        <Card>
          <RegistryHeader
          isSuperAdmin={isSuperAdmin}
          totalPools={totalPools}
          routableInstances={routableInstances}
          totalInstances={totalInstances}
          anomalyCount={anomalyCount}
          affectedProjects={affectedProjects}
          filters={filters}
          onFiltersChange={setFilters}
          onRefresh={refreshAll}
          refreshing={
            topologyQ.isFetching ||
            (isSuperAdmin &&
              (snapshotQ.isFetching || gpuQ.isFetching || overviewQ.isFetching)) ||
            allQ.isFetching
          }
          snapshotError={
            isSuperAdmin && snapshotQ.isError
              ? (snapshotQ.error as Error)?.message ?? "运行时快照加载失败"
              : null
          }
          gpuError={
            isSuperAdmin && gpuQ.isError
              ? (gpuQ.error as Error)?.message ?? "GPU 资源加载失败"
              : null
          }
          overviewError={
            isSuperAdmin && overviewQ.isError
              ? (overviewQ.error as Error)?.message ?? "项目绑定概览加载失败"
              : null
          }
          allError={
            allQ.isError
              ? (allQ.error as Error)?.message ?? "实例列表加载失败"
              : null
          }
          onOpenRegister={() => setRegisterOpen(true)}
        />
      </Card>

      <Card className="p-3">
        {isSuperAdmin ? (
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList className="mb-3">
              <TabsTrigger value="pools">
                <Icon name="layers" size={12} />
                服务池
              </TabsTrigger>
              <TabsTrigger value="instances">
                <Icon name="bot" size={12} />
                实例
              </TabsTrigger>
              <TabsTrigger value="gpu">
                <Icon name="activity" size={12} />
                GPU 资源
              </TabsTrigger>
              <TabsTrigger value="projects">
                <Icon name="folder" size={12} />
                项目绑定
              </TabsTrigger>
              <TabsTrigger value="issues">
                <Icon name="alert-triangle" size={12} />
                问题中心
                {anomalyCount > 0 && (
                  <Badge variant="danger" className="ml-1 text-2xs">
                    {anomalyCount}
                  </Badge>
                )}
              </TabsTrigger>
            </TabsList>
            <TabsContent value="pools">
              <ServicePoolsSection scope={scope} filters={filters} />
            </TabsContent>
            <TabsContent value="instances">
              <BackendInstancesSection scope={scope} filters={filters} />
            </TabsContent>
            <TabsContent value="gpu">
              <GPUResourcesSection scope={scope} />
            </TabsContent>
            <TabsContent value="projects">
              <ProjectBindingsSection scope={scope} />
            </TabsContent>
            <TabsContent value="issues">
              <IssueCenter scope={scope} />
            </TabsContent>
          </Tabs>
        ) : (
          // Project Admin: only the first two tabs, read-only. No Issue Center,
          // no GPU Resources, no Project Bindings overview (plan §5).
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList className="mb-3">
              <TabsTrigger value="pools">
                <Icon name="layers" size={12} />
                服务池
              </TabsTrigger>
              <TabsTrigger value="instances">
                <Icon name="bot" size={12} />
                实例
              </TabsTrigger>
            </TabsList>
            <TabsContent value="pools">
              <ServicePoolsSection scope={scope} filters={filters} />
            </TabsContent>
            <TabsContent value="instances">
              <BackendInstancesSection scope={scope} filters={filters} />
            </TabsContent>
          </Tabs>
        )}
      </Card>

        <GlobalBackendFormModal
          open={registerOpen}
          backend={null}
          onClose={() => setRegisterOpen(false)}
        />
      </div>
    </TooltipProvider>
  );
}

// ── header ───────────────────────────────────────────────────────────────────

function RegistryHeader({
  isSuperAdmin,
  totalPools,
  routableInstances,
  totalInstances,
  anomalyCount,
  affectedProjects,
  filters,
  onFiltersChange,
  onRefresh,
  refreshing,
  snapshotError,
  gpuError,
  overviewError,
  allError,
  onOpenRegister,
}: {
  isSuperAdmin: boolean;
  totalPools: number;
  routableInstances: number;
  totalInstances: number;
  anomalyCount: number;
  affectedProjects: number | null;
  filters: RegistryFilters;
  onFiltersChange: (f: RegistryFilters) => void;
  onRefresh: () => void;
  refreshing: boolean;
  snapshotError: string | null;
  gpuError: string | null;
  overviewError: string | null;
  allError: string | null;
  onOpenRegister: () => void;
}): ReactNode {
  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Icon name="layers" size={14} className="text-muted-foreground" />
          <h3 className="m-0 text-sm font-semibold">注册管理</h3>
          <HeaderStat label="服务池" value={totalPools} />
          <HeaderStat
            label="可路由 / 总实例"
            value={`${routableInstances} / ${totalInstances}`}
            tone={routableInstances === 0 && totalInstances > 0 ? "danger" : "default"}
          />
          {isSuperAdmin && (
            <HeaderStat
              label="异常"
              value={anomalyCount}
              tone={anomalyCount > 0 ? "warning" : "default"}
            />
          )}
          {isSuperAdmin && affectedProjects != null && (
            <HeaderStat label="受影响项目" value={affectedProjects} />
          )}
        </div>
        <div className="flex items-center gap-2">
          {isSuperAdmin && (
            <Button size="sm" variant="primary" onClick={onOpenRegister}>
              <Icon name="plus" size={11} />
              注册实例
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={onRefresh}
            disabled={refreshing}
            title="刷新全部数据源"
          >
            <Icon name={refreshing ? "loader2" : "refresh"} size={11} className={refreshing ? "spin" : undefined} />
            刷新
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Icon
            name="search"
            size={12}
            className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            aria-label="搜索服务池或实例"
            placeholder="搜索名称 / ID / URL"
            value={filters.search}
            onChange={(e) => onFiltersChange({ ...filters, search: e.target.value })}
            className="h-8 w-56 pl-7 text-xs"
          />
        </div>
        <label className="inline-flex items-center gap-1 text-2xs text-muted-foreground">
          状态
          <select
            aria-label="按状态筛选"
            value={filters.statusFilter}
            onChange={(e) =>
              onFiltersChange({ ...filters, statusFilter: e.target.value as StatusFilter })
            }
            className="h-8 rounded-md border border-border bg-card px-2 text-xs text-foreground outline-none [font-family:inherit]"
          >
            <option value="all">全部</option>
            <option value="healthy">健康</option>
            <option value="degraded">降级</option>
            <option value="offline">离线</option>
            <option value="unknown">未知</option>
          </select>
        </label>
      </div>

      {/* Partial-failures row — each source keeps its own error so other data
          stays visible (plan §6.3). */}
      {(snapshotError || gpuError || overviewError || allError) && (
        <div className="flex flex-wrap items-center gap-2 text-2xs">
          {snapshotError && <SourceErrorBadge label="运行时快照" message={snapshotError} />}
          {gpuError && <SourceErrorBadge label="GPU 资源" message={gpuError} />}
          {overviewError && <SourceErrorBadge label="项目绑定" message={overviewError} />}
          {allError && <SourceErrorBadge label="实例列表" message={allError} />}
        </div>
      )}
    </div>
  );
}

function HeaderStat({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string | number;
  tone?: "default" | "warning" | "danger";
}): ReactNode {
  const valueTone =
    tone === "danger"
      ? "text-status-danger"
      : tone === "warning"
        ? "text-status-caution"
        : "text-foreground";
  return (
    <Badge variant="outline" className="gap-1.5">
      <span className="text-muted-foreground">{label}</span>
      <span className={valueTone + " font-semibold"}>{value}</span>
    </Badge>
  );
}

function SourceErrorBadge({ label, message }: { label: string; message: string }): ReactNode {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge variant="danger" className="cursor-help">
          <Icon name="alert-triangle" size={11} />
          <span>{label}加载失败</span>
        </Badge>
      </TooltipTrigger>
      <TooltipContent>{message}</TooltipContent>
    </Tooltip>
  );
}

function LoadingShell({ label }: { label: string }): ReactNode {
  return (
    <Card>
      <div className="flex items-center justify-center gap-2 p-12 text-sm text-muted-foreground">
        <Icon name="loader2" size={16} className="spin" />
        {label}
      </div>
    </Card>
  );
}

function ErrorShell({ message, onRetry }: { message: string; onRetry: () => void }): ReactNode {
  return (
    <Card>
      <div className="flex flex-col items-center gap-2 p-12 text-center text-sm text-status-danger">
        <Icon name="warning" size={20} />
        <div>{message}</div>
        <Button size="sm" variant="ghost" onClick={onRetry}>
          <Icon name="refresh" size={11} />
          重试
        </Button>
      </div>
    </Card>
  );
}

/** Count projects whose pool bindings include an offline or zero-routable pool. */
function countAffectedProjects(
  projects: Array<{ project_id: string; project_name: string; backends: Array<{ id: string }> }>,
  pools: RegistryScope["vm"]["pools"],
): number {
  let count = 0;
  for (const proj of projects) {
    const backendIds = new Set(proj.backends.map((b) => b.id));
    const linked = pools.filter((p) =>
      p.members.some((m) => backendIds.has(m.registry_id)),
    );
    const atRisk =
      linked.length === 0 ||
      linked.some((p) => p.status === "offline" || p.availability.routable === 0);
    if (atRisk && proj.backends.length > 0) count += 1;
  }
  return count;
}
