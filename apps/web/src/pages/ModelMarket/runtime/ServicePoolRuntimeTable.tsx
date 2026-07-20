/**
 * v0.23.4 · the service-pool runtime tree table (plan §6.2 / §10).
 *
 * One row per pool, expandable to member rows. Pool columns map to plan §6.2:
 * 可用性 / 流量 / 容量 / 质量 / 资源 / 新鲜度. Member rows render the compact
 * instance view (delegated to {@link BackendInstanceRow}).
 *
 * Truth-preserving: every metrics-driven field (null in v0.23.4) renders the
 * "暂无路由指标" sentinel via {@link TrafficDistributionBar} /
 * {@link RuntimeStatusBadge}; never 0.
 */
import { useState, type ReactNode } from "react";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/shadcn/ui/table";
import type { GlobalBackendItem, ObserveTarget } from "@/api/adminMlIntegrations";
import {
  NO_METRICS_LABEL,
  type FreshnessViewModel,
  type PoolViewModel,
  type RuntimeTopologyViewModel,
} from "../runtimeTopology";
import { RuntimeStatusBadge } from "./RuntimeStatusBadge";
import { FreshnessIndicator } from "./FreshnessIndicator";
import { TrafficDistributionBar, type TrafficSegment } from "./TrafficDistributionBar";
import { BackendInstanceRow } from "./BackendInstanceRow";
import type { VariantWarmTarget } from "../VariantPanel";

/** Per-member lookups the orchestrator pre-computes from /all + /observe. */
export interface MemberLookups {
  backend: GlobalBackendItem | undefined;
  observe: ObserveTarget | undefined;
  /** Project id enabling warmup; undefined when no project binding. */
  projectId: string | undefined;
}

export interface ServicePoolRuntimeTableProps {
  topology: RuntimeTopologyViewModel;
  /** registry_id → member lookups (backend / observe / projectId). */
  lookup: (registryId: string) => MemberLookups;
  /** Warmup callback delegated to the orchestrator (owns the hooks). */
  onWarm?: (
    registryId: string,
    target?: VariantWarmTarget,
  ) => void;
  /** Set of registry_ids currently warming (disables warmup buttons). */
  warming?: Set<string>;
}

const POOL_COL_SPAN = 8;

export function ServicePoolRuntimeTable({
  topology,
  lookup,
  onWarm,
  warming,
}: ServicePoolRuntimeTableProps): ReactNode {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  const toggle = (poolId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(poolId)) next.delete(poolId);
      else next.add(poolId);
      return next;
    });
  };

  if (topology.pools.length === 0) {
    return (
      <div className="flex flex-col items-center gap-1.5 p-8 text-center text-sm text-muted-foreground">
        <Icon name="activity" size={28} className="opacity-30" />
        <div>暂无服务池</div>
        <div className="text-xs">
          在「注册管理」新建服务池并加入实例后会出现在这里
        </div>
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-8" />
          <TableHead>服务池</TableHead>
          <TableHead>可用性</TableHead>
          <TableHead>流量</TableHead>
          <TableHead>容量</TableHead>
          <TableHead>质量</TableHead>
          <TableHead>资源</TableHead>
          <TableHead>新鲜度</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {topology.pools.map((pool) => {
          const isOpen = expanded.has(pool.id);
          const residentCount = pool.members.filter((m) => {
            const { backend, observe } = lookup(m.registry_id);
            const hasResidency =
              observe?.residency != null ||
              backend?.health_meta?.residency != null;
            return hasResidency;
          }).length;
          const cpuFallbackCount = pool.members.filter((m) => {
            const { backend, observe } = lookup(m.registry_id);
            const compute =
              observe?.compute ?? backend?.health_meta?.compute ?? null;
            // reuse the same import path the row uses; inline check to avoid
            // an extra module load just for the count.
            return isCpuFallbackInline(compute);
          }).length;
          const trafficSegments: TrafficSegment[] = pool.members.map((m) => ({
            instance_id: m.registry_id,
            instance_name: m.name,
            count: m.runtime?.selection_count_window ?? null,
          }));
          const trafficTotal =
            pool.members.reduce(
              (sum, m) => sum + (m.runtime?.selection_count_window ?? 0),
              0,
            ) || null;
          const lastSelectedTimes = pool.members
            .map((m) => m.runtime?.last_selected_at ?? null)
            .filter((x): x is string => !!x)
            .sort();
          const lastSelected =
            lastSelectedTimes.length > 0
              ? lastSelectedTimes[lastSelectedTimes.length - 1]
              : null;

          return (
            <PoolBlock
              key={pool.id}
              pool={pool}
              isOpen={isOpen}
              onToggle={() => toggle(pool.id)}
              topology={topology}
              lookup={lookup}
              onWarm={onWarm}
              warming={warming}
              trafficSegments={trafficSegments}
              trafficTotal={trafficTotal}
              lastSelected={lastSelected ?? null}
              residentCount={residentCount}
              cpuFallbackCount={cpuFallbackCount}
            />
          );
        })}
      </TableBody>
    </Table>
  );
}

