/**
 * v0.23.4 · service-pool runtime overview.
 *
 * Pools render as scan-friendly summaries instead of a wide table: identity and
 * health stay in the header, the four operator signals share one compact band,
 * and member operations remain behind progressive disclosure.
 */
import { useState, type ReactNode } from "react";
import {
  ChevronDown,
  ChevronRight,
  Cpu,
  Gauge,
  Server,
  Signal,
  Waypoints,
  type LucideIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/shadcn/ui/empty";
import { cn } from "@/lib/utils";
import type { GlobalBackendItem, ObserveTarget } from "@/api/adminMlIntegrations";
import {
  NO_METRICS_LABEL,
  type FreshnessViewModel,
  type PoolViewModel,
  type RuntimeTopologyViewModel,
} from "../runtimeTopology";
import { RuntimeStatusBadge } from "./RuntimeStatusBadge";
import { TrafficDistributionBar, type TrafficSegment } from "./TrafficDistributionBar";
import { BackendInstanceRow } from "./BackendInstanceRow";
import type { VariantWarmTarget } from "../VariantPanel";
import { isActiveResidency, isFreshCachedHealth } from "./parseResidency";

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
  onWarm?: (registryId: string, target?: VariantWarmTarget) => void;
  /** Set of registry_ids currently warming (disables warmup buttons). */
  warming?: Set<string>;
}

export function ServicePoolRuntimeTable({
  topology,
  lookup,
  onWarm,
  warming,
}: ServicePoolRuntimeTableProps): ReactNode {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  const toggle = (poolId: string) => {
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(poolId)) next.delete(poolId);
      else next.add(poolId);
      return next;
    });
  };

  if (topology.pools.length === 0) {
    return (
      <Empty className="border border-border bg-muted/20">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Server strokeWidth={1.6} aria-hidden="true" />
          </EmptyMedia>
          <EmptyTitle>暂无服务池</EmptyTitle>
          <EmptyDescription>
            在“注册管理”新建服务池并加入实例后，运行时状态会显示在这里。
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <section className="grid gap-3 xl:grid-cols-2" aria-label="服务池运行时列表">
      {topology.pools.map((pool) => {
        const isOpen = expanded.has(pool.id);
        const residentCount = pool.members.filter((member) => {
          const { backend, observe } = lookup(member.registry_id);
          const hasDirectResidency = observe?.residency != null;
          const residency = hasDirectResidency
            ? observe.residency
            : backend?.health_meta?.residency;
          const trusted = hasDirectResidency
            ? observe?.ok === true
            : backend != null && isFreshCachedHealth(backend.state, backend.last_checked_at);
          return isActiveResidency(residency, trusted);
        }).length;
        const cpuFallbackCount = pool.members.filter((member) => {
          const { backend, observe } = lookup(member.registry_id);
          const compute = observe?.compute ?? backend?.health_meta?.compute ?? null;
          return isCpuFallbackInline(compute);
        }).length;
        const trafficSegments: TrafficSegment[] = pool.members.map((member) => ({
          instance_id: member.registry_id,
          instance_name: member.name,
          count: member.runtime?.selection_count_window ?? null,
        }));
        const trafficTotal =
          pool.members.reduce(
            (sum, member) => sum + (member.runtime?.selection_count_window ?? 0),
            0,
          ) || null;
        const lastSelectedTimes = pool.members
          .map((member) => member.runtime?.last_selected_at ?? null)
          .filter((value): value is string => Boolean(value))
          .sort();

        return (
          <PoolRuntimeCard
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
            lastSelected={
              lastSelectedTimes.length > 0
                ? (lastSelectedTimes[lastSelectedTimes.length - 1] ?? null)
                : null
            }
            residentCount={residentCount}
            cpuFallbackCount={cpuFallbackCount}
          />
        );
      })}
    </section>
  );
}

