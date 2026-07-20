/**
 * v0.23.4 · lifecycle action cluster for a pool member.
 *
 * Plan §8.1: drain → quiescent → unload is the only safe unload path. This
 * component owns the state gates so a routable / inflight-bearing / stale
 * instance can never be one-click unloaded. Force-unload (when the contract
 * ever supports it) is a separate high-risk `AlertDialog`, NOT the default.
 *
 * Mutations are wired through existing hooks (registry health/unload,
 * project-scoped warmup) plus the v0.23.3 pool-member drain/resume contract.
 * All success paths invalidate topology + runtime-snapshot + observe so the
 * caller's three queries refresh together.
 */
import type { ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { adminMlIntegrationsApi } from "@/api/adminMlIntegrations";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { useToastStore } from "@/components/ui/Toast";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/shadcn/ui/tooltip";
import { useRegistryHealth, useRegistryUnload } from "../useGlobalRegistry";
import {
  evaluateUnloadGate,
  type MemberViewModel,
  type RuntimeTopologyViewModel,
} from "../runtimeTopology";

export interface LifecycleActionsProps {
  poolId: string;
  member: MemberViewModel;
  /**
   * View model — supplies `router_mode` + the router_ledger freshness used by
   * the unload gate. Null when runtime snapshot is unavailable (Project Admin
   * or load failure) — in that case unload is gated (can't prove quiescent).
   */
  topology: RuntimeTopologyViewModel | null;
  /** Project id for warmup; null/undefined when no project binding exists. */
  projectId?: string | null;
  /** Compact mode for table rows (icon-only buttons). */
  compact?: boolean;
}

/** Whether the backend contract ships a force-unload endpoint (v0.23.3: no). */
export const FORCE_UNLOAD_CONTRACT_AVAILABLE = false;

function ledgerFreshFromTopology(
  topology: RuntimeTopologyViewModel | null,
): boolean {
  if (!topology) return false;
  const ledger = topology.sources.find((s) => s.name === "router_ledger");
  // No router_ledger source at all → off mode is fine (no inflight claim);
  // otherwise trust its `stale` flag.
  if (!ledger) return topology.router_mode === "off";
  return !ledger.stale;
}

export function LifecycleActions({
  poolId,
  member,
  topology,
  projectId,
  compact = false,
}: LifecycleActionsProps): ReactNode {
  const pushToast = useToastStore((s) => s.push);
  const qc = useQueryClient();
  const health = useRegistryHealth();
  const unload = useRegistryUnload();

  const routerMode = topology?.router_mode ?? "off";
  const ledgerFresh = ledgerFreshFromTopology(topology);
  const gate = evaluateUnloadGate(member, routerMode, ledgerFresh);

  const drain = useMutation({
    mutationFn: () =>
      adminMlIntegrationsApi.drainPoolMember(poolId, member.registry_id),
    onSuccess: () => {
      invalidateRuntimeQueries(qc);
      pushToast({
        msg: `${member.name} 已停止接流（draining）`,
        kind: "success",
      });
    },
    onError: (e) =>
      pushToast({ msg: "停流失败", sub: (e as Error).message, kind: "error" }),
  });

  const resume = useMutation({
    mutationFn: () =>
      adminMlIntegrationsApi.resumePoolMember(poolId, member.registry_id),
    onSuccess: () => {
      invalidateRuntimeQueries(qc);
      pushToast({ msg: `${member.name} 已恢复接流（active）`, kind: "success" });
    },
    onError: (e) =>
      pushToast({
        msg: "恢复接流失败",
        sub: (e as Error).message,
        kind: "error",
      }),
  });

  // Safe-path unload (the only unload contract v0.23.3 ships). Gated by
  // evaluateUnloadGate; the surrounding tooltip surfaces the reasons.
  const onUnload = () => {
    unload.mutate(member.registry_id, {
      onSuccess: (res) =>
        pushToast({
          msg: res.unloaded
            ? `${member.name} 已接受卸载请求，等待 residency 确认`
            : `${member.name} 未报告需要卸载`,
          kind: "success",
        }),
      onError: (e) =>
        pushToast({ msg: "卸载失败", sub: (e as Error).message, kind: "error" }),
    });
  };

  const onHealth = () => {
    health.mutate(member.registry_id, {
      onSuccess: (res) =>
        pushToast({
          msg: `${member.name}: ${res.status}`,
          kind: res.status === "ok" ? "success" : "warning",
        }),
      onError: (e) =>
        pushToast({
          msg: "健康检查失败",
          sub: (e as Error).message,
          kind: "error",
        }),
    });
  };

  const drainShadow =
    routerMode !== "enforce" && member.traffic_state === "active";
  const drainLabel = drainShadow ? "停流（预配置）" : "停流";
  const drainTip = drainShadow
    ? `router_mode=${routerMode}，drain 仅预配置未实际停流`
    : "停止接收新请求（active → draining）";
  const unloadTip = gate.can_unload
    ? "实例已 quiescent，可安全发起卸载"
    : `不可卸载：${gate.reasons.join("；")}`;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {member.traffic_state === "active" && (
        <TooltipProvider delayDuration={200}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size={compact ? "xs" : "xs"}
                onClick={() => drain.mutate()}
                disabled={drain.isPending}
              >
                <Icon name="pause" size={10} />
                {drainLabel}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">{drainTip}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
      {member.traffic_state === "draining" && (
        <Button
          size="xs"
          onClick={() => resume.mutate()}
          disabled={resume.isPending}
          title="恢复接流（draining → active）"
        >
          <Icon name="play" size={10} />
          恢复接流
        </Button>
      )}
      {member.traffic_state === "draining" && drainShadow && (
        <span title={drainTip}>
          <Badge variant="warning">预配置</Badge>
        </span>
      )}

      <TooltipProvider delayDuration={200}>
        <Tooltip>
          <TooltipTrigger asChild>
            {/* span wraps the disabled button: Radix TooltipTrigger won't
                forward its ref onto a disabled <button>, so anchor on span. */}
            <span tabIndex={0} aria-label="卸载状态">
              <Button
                size="xs"
                onClick={onUnload}
                disabled={!gate.can_unload || unload.isPending}
              >
                <Icon name="pause" size={10} />
                卸载
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-xs whitespace-normal text-left">
            {unloadTip}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      <Button
        size="xs"
        onClick={onHealth}
        disabled={health.isPending}
        title="触发健康检查"
      >
        <Icon name="refresh" size={10} />
        健康检查
      </Button>

      {/* Warmup lives in the detail Sheet (variant picker is heavy); kept off
          the compact row to avoid duplicating the picker. projectId is still
          surfaced via the detail Sheet for the warm path. */}
      {!compact && projectId && (
        <span className="text-2xs text-muted-foreground" title="预热入口在详情 Sheet">
          可预热
        </span>
      )}

      {FORCE_UNLOAD_CONTRACT_AVAILABLE && null /* future AlertDialog hook */}
    </div>
  );
}

/** Invalidate the three runtime queries + legacy registry lists. */
export function invalidateRuntimeQueries(
  qc: ReturnType<typeof useQueryClient>,
): void {
  qc.invalidateQueries({ queryKey: ["admin", "ml-integrations", "topology"] });
  qc.invalidateQueries({
    queryKey: ["admin", "ml-integrations", "runtime-snapshot"],
  });
  qc.invalidateQueries({ queryKey: ["admin", "ml-integrations", "observe"] });
  // legacy registry list still consumed by other surfaces (wizard, etc.)
  qc.invalidateQueries({ queryKey: ["admin", "ml-integrations", "all"] });
  qc.invalidateQueries({ queryKey: ["admin", "ml-integrations", "overview"] });
}
