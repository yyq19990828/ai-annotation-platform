import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { useToastStore } from "@/components/ui/Toast";
import { isCpuFallback, resolveRuntimeCompute } from "@/utils/mlBackendCompute";
import {
  adminMlIntegrationsApi,
  type GlobalBackendItem,
  type GpuInfo,
  type ObserveTarget,
  type SmokeTestRequest,
} from "@/api/adminMlIntegrations";
import {
  mlBackendsApi,
  type MLBackendCapability,
  type MLBackendVariant,
  type MLModelCapability,
  mlBackendSetupQueryKey,
} from "@/api/ml-backends";
import {
  useMLBackendReload,
  useMLBackendWarmup,
} from "@/hooks/useMLBackends";
import { VariantPanel, type VariantWarmTarget } from "./VariantPanel";
import { useRegistryHealth, useRegistryUnload } from "./useGlobalRegistry";

const CARD_CLASS =
  "flex flex-col gap-2.5 rounded-md border border-border bg-card p-3";
const CARD_TOP_CLASS = "flex flex-wrap items-center gap-2";
const URL_CLASS =
  "mono max-w-[520px] truncate text-xs text-muted-foreground";
const LATENCY_CLASS = "text-xs text-muted-foreground";
const NOTE_ERROR_CLASS = "text-xs text-status-danger";
const METRICS_CLASS =
  "flex flex-wrap items-center gap-3 text-xs text-muted-foreground";
const SELECT_CLASS =
  "max-w-[180px] appearance-none rounded-md border border-border bg-muted px-2 py-1 text-xs text-foreground";

interface RegisteredRef {
  projectId?: string;       // reload/warmup 仍需任一启用项目；health/unload 走全局 registry 路径。
  projectNames: string[];   // 启用了该 backend 的所有项目名 (去重聚合展示)
  backend: GlobalBackendItem;
  observe?: ObserveTarget;
}

function normalizeUrl(url: string) {
  return url.replace(/\/+$/, "");
}

