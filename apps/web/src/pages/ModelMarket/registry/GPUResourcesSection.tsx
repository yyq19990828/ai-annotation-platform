/**
 * v0.23.4 P3 · registry "GPU 资源" tab (Super Admin only).
 *
 * Plan §6.1 (GPUResources table spec): replace the previous big per-card view
 * with a structured table. Columns: 资源 (id + node); 静态预算 (allocatable_mb);
 * 已声明 (claimed_budget_mb, separate <Progress> for static oversell); 运行时
 * committed (runtime.committed_mb, SEPARATE <Progress> for runtime occupancy —
 * plan §6.1 mandates two bars, never merged); card/backend queue; lease count;
 * desired → effective mode; 最高诊断 (max severity diagnostic, links to Issue
 * Center). Rows expand to show affected instances cross-refed by gpu_resource_id.
 */
import { useState, type ReactNode } from "react";

import { Badge } from "@/components/ui/Badge";
import { Icon } from "@/components/ui/Icon";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/shadcn/ui/table";
import { Progress } from "@/components/shadcn/ui/progress";

import type {
  GPUArbiterResourceItem,
  GPUArbiterResourcesResponse,
} from "@/api/adminMlIntegrations";
import { CopyableId, EmptyState, NullCell } from "./registryUi";
import type { RegistryScope } from "./registryTypes";
import type { Diagnostic } from "../runtimeTopology";
import { DiagnosticBadge } from "../runtime/DiagnosticBadge";

type GpuStatus = GPUArbiterResourceItem["status"];

const GPU_STATUS_VARIANT: Record<GpuStatus, "success" | "accent" | "warning" | "danger"> = {
  ok: "success",
  info: "accent",
  warning: "warning",
  critical: "danger",
  blocker: "danger",
};

function gpuStatusLabel(s: GpuStatus): string {
  switch (s) {
    case "ok":
      return "正常";
    case "info":
      return "信息";
    case "warning":
      return "告警";
    case "critical":
      return "严重";
    case "blocker":
      return "阻断";
    default:
      return s;
  }
}

