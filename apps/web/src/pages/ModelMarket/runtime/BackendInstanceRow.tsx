/**
 * v0.23.4 · one member row inside an expanded service-pool row (plan §6.2).
 *
 * Compact view: identity, weight, routing state, current/max concurrency,
 * window selection/rejection, P95/error-rate, last selected, residency
 * summary, and a "详情" button that opens the InstanceDetailSheet. Metrics
 * fields that are null in v0.23.4 render the "暂无路由指标" sentinel, never 0.
 */
import type { ReactNode } from "react";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/shadcn/ui/tooltip";
import { TableCell, TableRow } from "@/components/shadcn/ui/table";
import { isCpuFallback } from "@/utils/mlBackendCompute";
import type { GlobalBackendItem, ObserveTarget } from "@/api/adminMlIntegrations";
import {
  NO_METRICS_LABEL,
  type MemberViewModel,
  type PoolViewModel,
  type RuntimeTopologyViewModel,
} from "../runtimeTopology";
import { RuntimeStatusBadge } from "./RuntimeStatusBadge";
import { InstanceDetailSheet } from "./InstanceDetailSheet";
import { LifecycleActions } from "./LifecycleActions";
import { useState } from "react";

export interface BackendInstanceRowProps {
  pool: PoolViewModel;
  member: MemberViewModel;
  topology: RuntimeTopologyViewModel | null;
  /** Registry entry matched by registry_id (from /all). */
  backend: GlobalBackendItem | undefined;
  /** Direct-probe target matched by registry_id (from /observe). */
  observe: ObserveTarget | undefined;
  /** Project id for warmup path; undefined when no project binding. */
  projectId?: string | null;
  onWarm?: (target?: import("../VariantPanel").VariantWarmTarget) => void;
  isWarming?: boolean;
}

export function BackendInstanceRow({
  pool,
  member,
  topology,
  backend,
  observe,
  projectId,
  onWarm,
  isWarming,
}: BackendInstanceRowProps): ReactNode {
  const [detailOpen, setDetailOpen] = useState(false);
  const rt = member.runtime;
  const ok = observe?.ok ?? (backend?.state === "connected" ? true : false);
  const compute = observe?.compute ?? backend?.health_meta?.compute ?? null;
  const name = member.name;

  return (
    <TableRow className="bg-muted/20 hover:bg-muted/40">
      {/* 名称 / URL */}
      <TableCell className="max-w-[280px]">
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-1.5">
            <Badge variant={ok ? "success" : "danger"} dot>
              {ok ? "在线" : "离线"}
            </Badge>
            <span
              className="truncate text-xs font-medium"
              title={backend?.url ?? observe?.url}
            >
              {name}
            </span>
          </div>
          <span className="mono truncate text-2xs text-muted-foreground">
            {backend?.url ?? observe?.url ?? "—"}
          </span>
        </div>
      </TableCell>

      {/* 权重 */}
      <TableCell className="text-xs">
        {member.weight == null ? "—" : String(member.weight)}
      </TableCell>

      {/* 接流状态 */}
      <TableCell>
        <RuntimeStatusBadge axis="routing" value={member.routing} />
      </TableCell>

      {/* 当前/最大并发 */}
      <TableCell className="text-xs">
        <div className="flex flex-col">
          <span>{rt ? String(rt.route_inflight) : NO_METRICS_LABEL}</span>
          <span className="text-2xs text-muted-foreground">未声明</span>
        </div>
      </TableCell>

      {/* 窗口选择 / 拒绝 */}
      <TableCell className="text-xs">
        <div className="flex flex-col text-muted-foreground">
          <span className="text-foreground">
            {rt?.selection_count_window == null
              ? NO_METRICS_LABEL
              : String(rt.selection_count_window)}
          </span>
          <span className="text-2xs">
            拒绝{" "}
            {rt?.rejection_count_window == null
              ? NO_METRICS_LABEL
              : String(rt.rejection_count_window)}
          </span>
        </div>
      </TableCell>

      {/* P95 / 错误率 */}
      <TableCell className="text-xs">
        <div className="flex flex-col text-muted-foreground">
          <span className="text-foreground">
            {rt?.p95_ms == null ? NO_METRICS_LABEL : `${rt.p95_ms}ms`}
          </span>
          <span className="text-2xs">
            错误率{" "}
            {rt?.error_rate == null
              ? NO_METRICS_LABEL
              : `${(rt.error_rate * 100).toFixed(2)}%`}
          </span>
        </div>
      </TableCell>

      {/* 最近选中 */}
      <TableCell className="text-xs text-muted-foreground">
        {rt?.last_selected_at ?? "—"}
      </TableCell>

      {/* health/compute/GPU/residency summary */}
      <TableCell className="text-xs">
        <div className="flex flex-wrap items-center gap-1">
          <span title={backend?.last_checked_at ?? undefined}>
            <Badge variant={ok ? "success" : "danger"}>
              {ok ? "健康" : "不可达"}
            </Badge>
          </span>
          {isCpuFallback(compute) && (
            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge variant="warning">⚠ CPU</Badge>
                </TooltipTrigger>
                <TooltipContent side="top">
                  配置了 GPU 但已静默退回 CPU 推理
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
          {backend?.gpu_resource_id && (
            <Badge variant="outline" className="mono">
              {backend.gpu_resource_id}
            </Badge>
          )}
          {rt?.circuit_open && <Badge variant="danger">熔断</Badge>}
        </div>
      </TableCell>

      {/* 详情 + 生命周期 */}
      <TableCell>
        <div className="flex flex-wrap items-center gap-1">
          <Button size="xs" onClick={() => setDetailOpen(true)} title="查看实例详情">
            <Icon name="eye" size={10} />
            详情
          </Button>
          <LifecycleActions
            poolId={pool.id}
            member={member}
            topology={topology}
            projectId={projectId}
            compact
          />
        </div>
      </TableCell>

      <InstanceDetailSheet
        open={detailOpen}
        onOpenChange={setDetailOpen}
        member={member}
        pool={pool}
        topology={topology}
        backend={backend}
        observe={observe}
        projectId={projectId}
        onWarm={onWarm}
        isWarming={isWarming}
      />
    </TableRow>
  );
}