function PoolBlock({
  pool,
  isOpen,
  onToggle,
  topology,
  lookup,
  onWarm,
  warming,
  trafficSegments,
  trafficTotal,
  lastSelected,
  residentCount,
  cpuFallbackCount,
}: {
  pool: PoolViewModel;
  isOpen: boolean;
  onToggle: () => void;
  topology: RuntimeTopologyViewModel;
  lookup: (registryId: string) => MemberLookups;
  onWarm?: (registryId: string, target?: VariantWarmTarget) => void;
  warming?: Set<string>;
  trafficSegments: TrafficSegment[];
  trafficTotal: number | null;
  lastSelected: string | null;
  residentCount: number;
  cpuFallbackCount: number;
}): ReactNode {
  return (
    <>
      <TableRow className="bg-card hover:bg-muted/40">
        {/* expand chevron */}
        <TableCell className="w-8">
          <Button
            size="xs"
            onClick={onToggle}
            aria-expanded={isOpen}
            aria-label={isOpen ? "收起服务池成员" : "展开服务池成员"}
            title={isOpen ? "收起" : "展开"}
            className="px-1"
          >
            <Icon name={isOpen ? "chevDown" : "chevRight"} size={12} />
          </Button>
        </TableCell>

        {/* 服务池 name + key */}
        <TableCell>
          <div className="flex flex-col gap-0.5">
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-semibold">{pool.name}</span>
              {!pool.enabled && <Badge variant="outline">已停用</Badge>}
            </div>
            <span className="mono text-2xs text-muted-foreground" title={pool.id}>
              {pool.id.slice(0, 8)} · {pool.routing_policy}
            </span>
          </div>
        </TableCell>

        {/* 可用性 */}
        <TableCell>
          <div className="flex flex-col gap-1">
            <RuntimeStatusBadge axis="health" value={pool.status} />
            <span className="text-2xs text-muted-foreground">
              可路由 {pool.availability.routable}/{pool.availability.total}
              {pool.availability.draining > 0 &&
                ` · draining ${pool.availability.draining}`}
              {pool.availability.offline > 0 &&
                ` · offline ${pool.availability.offline}`}
            </span>
          </div>
        </TableCell>

        {/* 流量 */}
        <TableCell>
          <div className="flex flex-col gap-0.5">
            <TrafficDistributionBar segments={trafficSegments} total={trafficTotal} />
            <span className="text-2xs text-muted-foreground">
              最近选择 {lastSelected ?? "—"}
            </span>
          </div>
        </TableCell>

        {/* 容量 */}
        <TableCell>
          <div className="flex flex-col gap-0.5 text-xs">
            <span>
              inflight{" "}
              {pool.capacity.inflight == null ? NO_METRICS_LABEL : pool.capacity.inflight}
              <span className="text-muted-foreground">
                {" / "}
                {pool.capacity.limit == null ? "未声明" : pool.capacity.limit}
              </span>
            </span>
            {pool.capacity.saturated && (
              <span title="至少一个成员熔断">
                <Badge variant="danger">饱和</Badge>
              </span>
            )}
            <span className="text-2xs text-muted-foreground">GPU 队列 —</span>
          </div>
        </TableCell>

        {/* 质量 */}
        <TableCell>
          <span className="text-xs text-muted-foreground" title="v0.23.4 未接入路由计数器">
            {NO_METRICS_LABEL}
          </span>
        </TableCell>

        {/* 资源 */}
        <TableCell>
          <div className="flex flex-col gap-0.5 text-2xs text-muted-foreground">
            <span>驻留实例 {residentCount}</span>
            <span>CPU 回退 {cpuFallbackCount}</span>
          </div>
        </TableCell>

        {/* 新鲜度 */}
        <TableCell>
          <FreshnessSummary sources={topology.sources} />
        </TableCell>
      </TableRow>

      {isOpen &&
        pool.members.map((member) => {
          const { backend, observe, projectId } = lookup(member.registry_id);
          return (
            <BackendInstanceRow
              key={member.registry_id}
              pool={pool}
              member={member}
              topology={topology}
              backend={backend}
              observe={observe}
              projectId={projectId}
              onWarm={
                onWarm
                  ? (target) => onWarm(member.registry_id, target)
                  : undefined
              }
              isWarming={warming?.has(member.registry_id) ?? false}
            />
          );
        })}

      {isOpen && pool.members.length === 0 && (
        <TableRow>
          <TableCell colSpan={POOL_COL_SPAN} className="text-xs text-muted-foreground">
            该服务池暂无成员实例
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

function FreshnessSummary({ sources }: { sources: FreshnessViewModel[] }): ReactNode {
  if (sources.length === 0) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  return (
    <div className="flex max-w-[220px] flex-wrap gap-1">
      {sources.slice(0, 4).map((s) => (
        <FreshnessIndicator key={s.name} source={s} />
      ))}
    </div>
  );
}

// Avoid an extra module load per member in the count path. Mirrors
// isCpuFallback from @/utils/mlBackendCompute but kept local to the table
// so the count loop doesn't allocate closures through that module's API.
function isCpuFallbackInline(
  compute: import("@/utils/mlBackendCompute").MLBackendCompute | null | undefined,
): boolean {
  if (!compute || compute.cpu_fallback_supported === false) return false;
  const norm = (v: string | undefined | null) =>
    v?.trim().toLowerCase() ?? "";
  const configured = norm(compute.configured_device);
  const configuredForGpu =
    configured === "gpu" ||
    configured === "cuda" ||
    configured.startsWith("cuda:");
  if (!configuredForGpu) return false;
  return (
    norm(compute.effective_device) === "cpu" ||
    norm(compute.effective_provider) === "cpuexecutionprovider"
  );
}
