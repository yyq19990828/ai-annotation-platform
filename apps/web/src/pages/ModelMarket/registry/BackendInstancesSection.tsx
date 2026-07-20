/**
 * v0.23.4 P3 · registry "实例" tab.
 *
 * Plan §6.1 (instance table spec): the table is for configuring and locating
 * physical endpoints. Main columns: name / owning pool / URL / source / traffic
 * state / weight / max concurrency / GPU claim / last checked / actions.
 *
 * Project Admin: weight, GPU claim and internal reason columns are hidden
 * (server-side projection already nulled them). Super Admin sees a
 * risk-ordered DropdownMenu (健康检查 / 编辑 / 暂停接流 / 恢复接流 / 卸载 / 删除)
 * and a "详情" button that opens a Sheet with raw error text / capability
 * snapshot / model pool / generation / full diagnostics — those heavy fields
 * are NOT in the main row (plan §10).
 *
 * Unload + Delete open an AlertDialog. Unload is additionally gated by the
 * server-side drain → quiescent → unload safety flow (plan §8.1); when the
 * instance is still routable we route the operator through drain first.
 */
import { useMemo, useState, type ReactNode } from "react";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { useToastStore } from "@/components/ui/Toast";
import { DropdownMenu, type DropdownItem } from "@/components/ui/DropdownMenu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/shadcn/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/shadcn/ui/alert-dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/shadcn/ui/sheet";
import { ScrollArea } from "@/components/shadcn/ui/scroll-area";

import type { GlobalBackendItem } from "@/api/adminMlIntegrations";
import {
  formatDateTime,
  gpuClaimOf,
  NO_LIMIT,
  registryStateToHealthAxis,
} from "./registryShared";
import { CopyableId, EmptyState, NullCell } from "./registryUi";
import type { RegistryFilters, RegistryScope } from "./registryTypes";
import type { MemberViewModel } from "../runtimeTopology";
import { RuntimeStatusBadge } from "../runtime/RuntimeStatusBadge";
import {
  GlobalBackendFormModal,
  type GlobalRegistryEditTarget,
} from "../GlobalBackendFormModal";
import {
  useDeleteRegistry,
  useDrainPoolMember,
  useRegistryHealth,
  useRegistryUnload,
  useResumePoolMember,
} from "../useGlobalRegistry";

interface DetailState {
  backend: GlobalBackendItem;
}

interface ConfirmState {
  kind: "unload" | "delete";
  backend: GlobalBackendItem;
}

