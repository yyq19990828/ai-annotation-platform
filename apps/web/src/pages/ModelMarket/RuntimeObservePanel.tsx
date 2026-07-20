/**
 * v0.23.4 · runtime observation orchestrator (plan §6.2 / §9.3).
 *
 * Pure shell: owns three queries (topology, runtime-snapshot, observe) and
 * delegates rendering to the runtime/ components. No URL-join — pool/member
 * join is done by {@link mergeTopologyAndSnapshot}. One user-visible refresh
 * button refetches all three in parallel; auto-refresh ticks runtime-snapshot
 * only. Partial source failure is surfaced as a banner, never an error block.
 *
 * Super-admin-only: the parent tab is hidden for non-super-admins (kept
 * assumption); this panel does not re-gate.
 */
import { useCallback, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Switch } from "@/components/ui/Switch";
import { TooltipProvider } from "@/components/shadcn/ui/tooltip";
import {
  adminMlIntegrationsApi,
  type GlobalBackendItem,
  type ObserveTarget,
} from "@/api/adminMlIntegrations";
import { mlBackendsApi, type MLBackendVariant } from "@/api/ml-backends";
import {
  mergeTopologyAndSnapshot,
  type RuntimeTopologyViewModel,
} from "./runtimeTopology";
import { ServicePoolRuntimeTable } from "./runtime/ServicePoolRuntimeTable";
import { EnvOnlyContainerCard } from "./runtime/EnvOnlyContainerCard";
import { FreshnessIndicator } from "./runtime/FreshnessIndicator";
import { GlobalBackendFormModal } from "./GlobalBackendFormModal";
import type { VariantWarmTarget } from "./VariantPanel";
import { invalidateRuntimeQueries } from "./runtime/LifecycleActions";

const TOPOLOGY_KEY = ["admin", "ml-integrations", "topology"] as const;
const SNAPSHOT_KEY = ["admin", "ml-integrations", "runtime-snapshot"] as const;
const OBSERVE_KEY = ["admin", "ml-integrations", "observe"] as const;

const AUTO_REFRESH_MS = 15_000;

function normalizeUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