export function GPUResourcesSection({
  scope,
  summary,
}: {
  scope: RegistryScope;
  summary: GPUArbiterResourcesResponse | null;
}): ReactNode {
  const { gpuResources } = scope;
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (!gpuResources) {
    return (
      <EmptyState
        icon="activity"
        message="GPU 资源不可用"
        hint="仅超级管理员可见；若刚切换角色请刷新页面。"
      />
    );
  }

  if (gpuResources.length === 0) {
    return <EmptyState icon="activity" message="尚未配置 GPU_ARBITER_RESOURCES_JSON" />;
  }

  return (
    <div className="flex flex-col gap-3">
      {summary && <GPUResourceSummary summary={summary} />}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-8" />
            <TableHead>资源</TableHead>
            <TableHead>静态预算</TableHead>
            <TableHead>已声明（静态）</TableHead>
            <TableHead>运行时 committed</TableHead>
            <TableHead>队列</TableHead>
            <TableHead>Lease</TableHead>
            <TableHead>desired → effective</TableHead>
            <TableHead>最高诊断</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {gpuResources.map((resource) => (
            <GpuResourceRow
              key={resource.gpu_resource_id}
              resource={resource}
              scope={scope}
              expanded={expanded.has(resource.gpu_resource_id)}
              onToggle={() => toggle(resource.gpu_resource_id)}
            />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function GPUResourceSummary({ summary }: { summary: GPUArbiterResourcesResponse }): ReactNode {
  return (
    <div
      data-testid="gpu-resource-summary"
      className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-2"
    >
      <Badge variant={summary.runtime_ready ? "success" : "danger"}>
        <Icon name={summary.runtime_ready ? "checkCircle" : "alert-triangle"} size={11} />
        {summary.runtime_ready ? "运行时就绪" : "运行时未就绪"}
      </Badge>
      <span className="text-xs text-muted-foreground">全局期望模式</span>
      <Badge variant="outline">{summary.global_desired_mode}</Badge>
      <Badge variant={summary.observe_runtime_ready ? "success" : "warning"}>
        Observe {summary.observe_runtime_ready ? "就绪" : "未就绪"}
      </Badge>
      <Badge variant={summary.enforce_runtime_ready ? "success" : "warning"}>
        Enforce {summary.enforce_runtime_ready ? "就绪" : "未就绪"}
      </Badge>
      <Badge variant={summary.rollout_enabled ? "accent" : "outline"}>
        Rollout {summary.rollout_enabled ? "已启用" : "未启用"}
      </Badge>
    </div>
  );
}

function GpuResourceRow({
  resource,
  scope,
  expanded,
  onToggle,
}: {
  resource: GPUArbiterResourceItem;
  scope: RegistryScope;
  expanded: boolean;
  onToggle: () => void;
}): ReactNode {
  const allocatable = resource.allocatable_mb;
  const claimed = resource.claimed_budget_mb;
  const committed = resource.runtime?.committed_mb ?? null;
  const staticPct = allocatable > 0 ? (claimed / allocatable) * 100 : 0;
  const staticProgressPct = Math.min(100, staticPct);
  const runtimePct =
    committed != null && allocatable > 0 ? Math.min(100, (committed / allocatable) * 100) : null;
  const maxDiagnostic = pickMaxSeverityGpuDiagnostic(resource.gpu_resource_id, scope.diagnostics);
  const affectedInstances = collectAffectedInstances(resource.gpu_resource_id, scope);

  return (
    <>
      <TableRow aria-expanded={expanded} className={expanded ? "bg-muted/40" : undefined}>
        <TableCell className="align-middle">
          <button
            type="button"
            onClick={onToggle}
            aria-label={expanded ? "折叠受影响实例" : "展开受影响实例"}
            aria-expanded={expanded}
            className="inline-flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-accent"
          >
            <Icon name={expanded ? "chevDown" : "chevRight"} size={12} />
          </button>
        </TableCell>
        <TableCell>
          <div className="flex flex-col gap-0.5">
            <div className="flex items-center gap-2">
              <Badge variant={GPU_STATUS_VARIANT[resource.status]}>
                <Icon
                  name={resource.status === "ok" ? "checkCircle" : "alert-triangle"}
                  size={11}
                />
                <span>{gpuStatusLabel(resource.status)}</span>
              </Badge>
              <CopyableId value={resource.gpu_resource_id} label="GPU 资源 ID" />
            </div>
            <div className="flex items-center gap-2 text-2xs text-muted-foreground">
              <span>节点 · {resource.node_id}</span>
              <span className="mono">{resource.physical_device_token}</span>
            </div>
            <div className="text-2xs text-muted-foreground">
              配置 · {resource.configured_mode ?? "未配置"}
            </div>
          </div>
        </TableCell>
        <TableCell>
          <span className="mono text-xs">{allocatable.toLocaleString()} MiB</span>
        </TableCell>
        <TableCell>
          <div className="flex w-32 flex-col gap-1">
            <div className="flex items-center justify-between text-2xs text-muted-foreground">
              <span className="mono">{claimed.toLocaleString()} MiB</span>
              <span>{Math.round(staticPct)}%</span>
            </div>
            <Progress
              value={staticProgressPct}
              className={staticPct > 100 ? "bg-status-caution-soft" : undefined}
            />
            <span className="text-2xs text-muted-foreground">
              {resource.claimed_backend_count} 个 backend
            </span>
            {staticPct > 100 && <span className="text-2xs text-status-caution">弹性超售</span>}
          </div>
        </TableCell>
        <TableCell>
          {committed != null && runtimePct != null ? (
            <div className="flex w-32 flex-col gap-1">
              <div className="flex items-center justify-between text-2xs text-muted-foreground">
                <span className="mono">{committed.toLocaleString()} MiB</span>
                <span>{Math.round(runtimePct)}%</span>
              </div>
              {/* Separate bar from static — plan §6.1 mandates two. */}
              <Progress value={runtimePct} />
            </div>
          ) : (
            <NullCell>未上报</NullCell>
          )}
        </TableCell>
        <TableCell>
          <div className="flex flex-col gap-0.5 text-2xs text-muted-foreground">
            <span>card · {fmtQueue(resource.runtime?.card_queue_count)}</span>
            <span>backend · {fmtQueue(resource.runtime?.backend_queue_count)}</span>
          </div>
        </TableCell>
        <TableCell>
          {resource.runtime?.lease_count != null ? (
            <span className="text-sm">{resource.runtime.lease_count}</span>
          ) : (
            <NullCell>未上报</NullCell>
          )}
        </TableCell>
        <TableCell>
          <div className="flex flex-col gap-0.5">
            <Badge variant="outline" className="w-fit text-2xs">
              {resource.desired_mode}
            </Badge>
            <span className="text-2xs text-muted-foreground">→ {resource.effective_mode}</span>
          </div>
        </TableCell>
        <TableCell>
          {maxDiagnostic ? (
            <DiagnosticBadge diagnostic={maxDiagnostic} showAffected />
          ) : (
            <NullCell>无</NullCell>
          )}
        </TableCell>
      </TableRow>
      {expanded && (
        <TableRow className="bg-muted/20">
          <TableCell />
          <TableCell colSpan={8}>
            <AffectedInstancesSubRow
              gpuResourceId={resource.gpu_resource_id}
              instances={affectedInstances}
            />
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

function AffectedInstancesSubRow({
  gpuResourceId,
  instances,
}: {
  gpuResourceId: string;
  instances: Array<{ registry_id: string; name: string; pool_name: string }>;
}): ReactNode {
  if (instances.length === 0) {
    return (
      <div className="py-2 text-xs text-muted-foreground">
        GPU 资源 {gpuResourceId} 当前没有拓扑纳管的实例
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1 py-2">
      <div className="text-2xs text-muted-foreground">受影响实例（{instances.length}）</div>
      <ul className="m-0 flex list-none flex-col gap-1 p-0 text-xs">
        {instances.map((it) => (
          <li key={it.registry_id} className="flex items-center gap-2">
            <Icon name="bot" size={11} className="text-muted-foreground" />
            <span className="font-medium">{it.name}</span>
            <span className="text-2xs text-muted-foreground">服务池 · {it.pool_name}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── helpers ──────────────────────────────────────────────────────────────────

function fmtQueue(n: number | null | undefined): string {
  if (n == null) return "—";
  return String(n);
}

function pickMaxSeverityGpuDiagnostic(
  gpuResourceId: string,
  diagnostics: Diagnostic[],
): Diagnostic | null {
  const sevRank: Record<Diagnostic["severity"], number> = {
    info: 0,
    warning: 1,
    critical: 2,
    blocker: 3,
  };
  const related = diagnostics.filter((d) => d.affected_gpu_resource_ids.includes(gpuResourceId));
  if (related.length === 0) return null;
  return related.reduce((max, d) => (sevRank[d.severity] > sevRank[max.severity] ? d : max));
}

function collectAffectedInstances(
  gpuResourceId: string,
  scope: RegistryScope,
): Array<{ registry_id: string; name: string; pool_name: string }> {
  const out: Array<{ registry_id: string; name: string; pool_name: string }> = [];
  for (const pool of scope.vm.pools) {
    for (const member of pool.members) {
      if (member.gpu_resource_id === gpuResourceId) {
        out.push({
          registry_id: member.registry_id,
          name: member.name,
          pool_name: pool.name,
        });
      }
    }
  }
  return out;
}

// Re-export the queue formatter for callers that want consistent labels.
export const _gpuQueueLabel = fmtQueue;