export function BackendInstancesSection({
  scope,
  filters,
}: {
  scope: RegistryScope;
  filters: RegistryFilters;
}): ReactNode {
  const { isSuperAdmin, backends, vm } = scope;
  const [detail, setDetail] = useState<DetailState | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [editTarget, setEditTarget] = useState<GlobalRegistryEditTarget | null>(null);
  const [editOpen, setEditOpen] = useState(false);

  const registryToPool = useMemo(
    () => buildRegistryPoolLookup(scope),
    [scope],
  );

  const rows = useMemo(() => {
    return backends.filter((b) => {
      if (filters.search) {
        const q = filters.search.toLowerCase();
        const hay = `${b.name} ${b.url} ${b.id} ${b.source_project_name ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (filters.statusFilter !== "all") {
        const axis = registryStateToHealthAxis(b.state);
        if (axis !== filters.statusFilter) return false;
      }
      return true;
    });
  }, [backends, filters.search, filters.statusFilter]);

  if (backends.length === 0) {
    return (
      <EmptyState
        icon="bot"
        message="尚无注册实例"
        hint={isSuperAdmin ? "点击页头「注册实例」添加。" : undefined}
      />
    );
  }

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>实例名称</TableHead>
            <TableHead>所属服务池</TableHead>
            <TableHead>URL</TableHead>
            <TableHead>来源</TableHead>
            <TableHead>接流状态</TableHead>
            {isSuperAdmin && <TableHead>权重</TableHead>}
            <TableHead>最大并发</TableHead>
            {isSuperAdmin && <TableHead>GPU claim</TableHead>}
            <TableHead>最近检查</TableHead>
            <TableHead className="text-right">操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((b) => (
            <InstanceRow
              key={b.id}
              backend={b}
              scope={scope}
              poolInfo={registryToPool.get(b.id) ?? null}
              onOpenDetail={(backend) => setDetail({ backend })}
              onConfirm={setConfirm}
              onEdit={(target) => {
                setEditTarget(target);
                setEditOpen(true);
              }}
            />
          ))}
          {rows.length === 0 && (
            <TableRow>
              <TableCell colSpan={isSuperAdmin ? 10 : 7}>
                <div className="p-6 text-center text-sm text-muted-foreground">
                  没有匹配的实例
                </div>
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      <InstanceDetailSheet detail={detail} onClose={() => setDetail(null)} />

      <InstanceConfirmDialog
        confirm={confirm}
        scope={scope}
        onClose={() => setConfirm(null)}
      />

      <GlobalBackendFormModal
        open={editOpen}
        backend={editTarget}
        onClose={() => setEditOpen(false)}
      />
    </>
  );
}

function InstanceRow({
  backend,
  scope,
  poolInfo,
  onOpenDetail,
  onConfirm,
  onEdit,
}: {
  backend: GlobalBackendItem;
  scope: RegistryScope;
  poolInfo: { poolId: string; poolName: string; member: MemberViewModel | null } | null;
  onOpenDetail: (b: GlobalBackendItem) => void;
  onConfirm: (s: ConfirmState) => void;
  onEdit: (target: GlobalRegistryEditTarget) => void;
}): ReactNode {
  const { isSuperAdmin } = scope;
  const member = poolInfo?.member ?? null;
  const trafficState = member?.traffic_state ?? null;

  return (
    <TableRow>
      <TableCell>
        <div className="flex flex-col gap-0.5">
          <span className="max-w-[180px] truncate font-medium" title={backend.name}>
            {backend.name}
          </span>
          <CopyableId value={backend.id} label="实例 ID" />
        </div>
      </TableCell>
      <TableCell>
        {poolInfo?.poolId ? (
          <div className="flex flex-col gap-0.5">
            <span className="text-sm">{poolInfo.poolName}</span>
            <span className="text-2xs text-muted-foreground">{poolInfo.poolId}</span>
          </div>
        ) : (
          <NullCell>未纳管</NullCell>
        )}
      </TableCell>
      <TableCell>
        <span className="mono max-w-[240px] truncate text-xs text-muted-foreground" title={backend.url}>
          {backend.url}
        </span>
      </TableCell>
      <TableCell>
        <Badge variant="outline">{backend.source_project_name || "env"}</Badge>
      </TableCell>
      <TableCell>
        <TrafficStateCell
          axis={registryStateToHealthAxis(backend.state)}
          trafficState={trafficState}
          routing={member?.routing ?? "unknown"}
        />
      </TableCell>
      {isSuperAdmin && (
        <TableCell>
          {member?.weight != null ? (
            <span className="text-sm">{member.weight}</span>
          ) : (
            <NullCell>—</NullCell>
          )}
        </TableCell>
      )}
      <TableCell>
        {typeof backend.extra_params?.max_concurrency === "number" ? (
          <span className="text-sm">{backend.extra_params.max_concurrency}</span>
        ) : (
          <NullCell>{NO_LIMIT}</NullCell>
        )}
      </TableCell>
      {isSuperAdmin && (
        <TableCell>
          <GpuClaimCell backend={backend} />
        </TableCell>
      )}
      <TableCell>
        <span className="text-xs text-muted-foreground">
          {formatDateTime(backend.last_checked_at)}
        </span>
      </TableCell>
      <TableCell className="text-right">
        <div className="flex items-center justify-end gap-1.5">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onOpenDetail(backend)}
            title="详情"
          >
            <Icon name="info" size={11} />
            详情
          </Button>
          {isSuperAdmin && (
            <InstanceActionsMenu
              backend={backend}
              poolInfo={poolInfo}
              onConfirm={onConfirm}
              onEdit={onEdit}
            />
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}

function TrafficStateCell({
  axis,
  trafficState,
  routing,
}: {
  axis: "healthy" | "degraded" | "offline" | "unknown";
  trafficState: MemberViewModel["traffic_state"] | null;
  routing: MemberViewModel["routing"];
}): ReactNode {
  return (
    <div className="flex flex-col gap-1">
      <RuntimeStatusBadge axis="health" value={axis} />
      {trafficState && (
        <Badge variant="outline" className="w-fit text-2xs">
          接流 · {trafficStateLabel(trafficState)}
        </Badge>
      )}
      <RuntimeStatusBadge axis="routing" value={routing} prefix="路由" />
    </div>
  );
}

function GpuClaimCell({ backend }: { backend: GlobalBackendItem }): ReactNode {
  const claim = gpuClaimOf(backend);
  const gpuConfig = backend.gpu_config;
  if (!claim) {
    return <NullCell>无 GPU 声明</NullCell>;
  }
  return (
    <div className="flex flex-col gap-0.5">
      <span className="mono text-xs" title={claim.gpu_resource_id}>
        {claim.gpu_resource_id}
      </span>
      <span className="text-2xs text-muted-foreground">
        {claim.vram_budget_mb}
        {gpuConfig?.allocatable_mb ? ` / ${gpuConfig.allocatable_mb}` : ""} MiB
      </span>
    </div>
  );
}

function InstanceActionsMenu({
  backend,
  poolInfo,
  onConfirm,
  onEdit,
}: {
  backend: GlobalBackendItem;
  poolInfo: { poolId: string; poolName: string; member: MemberViewModel | null } | null;
  onConfirm: (s: ConfirmState) => void;
  onEdit: (target: GlobalRegistryEditTarget) => void;
}): ReactNode {
  const pushToast = useToastStore((s) => s.push);
  const health = useRegistryHealth();
  const drain = useDrainPoolMember();
  const resume = useResumePoolMember();

  const poolId = poolInfo?.poolId ?? null;
  const member = poolInfo?.member ?? null;

  const onHealth = () => {
    health.mutate(backend.id, {
      onSuccess: (res) =>
        pushToast({
          msg:
            res.status === "ok"
              ? `「${res.backend_name}」健康检查通过`
              : `「${res.backend_name}」检查失败`,
          kind: res.status === "ok" ? "success" : "warning",
        }),
      onError: (e) =>
        pushToast({ msg: "健康检查失败", sub: (e as Error).message, kind: "warning" }),
    });
  };

  const onEditClick = () => {
    onEdit({
      id: backend.id,
      name: backend.name,
      url: backend.url,
      auth_method: backend.auth_method,
      gpu_resource_id: backend.gpu_resource_id,
      vram_budget_mb: backend.vram_budget_mb,
      eviction_priority: backend.eviction_priority ?? 0,
    });
  };

  const onDrain = () => {
    if (!poolId) {
      pushToast({ msg: "实例未纳管到服务池，无法停流", kind: "warning" });
      return;
    }
    drain.mutate(
      { poolId, registryId: backend.id },
      {
        onSuccess: () =>
          pushToast({ msg: `已对「${backend.name}」发起停流`, kind: "success" }),
        onError: (e) =>
          pushToast({ msg: "停流失败", sub: (e as Error).message, kind: "warning" }),
      },
    );
  };

  const onResume = () => {
    if (!poolId) {
      pushToast({ msg: "实例未纳管到服务池，无法恢复", kind: "warning" });
      return;
    }
    resume.mutate(
      { poolId, registryId: backend.id },
      {
        onSuccess: () =>
          pushToast({ msg: `已恢复「${backend.name}」接流`, kind: "success" }),
        onError: (e) =>
          pushToast({ msg: "恢复接流失败", sub: (e as Error).message, kind: "warning" }),
      },
    );
  };

  const memberTraffic = member?.traffic_state ?? null;
  const items: DropdownItem[] = [
    {
      id: "health",
      label: "健康检查",
      icon: "activity",
      disabled: health.isPending,
      onSelect: onHealth,
    },
    {
      id: "edit",
      label: "编辑",
      icon: "edit",
      onSelect: onEditClick,
    },
    { id: "div-1", divider: true, label: "" },
    {
      id: "drain",
      label: "暂停接流",
      icon: "pause",
      disabled: !poolId || memberTraffic !== "active" || drain.isPending,
      onSelect: onDrain,
    },
    {
      id: "resume",
      label: "恢复接流",
      icon: "play",
      disabled: !poolId || memberTraffic !== "draining" || resume.isPending,
      onSelect: onResume,
    },
    { id: "div-2", divider: true, label: "" },
    {
      id: "unload",
      label: "卸载",
      icon: "box",
      onSelect: () => onConfirm({ kind: "unload", backend }),
    },
    {
      id: "delete",
      label: "删除",
      icon: "trash",
      onSelect: () => onConfirm({ kind: "delete", backend }),
    },
  ];

  return (
    <DropdownMenu
      minWidth={180}
      items={items}
      trigger={({ open, toggle, ref }) => (
        <Button
          ref={ref as never}
          size="sm"
          variant="ghost"
          onClick={(e) => {
            e.stopPropagation();
            toggle();
          }}
          aria-haspopup="menu"
          aria-expanded={open}
          title="实例操作"
        >
          <Icon name="more" size={11} />
        </Button>
      )}
    />
  );
}

function InstanceConfirmDialog({
  confirm,
  scope,
  onClose,
}: {
  confirm: ConfirmState | null;
  scope: RegistryScope;
  onClose: () => void;
}): ReactNode {
  const pushToast = useToastStore((s) => s.push);
  const del = useDeleteRegistry();
  const unload = useRegistryUnload();

  if (!confirm) return null;
  const { kind, backend } = confirm;
  const member = findMemberByRegistry(scope, backend.id);
  // Unload gate (plan §8.1): routable members must drain first. We surface this
  // in the dialog body; the operator can still force-confirm, in which case the
  // server-side gate will reject if it disagrees.
  const unloadBlocked = kind === "unload" && member?.routing === "routable";

  const onConfirm = () => {
    if (kind === "delete") {
      del.mutate(backend.id, {
        onSuccess: () => {
          pushToast({ msg: `已删除「${backend.name}」`, kind: "success" });
          onClose();
        },
        onError: (e) => {
          const err = e as { status?: number; message?: string };
          pushToast({
            msg: err.status === 409 ? "存在运行中的预标任务，无法删除" : "删除失败",
            sub: err.status === 409 ? err.message : (e as Error).message,
            kind: "warning",
          });
          onClose();
        },
      });
    } else {
      unload.mutate(backend.id, {
        onSuccess: () => {
          pushToast({ msg: `已对「${backend.name}」发起卸载`, kind: "success" });
          onClose();
        },
        onError: (e) =>
          pushToast({ msg: "卸载失败", sub: (e as Error).message, kind: "warning" }),
      });
    }
  };

  const submitting = del.isPending || unload.isPending;

  return (
    <AlertDialog
      open={!!confirm}
      onOpenChange={(open) => {
        if (!open && !submitting) onClose();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {kind === "delete" ? "删除实例" : "卸载实例"}
            「{backend.name}」
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="flex flex-col gap-2 text-sm text-foreground">
              {kind === "delete" ? (
                <p>
                  确认删除实例？此操作不可撤销，且仅在没有运行中预标任务时可成功。删除前请先解除服务池成员关系。
                </p>
              ) : (
                <>
                  <p>卸载将触发 GPU 模型驻留回收（residence draining），不影响路由接流。</p>
                  {unloadBlocked && (
                    <div className="flex items-start gap-1.5 rounded-md border border-status-caution bg-status-caution-soft px-2.5 py-2 text-xs text-status-caution">
                      <Icon name="warning" size={12} className="mt-0.5 flex-shrink-0" />
                      <span>实例仍在接流（routable）。建议先 drain 停止接收新请求，再卸载 GPU 驻留。</span>
                    </div>
                  )}
                </>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={submitting}>取消</AlertDialogCancel>
          <AlertDialogAction
            variant={kind === "delete" ? "destructive" : "default"}
            disabled={submitting}
            onClick={(e) => {
              e.preventDefault();
              onConfirm();
            }}
          >
            {submitting
              ? kind === "delete"
                ? "删除中..."
                : "卸载中..."
              : kind === "delete"
                ? "确认删除"
                : "确认卸载"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function InstanceDetailSheet({
  detail,
  onClose,
}: {
  detail: DetailState | null;
  onClose: () => void;
}): ReactNode {
  return (
    <Sheet open={!!detail} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-[min(560px,100vw)] sm:max-w-[560px]">
        <SheetHeader>
          <SheetTitle>{detail?.backend.name ?? ""}</SheetTitle>
          <SheetDescription>实例原始调试字段（错误文本 / 能力快照 / 模型池 / 诊断）</SheetDescription>
        </SheetHeader>
        {detail && <DetailBody backend={detail.backend} />}
      </SheetContent>
    </Sheet>
  );
}

function DetailBody({ backend }: { backend: GlobalBackendItem }): ReactNode {
  const gpuConfig = backend.gpu_config;
  return (
    <ScrollArea className="h-[calc(100vh-8rem)]">
      <div className="flex flex-col gap-4 px-4 pb-8 text-sm">
        <DetailSection title="基本">
          <DetailRow label="实例 ID">
            <CopyableId value={backend.id} />
          </DetailRow>
          <DetailRow label="URL">
            <span className="mono text-xs">{backend.url}</span>
          </DetailRow>
          <DetailRow label="状态">
            <Badge variant="outline">{backend.state}</Badge>
          </DetailRow>
          <DetailRow label="来源">
            <span>{backend.source_project_name || "—"}</span>
          </DetailRow>
          <DetailRow label="最近检查">
            <span className="text-xs text-muted-foreground">
              {formatDateTime(backend.last_checked_at)}
            </span>
          </DetailRow>
        </DetailSection>

        {gpuConfig && (
          <DetailSection title="GPU 仲裁">
            <DetailRow label="资源">
              <span className="mono text-xs">{backend.gpu_resource_id || "无声明"}</span>
            </DetailRow>
            <DetailRow label="静态预算">
              <span className="text-xs">
                {backend.vram_budget_mb ?? "—"} / {gpuConfig.allocatable_mb ?? "—"} MiB
              </span>
            </DetailRow>
            <DetailRow label="desired → effective">
              <span className="text-xs">
                {gpuConfig.desired_mode ?? "off"} → {gpuConfig.effective_mode ?? "off"}
              </span>
            </DetailRow>
            {gpuConfig.rollout_state && (
              <DetailRow label="rollout">
                <Badge variant="outline" className="text-2xs">
                  {gpuConfig.rollout_state}
                </Badge>
              </DetailRow>
            )}
          </DetailSection>
        )}

        {gpuConfig?.diagnostics && gpuConfig.diagnostics.length > 0 && (
          <DetailSection title="GPU 诊断">
            <ul className="m-0 flex list-none flex-col gap-1 p-0 text-xs">
              {gpuConfig.diagnostics.map((d, i) => (
                <li key={`${d.code}-${i}`} className="flex items-start gap-1.5">
                  <Badge
                    variant={
                      d.level === "critical" || d.level === "blocker"
                        ? "danger"
                        : d.level === "warning"
                          ? "warning"
                          : "outline"
                    }
                    className="text-2xs"
                  >
                    {d.level}
                  </Badge>
                  <span>{d.message}</span>
                </li>
              ))}
            </ul>
          </DetailSection>
        )}

        {backend.health_meta && (
          <DetailSection title="健康自报">
            {backend.health_meta.model_version && (
              <DetailRow label="model_version">
                <span className="mono text-xs">{backend.health_meta.model_version}</span>
              </DetailRow>
            )}
            {backend.health_meta.capabilities && (
              <DetailRow label="能力">
                <div className="flex flex-wrap gap-1">
                  {backend.health_meta.capabilities.modalities.map((m) => (
                    <Badge key={m} variant="ai" className="text-2xs">
                      {m}
                    </Badge>
                  ))}
                </div>
              </DetailRow>
            )}
            {backend.health_meta.compute && (
              <DetailRow label="compute">
                <span className="text-xs text-muted-foreground">
                  {backend.health_meta.compute.effective_device ??
                    backend.health_meta.compute.configured_device ??
                    "—"}
                  {backend.health_meta.compute.effective_provider
                    ? ` · ${backend.health_meta.compute.effective_provider}`
                    : ""}
                </span>
              </DetailRow>
            )}
          </DetailSection>
        )}
      </div>
    </ScrollArea>
  );
}

function DetailSection({ title, children }: { title: string; children: ReactNode }): ReactNode {
  return (
    <section className="flex flex-col gap-2">
      <h4 className="m-0 text-xs font-semibold text-muted-foreground">{title}</h4>
      <div className="flex flex-col gap-1.5">{children}</div>
    </section>
  );
}

function DetailRow({ label, children }: { label: string; children: ReactNode }): ReactNode {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="w-24 flex-shrink-0 text-2xs text-muted-foreground">{label}</span>
      <div className="min-w-0 flex-1 text-right">{children}</div>
    </div>
  );
}

// ── helpers ──────────────────────────────────────────────────────────────────

function buildRegistryPoolLookup(
  scope: RegistryScope,
): Map<string, { poolId: string; poolName: string; member: MemberViewModel | null }> {
  const out = new Map<string, { poolId: string; poolName: string; member: MemberViewModel | null }>();
  for (const pool of scope.vm.pools) {
    for (const member of pool.members) {
      out.set(member.registry_id, { poolId: pool.id, poolName: pool.name, member });
    }
  }
  return out;
}

function findMemberByRegistry(
  scope: RegistryScope,
  registryId: string,
): MemberViewModel | null {
  for (const pool of scope.vm.pools) {
    for (const member of pool.members) {
      if (member.registry_id === registryId) return member;
    }
  }
  return null;
}

function trafficStateLabel(state: MemberViewModel["traffic_state"]): string {
  switch (state) {
    case "active":
      return "接流";
    case "draining":
      return "停流中";
    case "disabled":
      return "已禁用";
    default:
      return state;
  }
}