export function RuntimeObservePanel(): React.ReactElement {
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [registerOpen, setRegisterOpen] = useState(false);

  const topologyQ = useQuery({
    queryKey: [...TOPOLOGY_KEY],
    queryFn: () => adminMlIntegrationsApi.topology(),
    refetchInterval: 60_000,
  });
  const snapshotQ = useQuery({
    queryKey: [...SNAPSHOT_KEY],
    queryFn: () => adminMlIntegrationsApi.runtimeSnapshot(),
    refetchInterval: autoRefresh ? AUTO_REFRESH_MS : false,
  });
  const observeQ = useQuery({
    queryKey: [...OBSERVE_KEY],
    queryFn: () => adminMlIntegrationsApi.observe(),
    refetchInterval: 60_000,
  });
  // legacy /all + /overview — still needed for per-member backend lookup,
  // GPU claim display and the warmup projectId path (v0.23.3 pool members
  // reference registry_id; /all is the per-registry record source).
  const allQ = useQuery({
    queryKey: ["admin", "ml-integrations", "all"],
    queryFn: () => adminMlIntegrationsApi.listAll(),
    refetchInterval: 60_000,
  });
  const overviewQ = useQuery({
    queryKey: ["admin", "ml-integrations", "overview"],
    queryFn: () => adminMlIntegrationsApi.overview(),
    refetchInterval: 60_000,
  });

  const refetchAll = useCallback(() => {
    topologyQ.refetch();
    snapshotQ.refetch();
    observeQ.refetch();
    allQ.refetch();
    overviewQ.refetch();
  }, [topologyQ, snapshotQ, observeQ, allQ, overviewQ]);

  const topology = useMemo<RuntimeTopologyViewModel | null>(() => {
    if (!topologyQ.data) return null;
    return mergeTopologyAndSnapshot(topologyQ.data, snapshotQ.data ?? null);
  }, [topologyQ.data, snapshotQ.data]);

  // registry_id → GlobalBackendItem (from /all).
  const backendsById = useMemo(() => {
    const map = new Map<string, GlobalBackendItem>();
    for (const b of allQ.data?.items ?? []) map.set(b.id, b);
    return map;
  }, [allQ.data]);

  // url → ObserveTarget (normalized), for residency + env-only.
  const observeByUrl = useMemo(() => {
    const map = new Map<string, ObserveTarget>();
    for (const t of observeQ.data?.targets ?? [])
      map.set(normalizeUrl(t.url), t);
    return map;
  }, [observeQ.data]);

  // registry_id → ObserveTarget via its backend.url (display-only join — NOT a
  // routing-key join; observe has no pool/registry identity).
  const observeByRegistry = useMemo(() => {
    const map = new Map<string, ObserveTarget>();
    for (const b of backendsById.values()) {
      const t = observeByUrl.get(normalizeUrl(b.url));
      if (t) map.set(b.id, t);
    }
    return map;
  }, [backendsById, observeByUrl]);

  // registry_id → first enabling projectId (warmup path needs one).
  const projectByBackend = useMemo(() => {
    const map = new Map<string, string>();
    for (const project of overviewQ.data?.projects ?? []) {
      for (const backend of project.backends) {
        if (!map.has(backend.id)) map.set(backend.id, project.project_id);
      }
    }
    return map;
  }, [overviewQ.data]);

  const registeredUrls = useMemo(() => {
    const set = new Set<string>();
    for (const b of backendsById.values()) set.add(normalizeUrl(b.url));
    return set;
  }, [backendsById]);

  const envOnlyTargets = useMemo(
    () =>
      (observeQ.data?.targets ?? []).filter(
        (t) => t.registered === false && !registeredUrls.has(normalizeUrl(t.url)),
      ),
    [observeQ.data, registeredUrls],
  );

  const loading =
    topologyQ.isLoading ||
    snapshotQ.isLoading ||
    observeQ.isLoading ||
    allQ.isLoading;
  const fetching =
    topologyQ.isFetching ||
    snapshotQ.isFetching ||
    observeQ.isFetching ||
    allQ.isFetching;
  const hardError = topologyQ.error ?? (topology ? null : snapshotQ.error);

  const onWarm = useWarmupDispatcher(projectByBackend);

  const lookup = useCallback(
    (registryId: string) => {
      const backend = backendsById.get(registryId);
      const observe = observeByRegistry.get(registryId);
      const projectId = projectByBackend.get(registryId);
      return { backend, observe, projectId };
    },
    [backendsById, observeByRegistry, projectByBackend],
  );

  const poolCount = topology?.pools.length ?? 0;
  const memberCount =
    topology?.pools.reduce((sum, p) => sum + p.members.length, 0) ?? 0;

  return (
    <TooltipProvider delayDuration={200}>
      <div className="mb-4 flex flex-col gap-3">
        <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3 max-md:flex-col max-md:items-stretch">
          <div className="flex items-center gap-2">
            <Icon name="activity" size={14} className="text-muted-foreground" />
            <h3 className="m-0 text-sm font-semibold">运行时观测</h3>
            <span className="text-xs text-muted-foreground">
              {poolCount} 个服务池 · {memberCount} 个实例 · {envOnlyTargets.length}{" "}
              个未纳管容器
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2 max-md:w-full max-md:flex-col max-md:items-stretch">
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Switch
                checked={autoRefresh}
                onChange={setAutoRefresh}
                title="每 15 秒自动刷新运行时快照"
              />
              <span>自动刷新</span>
            </label>
            <Button size="sm" onClick={refetchAll} disabled={fetching}>
              <Icon name="refresh" size={11} />
              刷新
            </Button>
          </div>
        </div>

        {/* 数据来源 expandable region (plan §6.2) */}
        {topology && (
          <DataSourceRegion
            topology={topology}
            snapshotError={
              snapshotQ.error ? String((snapshotQ.error as Error).message) : null
            }
            observeError={
              observeQ.error ? String((observeQ.error as Error).message) : null
            }
          />
        )}

        <div className="flex flex-col gap-3 p-3">
          {loading && topology === null ? (
            <div className="py-3 text-xs text-muted-foreground">
              加载运行时状态…
            </div>
          ) : hardError ? (
            <div className="text-xs text-status-danger">
              加载失败：{(hardError as Error).message ?? "未知错误"}
            </div>
          ) : topology ? (
            <ServicePoolRuntimeTable
              topology={topology}
              lookup={lookup}
              onWarm={onWarm}
            />
          ) : null}

          {envOnlyTargets.length > 0 && (
            <EnvOnlySection
              targets={envOnlyTargets}
              onRegister={() => setRegisterOpen(true)}
            />
          )}
        </div>
      </Card>

      {registerOpen && (
        <GlobalBackendFormModal
          open={registerOpen}
          onClose={() => setRegisterOpen(false)}
        />
      )}
      </div>
    </TooltipProvider>
  );
}