function PoolRuntimeCard({
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
  const availabilityDetail = [
    pool.availability.draining > 0 ? `${pool.availability.draining} 个停流中` : null,
    pool.availability.offline > 0 ? `${pool.availability.offline} 个离线` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <article
      className={cn(
        "overflow-hidden rounded-xl border border-border bg-card transition-[background-color,border-color,box-shadow,transform] duration-200",
        isOpen
          ? "border-primary/30 shadow-sm xl:col-span-2"
          : "hover:-translate-y-px hover:border-primary/25 hover:shadow-sm",
      )}
    >
      <div className="flex flex-col gap-3 px-4 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <Button
              variant="ghost"
              size="xs"
              className="size-7 p-0"
              onClick={onToggle}
              aria-expanded={isOpen}
              aria-label={isOpen ? "收起服务池成员" : "展开服务池成员"}
              title={isOpen ? "收起" : "展开"}
            >
              {isOpen ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
            </Button>
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
              <Server className="size-4" strokeWidth={1.6} aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
                <h4 className="truncate text-sm font-semibold tracking-tight">{pool.name}</h4>
                {!pool.enabled && <Badge variant="outline">已停用</Badge>}
              </div>
              <div
                className="mt-0.5 truncate font-mono text-2xs text-muted-foreground"
                title={pool.id}
              >
                {pool.id.slice(0, 8)} · {pool.routing_policy}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-1.5">
            <RuntimeStatusBadge axis="health" value={pool.status} />
            <FreshnessSummary sources={topology.sources} />
          </div>
        </div>

        <div className={cn("grid gap-2 sm:grid-cols-2", isOpen && "xl:grid-cols-4")}>
          <PoolMetric
            icon={Signal}
            label="可用实例"
            value={`${pool.availability.routable} / ${pool.availability.total}`}
            detail={availabilityDetail || "全部实例可接流"}
          />
          <PoolMetric
            icon={Waypoints}
            label="流量窗口"
            value={<TrafficDistributionBar segments={trafficSegments} total={trafficTotal} />}
            detail={`最近选择 ${formatShortTime(lastSelected)}`}
          />
          <PoolMetric
            icon={Gauge}
            label="并发容量"
            value={
              <span className="tabular-nums">
                {pool.capacity.inflight ?? "—"}
                <span className="ml-1 text-xs font-normal text-muted-foreground">
                  / {pool.capacity.limit ?? "未声明"}
                </span>
              </span>
            }
            detail={
              pool.capacity.inflight == null
                ? NO_METRICS_LABEL
                : pool.capacity.saturated
                  ? "存在熔断成员"
                  : "当前 inflight"
            }
            tone={pool.capacity.saturated ? "danger" : "default"}
          />
          <PoolMetric
            icon={Cpu}
            label="运行资源"
            value={`${residentCount} 个驻留`}
            detail={cpuFallbackCount > 0 ? `${cpuFallbackCount} 个 CPU 回退` : "无 CPU 回退"}
            tone={cpuFallbackCount > 0 ? "warning" : "default"}
          />
        </div>

        {pool.status_reason_codes.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            <Badge variant={pool.status === "healthy" ? "outline" : "warning"}>状态依据</Badge>
            <span className="font-mono text-2xs">{pool.status_reason_codes.join(" · ")}</span>
          </div>
        )}
      </div>

      {isOpen && (
        <div className="border-t border-border bg-muted/15 px-3 pb-3 pt-3">
          <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2 px-1">
            <div className="text-xs font-semibold">实例明细</div>
            <div className="text-2xs text-muted-foreground">
              {pool.members.length} 个实例 · 权重与路由操作保持实时
            </div>
          </div>
          {pool.members.length > 0 ? (
            <div className="flex flex-col gap-2">
              {pool.members.map((member) => {
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
                    onWarm={onWarm ? (target) => onWarm(member.registry_id, target) : undefined}
                    isWarming={warming?.has(member.registry_id) ?? false}
                  />
                );
              })}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-border bg-background/70 px-4 py-6 text-center text-xs text-muted-foreground">
              该服务池暂无成员实例
            </div>
          )}
        </div>
      )}
    </article>
  );
}

function PoolMetric({
  icon: MetricIcon,
  label,
  value,
  detail,
  tone = "default",
}: {
  icon: LucideIcon;
  label: string;
  value: ReactNode;
  detail: string;
  tone?: "default" | "warning" | "danger";
}): ReactNode {
  return (
    <div className="flex min-w-0 gap-2.5 rounded-lg bg-muted/35 px-3 py-2.5">
      <MetricIcon
        className="mt-0.5 size-4 shrink-0 text-muted-foreground"
        strokeWidth={1.6}
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1">
        <div className="text-2xs font-medium text-muted-foreground">{label}</div>
        <div className="mt-1 truncate text-sm font-semibold tracking-tight">{value}</div>
        <div
          className={cn(
            "mt-0.5 truncate text-2xs",
            tone === "danger"
              ? "text-status-danger"
              : tone === "warning"
                ? "text-status-caution"
                : "text-muted-foreground",
          )}
          title={detail}
        >
          {detail}
        </div>
      </div>
    </div>
  );
}

function FreshnessSummary({ sources }: { sources: FreshnessViewModel[] }): ReactNode {
  if (sources.length === 0) {
    return <Badge variant="outline">新鲜度未知</Badge>;
  }
  const staleCount = sources.filter((source) => source.stale).length;
  const title = sources
    .map((source) => `${source.label}: ${source.stale ? "陈旧" : "新鲜"}`)
    .join("；");
  if (staleCount > 0) {
    return (
      <span title={title}>
        <Badge variant="warning">
          {sources.length - staleCount}/{sources.length} 新鲜
        </Badge>
      </span>
    );
  }
  return (
    <span title={title}>
      <Badge variant="success">数据新鲜</Badge>
    </span>
  );
}

function formatShortTime(iso: string | null): string {
  if (!iso) return "—";
  const timestamp = new Date(iso);
  if (Number.isNaN(timestamp.getTime())) return iso;
  return timestamp.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function isCpuFallbackInline(
  compute: import("@/utils/mlBackendCompute").MLBackendCompute | null | undefined,
): boolean {
  if (!compute || compute.cpu_fallback_supported === false) return false;
  const normalize = (value: string | undefined | null) => value?.trim().toLowerCase() ?? "";
  const configured = normalize(compute.configured_device);
  const configuredForGpu =
    configured === "gpu" || configured === "cuda" || configured.startsWith("cuda:");
  if (!configuredForGpu) return false;
  return (
    normalize(compute.effective_device) === "cpu" ||
    normalize(compute.effective_provider) === "cpuexecutionprovider"
  );
}