export function RuntimeObservePanel() {
  const registryQ = useQuery({
    queryKey: ["admin", "ml-integrations", "all"],
    queryFn: () => adminMlIntegrationsApi.listAll(),
    refetchInterval: 60_000,
  });
  const overviewQ = useQuery({
    queryKey: ["admin", "ml-integrations", "overview"],
    queryFn: () => adminMlIntegrationsApi.overview(),
    refetchInterval: 60_000,
  });
  const observeQ = useQuery({
    queryKey: ["admin", "ml-integrations", "observe"],
    queryFn: () => adminMlIntegrationsApi.observe(),
    refetchInterval: 60_000,
  });

  const observedByUrl = useMemo(() => {
    const map = new Map<string, ObserveTarget>();
    for (const target of observeQ.data?.targets ?? []) map.set(normalizeUrl(target.url), target);
    return map;
  }, [observeQ.data]);

  const projectsByBackend = useMemo(() => {
    const map = new Map<string, { projectId: string; projectNames: string[] }>();
    for (const project of overviewQ.data?.projects ?? []) {
      for (const backend of project.backends) {
        const existing = map.get(backend.id);
        if (existing) {
          if (!existing.projectNames.includes(project.project_name)) {
            existing.projectNames.push(project.project_name);
          }
        } else {
          map.set(backend.id, {
            projectId: project.project_id,
            projectNames: [project.project_name],
          });
        }
      }
    }
    return map;
  }, [overviewQ.data]);

  // /all 是全局注册表真值，确保尚未绑定任何项目的 backend 也可见；/overview 只补项目名称
  // 和仍需项目路径的预热操作所用 projectId。
  const registered = useMemo<RegisteredRef[]>(() => {
    return (registryQ.data?.items ?? []).map((backend) => {
      const projects = projectsByBackend.get(backend.id);
      return {
        projectId: projects?.projectId,
        projectNames: projects?.projectNames ?? [],
        backend,
        observe: observedByUrl.get(normalizeUrl(backend.url)),
      };
    });
  }, [observedByUrl, projectsByBackend, registryQ.data]);

  const registeredUrls = useMemo(
    () => new Set(registered.map((ref) => normalizeUrl(ref.backend.url))),
    [registered],
  );
  const envOnlyTargets = useMemo(
    () => (observeQ.data?.targets ?? []).filter((target) => !registeredUrls.has(normalizeUrl(target.url))),
    [observeQ.data, registeredUrls],
  );

  const loading = registryQ.isLoading || overviewQ.isLoading || observeQ.isLoading;
  const error = registryQ.error ?? overviewQ.error ?? observeQ.error;

  return (
    <div className="mb-4">
      <Card>
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3 max-md:flex-col max-md:items-stretch">
          <div className="flex items-center gap-2">
            <Icon name="activity" size={14} className="text-muted-foreground" />
            <h3 className="m-0 text-sm font-semibold">运行时观测</h3>
            <span className="text-xs text-muted-foreground">
              {registered.length} 个注册 backend · {envOnlyTargets.length} 个未注册容器
            </span>
          </div>
          <div className="flex items-center gap-2 max-md:w-full max-md:flex-col max-md:items-stretch">
            <Button
              size="sm"
              onClick={() => {
                registryQ.refetch();
                overviewQ.refetch();
              }}
              disabled={registryQ.isFetching || overviewQ.isFetching}
            >
              <Icon name="refresh" size={11} />
              注册状态
            </Button>
            <Button size="sm" onClick={() => observeQ.refetch()} disabled={observeQ.isFetching}>
              <Icon name="refresh" size={11} />
              实时指标
            </Button>
          </div>
        </div>

        {loading ? (
          <div className="py-3 text-xs text-muted-foreground">加载运行时状态…</div>
        ) : error ? (
          <div className={NOTE_ERROR_CLASS}>加载失败：{(error as Error).message ?? "未知错误"}</div>
        ) : (
          <div className="flex flex-col gap-3.5 p-3">
            {registered.length > 0 && (
              <section className="flex flex-col gap-2.5">
                <div className="text-xs font-semibold text-muted-foreground">已注册 backend</div>
                {registered.map((ref) => (
                  <RegisteredRuntimeCard
                    key={ref.backend.id}
                    projectId={ref.projectId}
                    projectNames={ref.projectNames}
                    backend={ref.backend}
                    observe={ref.observe}
                  />
                ))}
              </section>
            )}

            {envOnlyTargets.length > 0 && (
              <section className="flex flex-col gap-2.5">
                <div className="text-xs font-semibold text-muted-foreground">未注册容器</div>
                {envOnlyTargets.map((target) => (
                  <EnvOnlyCard key={target.url} target={target} />
                ))}
              </section>
            )}

            {registered.length === 0 && envOnlyTargets.length === 0 && (
              <div className="flex flex-col items-center gap-1.5 p-8 text-center text-sm text-muted-foreground">
                <Icon name="activity" size={28} className="opacity-30" />
                <div>暂无可观测 ML Backend</div>
                <div className="text-xs">注册 backend 或配置 ML_BACKEND_OBSERVE_URLS 后会出现在这里</div>
              </div>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}

function RegisteredRuntimeCard({
  projectId,
  projectNames,
  backend,
  observe,
}: {
  projectId?: string;
  projectNames: string[];
  backend: GlobalBackendItem;
  observe?: ObserveTarget;
}) {
  const pushToast = useToastStore((s) => s.push);
  const health = useRegistryHealth();
  const unload = useRegistryUnload();
  const reload = useMLBackendReload(projectId ?? "");
  const warmup = useMLBackendWarmup(projectId ?? "");

  const ok = observe?.ok ?? backend.state === "connected";
  const gpu = observe?.gpu_info ?? backend.health_meta?.gpu_info;
  const pool = observe?.pool ?? backend.health_meta?.pool;
  const videoPool = observe?.video_pool ?? backend.health_meta?.video_pool;
  const modelVersion = observe?.model_version ?? backend.health_meta?.model_version;
  const compute = resolveRuntimeCompute(observe, backend.health_meta?.compute);
  const cachedHealthFresh = isFreshCachedHealth(backend.state, backend.last_checked_at);
  const hasDirectResidency = observe?.ok === true && observe.residency != null;
  const residency = hasDirectResidency
    ? observe.residency
    : backend.health_meta?.residency;
  const residencySource = hasDirectResidency
    ? "实时直连（仅作旁证）"
    : cachedHealthFresh
      ? "缓存 health（新鲜）"
      : "缓存 health（过期或未知）";
  const residencyTrusted = hasDirectResidency || cachedHealthFresh;
  const supportsWarmup = backend.health_meta?.capabilities?.warmup_endpoint === true;
  const setupQ = useQuery({
    queryKey: mlBackendSetupQueryKey(projectId ?? "unbound", backend.id),
    queryFn: () => mlBackendsApi.setup(projectId!, backend.id),
    enabled: !!projectId && supportsWarmup,
    staleTime: 30_000,
  });

  const onHealth = () => {
    health.mutate(backend.id, {
      onSuccess: (res) =>
        pushToast({
          msg: `${backend.name}: ${res.status}`,
          kind: res.status === "ok" ? "success" : "warning",
        }),
      onError: (e) => pushToast({ msg: "健康检查失败", sub: (e as Error).message }),
    });
  };
  const onUnload = () => {
    unload.mutate(backend.id, {
      onSuccess: (res) =>
        pushToast({
          msg: res.unloaded
            ? `${backend.name} 已接受卸载请求，等待 residency 确认`
            : `${backend.name} 未报告需要卸载`,
          kind: "success",
        }),
      onError: (e) => pushToast({ msg: "卸载失败", sub: (e as Error).message }),
    });
  };
  const onWarm = (target?: VariantWarmTarget) => {
    if (!projectId) {
      pushToast({ msg: "请先把 backend 启用到项目，再执行预热", kind: "warning" });
      return;
    }
    if (supportsWarmup) {
      const body = buildWarmupBody(target, setupQ.data);
      warmup.mutate(
        { backendId: backend.id, body },
        {
          onSuccess: (res) => {
            pushToast({
              msg: res.cache_hit ? `${backend.name} 报告命中现有缓存` : `${backend.name} 预热请求成功`,
              kind: "success",
              sub: res.evicted ? `淘汰 ${res.evicted}` : undefined,
            });
          },
          onError: (e) => pushToast({ msg: "预热失败", sub: (e as Error).message }),
        },
      );
      return;
    }
    const variant = target?.variants as MLBackendVariant | undefined;
    const taskType = target?.taskType;
    reload.mutate(
      { backendId: backend.id, variant, taskType },
      {
        onSuccess: (res) => {
          const tag = res.sam_variant
            ? ` (${res.sam_variant}${res.dino_variant ? `/${res.dino_variant}` : ""})`
            : "";
          pushToast({
            msg: res.reloaded
              ? `${backend.name} 重载请求成功${tag}`
              : `${backend.name} 报告无需重载${tag}`,
            kind: "success",
          });
        },
        onError: (e) => pushToast({ msg: "预热失败", sub: (e as Error).message }),
      },
    );
  };

  return (
    <div className={CARD_CLASS}>
      <div className={CARD_TOP_CLASS}>
        <Badge variant={ok ? "success" : "danger"} dot>
          {ok ? "在线" : "离线"}
        </Badge>
        {/* 实时 /observe 优先，不可达时回落已缓存 health_meta。 */}
        {isCpuFallback(compute) && (
          <span title="配置了 GPU 但已静默退回 CPU 推理">
            <Badge
              variant="outline"
              className="border-status-caution/50 text-status-caution"
            >
              ⚠ CPU 回退
            </Badge>
          </span>
        )}
        <span className="max-w-[220px] truncate text-sm font-semibold">{backend.name}</span>
        <span className="text-xs text-muted-foreground" title={projectNames.join(" / ")}>
          {projectNames.length === 0
            ? "未绑定项目"
            : projectNames.length > 1
            ? `${projectNames[0]} +${projectNames.length - 1}`
            : projectNames[0]}
        </span>
        <span className={URL_CLASS}>{backend.url}</span>
        {observe ? (
          <span className={LATENCY_CLASS}>{observe.latency_ms}ms</span>
        ) : (
          <Badge variant="outline">未配置直连观测</Badge>
        )}
      </div>

      {observe && !observe.ok && <div className={NOTE_ERROR_CLASS}>{observe.error ?? "不可达"}</div>}

      <GPUClaimSummary backend={backend} />

      <RuntimeMetrics
        modelVersion={modelVersion}
        gpuInfo={gpu}
        pool={pool}
        videoPool={videoPool}
        cacheHitRate={observe?.cache?.hit_rate ?? backend.health_meta?.cache?.hit_rate}
      />
      <ResidencySummary
        residency={residency}
        source={residencySource}
        trusted={residencyTrusted}
      />

      <div className="flex items-center gap-2">
        <Button size="xs" onClick={onHealth} disabled={health.isPending} title="健康检查">
          <Icon name="refresh" size={10} />
          健康检查
        </Button>
        <Button size="xs" onClick={onUnload} disabled={unload.isPending} title="发送卸载请求">
          <Icon name="pause" size={10} />
          卸载
        </Button>
        <Button
          size="xs"
          onClick={() => onWarm()}
          disabled={
            !projectId ||
            reload.isPending ||
            warmup.isPending ||
            (supportsWarmup && setupQ.isLoading)
          }
          title={projectId ? "预热默认模型" : "请先把 backend 启用到项目"}
        >
          <Icon name="play" size={10} />
          预热默认
        </Button>
      </div>

      {projectId ? (
        <VariantPanel
          projectId={projectId}
          backend={backend}
          onWarm={onWarm}
          isWarming={reload.isPending || warmup.isPending}
        />
      ) : (
        <div className="text-2xs text-muted-foreground">
          尚未启用到项目；全局健康检查和卸载可用，预热需先建立项目启用关系。
        </div>
      )}
    </div>
  );
}

function isFreshCachedHealth(state: string, lastCheckedAt: string | null) {
  if (state !== "connected" || !lastCheckedAt) return false;
  const checkedAt = Date.parse(lastCheckedAt);
  if (!Number.isFinite(checkedAt)) return false;
  const ageMs = Date.now() - checkedAt;
  return ageMs >= -60_000 && ageMs <= 180_000;
}

function GPUClaimSummary({ backend }: { backend: GlobalBackendItem }) {
  const config = backend.gpu_config;
  if (!config) {
    return <div className="text-xs text-muted-foreground">GPU 配置仅超级管理员可见</div>;
  }
  return (
    <div className="flex flex-col gap-1.5 text-xs text-muted-foreground">
      <div className="flex flex-wrap items-center gap-2">
        <Badge
          variant={
            config.status === "blocker" || config.status === "critical"
              ? "danger"
              : config.status === "warning"
                ? "warning"
                : config.status === "info"
                  ? "accent"
                  : "outline"
          }
        >
          GPU claim {config.status ?? "ok"}
        </Badge>
        <span className="mono">{backend.gpu_resource_id ?? "无声明"}</span>
        {backend.gpu_resource_id && (
          <>
            <span>
              预算 {backend.vram_budget_mb ?? "—"}/{config.allocatable_mb ?? "—"} MiB
            </span>
            <span>优先级 {backend.eviction_priority ?? "—"}</span>
            <span>{config.desired_mode ?? "off"}→{config.effective_mode ?? "off"}</span>
          </>
        )}
      </div>
      {(config.diagnostics?.length ?? 0) > 0 && (
        <div className="flex flex-col gap-1 text-2xs">
          {config.diagnostics!.map((diagnostic, index) => (
            <span key={`${diagnostic.code}-${index}`}>{diagnostic.message}</span>
          ))}
        </div>
      )}
    </div>
  );
}

const RESIDENCY_STATES = new Set([
  "unloaded",
  "loading",
  "resident",
  "draining",
  "unloading",
  "unknown",
]);

type ResidencyState = "unloaded" | "loading" | "resident" | "draining" | "unloading" | "unknown";

interface NormalizedResidencyPool {
  id: string;
  resident: boolean | null;
  device: string | null;
  provider: string | null;
}

interface NormalizedResidency {
  state: ResidencyState;
  gpuLoaded: boolean | null;
  activeRequests: number | null;
  builders: number | null;
  borrowers: number | null;
  draining: boolean | null;
  evictable: boolean | null;
  lifecycleGate: string | null;
  generation: string | null;
  identityResourceId: string | null;
  pools: NormalizedResidencyPool[];
  strictEmpty: boolean;
  malformed: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function parseResidency(value: unknown): NormalizedResidency | null {
  if (!isRecord(value)) return null;
  const state = value.state;
  if (typeof state !== "string" || !RESIDENCY_STATES.has(state)) return null;

  let malformed = false;
  const readBoolean = (key: string): boolean | null => {
    const raw = value[key];
    if (raw == null) return null;
    if (typeof raw === "boolean") return raw;
    malformed = true;
    return null;
  };
  const readInteger = (key: string): number | null => {
    const raw = value[key];
    if (raw == null) return null;
    if (typeof raw === "number" && Number.isInteger(raw)) return raw;
    malformed = true;
    return null;
  };
  const readString = (key: string): string | null => {
    const raw = value[key];
    if (raw == null) return null;
    if (typeof raw === "string") return raw;
    malformed = true;
    return null;
  };

  const gpuLoaded = readBoolean("gpu_loaded");
  const activeRequests = readInteger("active_requests");
  const builders = readInteger("builders");
  const borrowers = readInteger("borrowers");
  const draining = readBoolean("draining");
  const evictable = readBoolean("evictable");
  const lifecycleGate = readString("lifecycle_gate");
  const generation = readString("generation");

  let identityResourceId: string | null = null;
  if (value.identity != null) {
    if (!isRecord(value.identity)) {
      malformed = true;
    } else if (value.identity.gpu_resource_id != null) {
      if (typeof value.identity.gpu_resource_id === "string") {
        identityResourceId = value.identity.gpu_resource_id;
      } else {
        malformed = true;
      }
    }
  }

  const pools: NormalizedResidencyPool[] = [];
  let poolsValid = false;
  if (isRecord(value.pools)) {
    poolsValid = true;
    for (const [id, rawPool] of Object.entries(value.pools)) {
      if (!isRecord(rawPool)) {
        malformed = true;
        poolsValid = false;
        continue;
      }
      const rawResident = rawPool.resident;
      const resident =
        rawResident == null
          ? null
          : typeof rawResident === "boolean"
            ? rawResident
            : null;
      if (rawResident != null && typeof rawResident !== "boolean") {
        malformed = true;
        poolsValid = false;
      }
      const device =
        rawPool.device == null
          ? null
          : typeof rawPool.device === "string"
            ? rawPool.device
            : null;
      const provider =
        rawPool.provider == null
          ? null
          : typeof rawPool.provider === "string"
            ? rawPool.provider
            : null;
      if (
        (rawPool.device != null && typeof rawPool.device !== "string") ||
        (rawPool.provider != null && typeof rawPool.provider !== "string")
      ) {
        malformed = true;
      }
      pools.push({ id, resident, device, provider });
    }
  } else if (value.pools != null) {
    malformed = true;
  }

  const strictEmpty =
    gpuLoaded === false &&
    builders === 0 &&
    borrowers === 0 &&
    poolsValid &&
    pools.every((pool) => pool.resident === false);

  return {
    state: state as ResidencyState,
    gpuLoaded,
    activeRequests,
    builders,
    borrowers,
    draining,
    evictable,
    lifecycleGate,
    generation,
    identityResourceId,
    pools,
    strictEmpty,
    malformed,
  };
}

function ResidencySummary({
  residency: raw,
  source,
  trusted,
}: {
  residency: unknown;
  source: string;
  trusted: boolean;
}) {
  if (raw == null) {
    return <div className="text-2xs text-muted-foreground">未上报 residency · {source}</div>;
  }
  const residency = parseResidency(raw);
  if (!residency) {
    return (
      <div className="text-2xs text-status-caution">
        residency 格式不可识别，仅保留原始观测，不参与 GPU 空闲判断 · {source}
      </div>
    );
  }
  const gpuLoaded =
    trusted && residency.gpuLoaded === true
      ? true
      : trusted && !residency.malformed && residency.strictEmpty
        ? false
        : null;
  const unmanaged = trusted && gpuLoaded !== false && !residency.generation;

  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-border bg-muted/30 px-2.5 py-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge
          variant={
            residency.state === "resident"
              ? "success"
              : residency.state === "unknown"
                ? "warning"
                : "outline"
          }
        >
          {residency.state}
        </Badge>
        <Badge
          variant={
            gpuLoaded === true
              ? "warning"
              : gpuLoaded === false
                ? "success"
                : "outline"
          }
        >
          {gpuLoaded === true
            ? "GPU 仍驻留"
            : gpuLoaded === false
              ? "GPU 空"
              : "GPU 驻留未知"}
        </Badge>
        {unmanaged && <Badge variant="warning">unmanaged</Badge>}
        <span className="text-2xs text-muted-foreground">{source}</span>
      </div>
      {!trusted && (
        <div className="text-2xs text-status-caution">
          residency 证据已过期或来源未知，仅展示原始状态，不据此判断 GPU 空闲。
        </div>
      )}
      {residency.malformed && (
        <div className="text-2xs text-status-caution">
          residency 含畸形字段，已安全归一化且不参与 GPU 空闲判断。
        </div>
      )}
      {trusted && residency.gpuLoaded === false && gpuLoaded !== false && !residency.malformed && (
        <div className="text-2xs text-status-caution">
          gpu_loaded=false 缺少全 pool、builder 或 borrower 空闲证据，按未知处理。
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3 text-2xs text-muted-foreground">
        <span>active {residency.activeRequests ?? "—"}</span>
        <span>builders {residency.builders ?? "—"}</span>
        <span>borrowers {residency.borrowers ?? "—"}</span>
        <span>draining {residency.draining == null ? "—" : String(residency.draining)}</span>
        <span>evictable {residency.evictable == null ? "—" : String(residency.evictable)}</span>
        <span>gate {residency.lifecycleGate ?? "—"}</span>
        <span>generation {residency.generation ?? "—"}</span>
        {residency.identityResourceId && (
          <span className="mono">identity {residency.identityResourceId}</span>
        )}
      </div>
      {residency.pools.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-2xs text-muted-foreground">
          {residency.pools.map((pool) => (
            <span key={pool.id} className="mono">
              {pool.id}: {pool.resident === true && trusted
                ? "GPU"
                : pool.resident === false && trusted && !residency.malformed
                  ? "empty"
                  : "unknown"}
              {pool.device ? ` · ${pool.device}` : ""}
              {pool.provider ? ` · ${pool.provider}` : ""}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function pickDefaultVariants(model: MLModelCapability | undefined): Record<string, string> {
  const out: Record<string, string> = { ...(model?.default_variants ?? {}) };
  for (const group of model?.supported_variants ?? []) {
    if (out[group.key]) continue;
    const options = group.variants ?? [];
    const recommended = options.find((option) => option.recommended);
    const picked = recommended ?? options[0];
    if (picked?.value) out[group.key] = picked.value;
  }
  return out;
}

function buildWarmupBody(
  target: VariantWarmTarget | undefined,
  setup: MLBackendCapability | undefined,
): Record<string, unknown> {
  if (target?.taskType === "video") {
    return { task: "tracker", variants: target.variants ?? {} };
  }
  if (target?.task || target?.variants) {
    return {
      ...(target.task ? { task: target.task } : {}),
      ...(target.variants ? { variants: target.variants } : {}),
    };
  }
  const model = setup?.models?.[0];
  const variants = pickDefaultVariants(model);
  return {
    ...(model?.task ? { task: model.task } : {}),
    ...(Object.keys(variants).length > 0 ? { variants } : {}),
  };
}

function EnvOnlyCard({ target }: { target: ObserveTarget }) {
  const pushToast = useToastStore((s) => s.push);
  const [busy, setBusy] = useState(false);
  const catalog = target.variant_catalog;
  const samEnum = catalog?.sam_variant ?? [];
  const dinoEnum = catalog?.dino_variant ?? [];
  const genericGroups = (target.supported_variants ?? []).filter(
    (group) => Array.isArray(group.variants) && group.variants.length > 0,
  );
  // gsam2 同时上报 params.{sam,dino}_variant.enum (老) 和 supported_variants (富 v0.10.40+);
  // 两套渲染会重复. 富格式覆盖时隐藏老 sam/dino 下拉, 保留富格式 (含 label/vram/tier 元数据).
  const showLegacyVariants = genericGroups.length === 0;
  const [sam, setSam] = useState(samEnum[0] ?? "");
  const [dino, setDino] = useState(dinoEnum[0] ?? "");
  const [genericVariant, setGenericVariant] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      genericGroups.map((group) => [group.key, group.variants?.[0]?.value ?? ""]).filter(([, v]) => v),
    ),
  );
  const canSmoke =
    (showLegacyVariants && (samEnum.length > 0 || dinoEnum.length > 0)) ||
    Object.values(genericVariant).some(Boolean);

  const onSmokeTest = async () => {
    // 富格式优先: 把 genericVariant 映射回 {sam_variant, dino_variant} (gsam2 admin
    // smoke-test 端目前只认这两个字段). 富 group.key 与老 axis key 同名 (sam_variant/
    // dino_variant), 可直接透传.
    const payload: SmokeTestRequest = showLegacyVariants
      ? { url: target.url, sam_variant: sam || undefined, dino_variant: dino || undefined }
      : {
          url: target.url,
          sam_variant: genericVariant.sam_variant || undefined,
          dino_variant: genericVariant.dino_variant || undefined,
          variant: genericVariant,
        };
    setBusy(true);
    try {
      const res = await adminMlIntegrationsApi.observeSmokeTest(payload);
      pushToast({
        msg: res.message,
        kind: res.ok ? "success" : "warning",
        sub: res.error ?? undefined,
      });
    } catch (e) {
      pushToast({ msg: "试启动请求失败", sub: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={CARD_CLASS}>
      <div className={CARD_TOP_CLASS}>
        <Badge variant={target.ok ? "success" : "danger"} dot>
          {target.ok ? "在线" : "离线"}
        </Badge>
        {isCpuFallback(target.compute) && (
          <span title="配置了 GPU 但已静默退回 CPU 推理">
            <Badge
              variant="outline"
              className="border-status-caution/50 text-status-caution"
            >
              ⚠ CPU 回退
            </Badge>
          </span>
        )}
        <span className={URL_CLASS}>{target.url}</span>
        <span className={LATENCY_CLASS}>{target.latency_ms}ms</span>
      </div>

      {!target.ok ? (
        <div className={NOTE_ERROR_CLASS}>{target.error ?? "不可达"}</div>
      ) : (
        <>
          <RuntimeMetrics
            modelVersion={target.model_version}
            gpuInfo={target.gpu_info}
            pool={target.pool}
            videoPool={target.video_pool}
            cacheHitRate={target.cache?.hit_rate}
          />
          {target.supports_variants ? (
            <div className="flex flex-wrap items-center gap-2">
              {showLegacyVariants && samEnum.length > 0 && (
                <select value={sam} onChange={(e) => setSam(e.target.value)} className={SELECT_CLASS}>
                  {samEnum.map((option) => (
                    <option key={option} value={option}>
                      sam:{option}
                    </option>
                  ))}
                </select>
              )}
              {showLegacyVariants && dinoEnum.length > 0 && (
                <select value={dino} onChange={(e) => setDino(e.target.value)} className={SELECT_CLASS}>
                  {dinoEnum.map((option) => (
                    <option key={option} value={option}>
                      dino:{option}
                    </option>
                  ))}
                </select>
              )}
              {genericGroups.map((group) => (
                <label key={group.key} className="flex items-center gap-1.5">
                  <span className="text-2xs font-semibold text-muted-foreground">{group.title ?? group.key}</span>
                  <select
                    value={genericVariant[group.key] ?? ""}
                    onChange={(e) =>
                      setGenericVariant((value) => ({ ...value, [group.key]: e.target.value }))
                    }
                    className={SELECT_CLASS}
                  >
                    {group.variants!.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label ?? option.value}
                        {option.vram_gb != null ? ` · ${option.vram_gb}GB` : ""}
                        {option.tier ? ` · ${option.tier}` : ""}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
              <Button
                size="sm"
                onClick={onSmokeTest}
                disabled={busy || !canSmoke}
                title={canSmoke ? "空池时 warm→自动卸载验证可加载性" : "待 backend 实现通用 warm 接口"}
              >
                <Icon name="play" size={11} />
                试启动
              </Button>
            </div>
          ) : (
            <div className="py-3 text-xs text-muted-foreground">该容器不暴露变体目录</div>
          )}
          {/* 视频追踪能力 (来自 /setup.supported_trackers): sam3 等只把视频权重挂在
              tracker 上、不进 model_variant 目录, 若不单独展示这里, 未注册卡会只显示图像
              权重、看似「没暴露视频权重」。注册卡的 VariantPanel 已有「视频追踪变体」区。 */}
          {(target.supported_trackers?.length ?? 0) > 0 && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Icon name="film" size={11} />
              <span>支持视频追踪：{target.supported_trackers!.join(" · ")}</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function RuntimeMetrics({
  modelVersion,
  gpuInfo,
  pool,
  videoPool,
  cacheHitRate,
}: {
  modelVersion?: string | null;
  gpuInfo?: GpuInfo | null;
  // v0.14.14: 接受 PoolStatus.loaded_keys (优先) 与老 loaded_variants (fallback);
  // 仅用其 length 做"已加载数量"展示, 不解 key 维度.
  pool?: {
    cap?: number;
    current_size?: number;
    loaded_keys?: unknown[];
    loaded_variants?: unknown[];
  } | null;
  videoPool?: {
    cap?: number;
    current_size?: number;
    loaded_keys?: unknown[];
    loaded_variants?: string[];
    active_sessions?: number;
  } | null;
  cacheHitRate?: number;
}) {
  const loadedCount =
    pool?.current_size ??
    pool?.loaded_keys?.length ??
    pool?.loaded_variants?.length ??
    0;
  const videoLoadedCount =
    videoPool?.current_size ??
    videoPool?.loaded_keys?.length ??
    videoPool?.loaded_variants?.length ??
    0;
  return (
    <div className={METRICS_CLASS}>
      {modelVersion && <span className="mono">{modelVersion}</span>}
      {gpuInfo?.memory_used_mb != null && gpuInfo?.memory_total_mb != null && (
        <span title="卡号 · 整卡已用/总显存 · 本容器自用（torch 保留）">
          GPU{gpuInfo.device_index ?? 0} {gpuInfo.memory_used_mb}/{gpuInfo.memory_total_mb} MB
          {gpuInfo.process_memory_mb != null && ` · 自用 ${gpuInfo.process_memory_mb} MB`}
        </span>
      )}
      {(gpuInfo?.physical_device_token || gpuInfo?.mig_uuid || gpuInfo?.device_uuid) && (
        <span className="mono" title="backend 上报的物理设备身份">
          {gpuInfo.physical_device_token ?? gpuInfo.mig_uuid ?? gpuInfo.device_uuid}
        </span>
      )}
      {cacheHitRate != null && <span>cache {(cacheHitRate * 100).toFixed(1)}%</span>}
      <span>
        图像池 {loadedCount}
        {pool?.cap != null && `/${pool.cap}`}
      </span>
      {videoPool && (
        <span>
          视频池 {videoLoadedCount}
          {videoPool.cap != null && `/${videoPool.cap}`}
          {videoPool.active_sessions != null && ` · ${videoPool.active_sessions} 会话`}
        </span>
      )}
    </div>
  );
}