function DataSourceRegion({
  topology,
  snapshotError,
  observeError,
}: {
  topology: RuntimeTopologyViewModel;
  snapshotError: string | null;
  observeError: string | null;
}): React.ReactElement {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-border px-4 py-2">
      <button
        type="button"
        className="flex w-full cursor-pointer appearance-none items-center gap-2 border-0 bg-transparent p-0 text-left text-xs text-muted-foreground hover:text-foreground"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <Icon name={open ? "chevDown" : "chevRight"} size={11} />
        <span>数据来源</span>
        <span className="text-2xs">
          快照 {topology.observed_at ?? "—"}
          {topology.partial && " · 部分失败"}
        </span>
      </button>
      {open && (
        <div className="mt-2 flex flex-col gap-2">
          {topology.partial && (
            <div className="flex items-start gap-1.5 rounded-md border border-status-caution/50 bg-status-caution-soft px-2.5 py-1.5 text-xs text-status-caution">
              <Icon name="alert-triangle" size={12} />
              <span>
                部分数据来源失败：{topology.partial_reason ?? "原因未知"}
                ；已保留其它可信来源，未整页替换为错误。
              </span>
            </div>
          )}
          <div className="flex flex-wrap gap-1.5">
            {topology.sources.length === 0 && (
              <span className="text-2xs text-muted-foreground">
                无来源新鲜度信息
              </span>
            )}
            {topology.sources.map((s) => (
              <FreshnessIndicator key={s.name} source={s} />
            ))}
          </div>
          {snapshotError && (
            <div className="text-2xs text-status-danger">
              runtime-snapshot：{snapshotError}
            </div>
          )}
          {observeError && (
            <div className="text-2xs text-status-danger">observe：{observeError}</div>
          )}
        </div>
      )}
    </div>
  );
}

function EnvOnlySection({
  targets,
  onRegister,
}: {
  targets: ObserveTarget[];
  onRegister: (url: string) => void;
}): React.ReactElement {
  const [collapsed, setCollapsed] = useState(true);
  return (
    <section className="flex flex-col gap-2.5">
      <button
        type="button"
        className="flex w-full cursor-pointer appearance-none items-center gap-2 border-0 bg-transparent p-0 text-left text-xs font-semibold text-muted-foreground hover:text-foreground"
        onClick={() => setCollapsed((v) => !v)}
        aria-expanded={!collapsed}
      >
        <Icon name={collapsed ? "chevRight" : "chevDown"} size={11} />
        <span>未纳管容器（{targets.length}）</span>
        <span className="text-2xs font-normal">
          来自 ML_BACKEND_OBSERVE_URLS，未注册到全局表
        </span>
      </button>
      {!collapsed && (
        <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
          {targets.map((t) => (
            <EnvOnlyContainerCard
              key={t.url}
              target={t}
              onRegister={onRegister}
            />
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * Warmup dispatcher: resolves the projectId for a registry_id and invokes the
 * legacy reload endpoint (v0.23.4 — generic warmup wired through the detail
 * Sheet's variant picker). Mirrors the legacy panel's behavior, centralized
 * so the detail Sheet + row can both call it.
 */
function useWarmupDispatcher(
  projectByBackend: Map<string, string>,
): (registryId: string, target?: VariantWarmTarget) => void {
  const qc = useQueryClient();
  const reload = useMutation({
    mutationFn: ({
      projectId,
      backendId,
      variant,
      taskType,
    }: {
      projectId: string;
      backendId: string;
      variant?: MLBackendVariant;
      taskType?: "image" | "video";
    }) => mlBackendsApi.reload(projectId, backendId, variant, taskType),
    onSuccess: () => {
      invalidateRuntimeQueries(qc);
    },
  });

  return (registryId: string, target?: VariantWarmTarget) => {
    const projectId = projectByBackend.get(registryId);
    if (!projectId) return;
    const variant = target?.variants as MLBackendVariant | undefined;
    reload.mutate({
      projectId,
      backendId: registryId,
      variant,
      taskType: target?.taskType,
    });
  };
}
