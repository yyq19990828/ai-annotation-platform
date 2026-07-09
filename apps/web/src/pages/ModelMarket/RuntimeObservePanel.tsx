import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { useToastStore } from "@/components/ui/Toast";
import {
  adminMlIntegrationsApi,
  type MLBackendItem,
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
  useMLBackendHealth,
  useMLBackendReload,
  useMLBackendUnload,
  useMLBackendWarmup,
} from "@/hooks/useMLBackends";
import { VariantPanel, type VariantWarmTarget } from "./VariantPanel";

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
  projectId: string;        // 路由 unload/reload/warmup 用: 任一启用项目即可 (backend 全局, 操作作用于物理后端)
  projectNames: string[];   // 启用了该 backend 的所有项目名 (去重聚合展示)
  backend: MLBackendItem;
  observe?: ObserveTarget;
}

function normalizeUrl(url: string) {
  return url.replace(/\/+$/, "");
}

export function RuntimeObservePanel() {
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

  // backend 全局化 (ADR-0044) 后, 同一物理 backend 可被 N 个项目启用, overview 会为
  // 每个 (project, backend) 各返回一行。这里按 backend url 去重, 每个物理 backend 一张卡,
  // 把启用它的项目名聚合进 projectNames, 避免重复显示。
  const registered = useMemo<RegisteredRef[]>(() => {
    const byUrl = new Map<string, RegisteredRef>();
    for (const project of overviewQ.data?.projects ?? []) {
      for (const backend of project.backends) {
        const key = normalizeUrl(backend.url);
        const existing = byUrl.get(key);
        if (existing) {
          if (!existing.projectNames.includes(project.project_name)) {
            existing.projectNames.push(project.project_name);
          }
        } else {
          byUrl.set(key, {
            projectId: project.project_id,
            projectNames: [project.project_name],
            backend,
            observe: observedByUrl.get(key),
          });
        }
      }
    }
    return [...byUrl.values()];
  }, [observedByUrl, overviewQ.data]);

  const registeredUrls = useMemo(
    () => new Set(registered.map((ref) => normalizeUrl(ref.backend.url))),
    [registered],
  );
  const envOnlyTargets = useMemo(
    () => (observeQ.data?.targets ?? []).filter((target) => !registeredUrls.has(normalizeUrl(target.url))),
    [observeQ.data, registeredUrls],
  );

  const loading = overviewQ.isLoading || observeQ.isLoading;
  const error = overviewQ.error ?? observeQ.error;

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
            <Button size="sm" onClick={() => overviewQ.refetch()} disabled={overviewQ.isFetching}>
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
  projectId: string;
  projectNames: string[];
  backend: MLBackendItem;
  observe?: ObserveTarget;
}) {
  const pushToast = useToastStore((s) => s.push);
  const health = useMLBackendHealth(projectId);
  const unload = useMLBackendUnload(projectId);
  const reload = useMLBackendReload(projectId);
  const warmup = useMLBackendWarmup(projectId);

  const ok = observe?.ok ?? backend.state === "connected";
  const gpu = observe?.gpu_info ?? backend.health_meta?.gpu_info;
  const pool = observe?.pool ?? backend.health_meta?.pool;
  const videoPool = observe?.video_pool ?? backend.health_meta?.video_pool;
  const modelVersion = observe?.model_version ?? backend.health_meta?.model_version;
  const supportsWarmup = backend.health_meta?.capabilities?.warmup_endpoint === true;
  const setupQ = useQuery({
    queryKey: mlBackendSetupQueryKey(projectId, backend.id),
    queryFn: () => mlBackendsApi.setup(projectId, backend.id),
    enabled: supportsWarmup,
    staleTime: 30_000,
  });

  const onHealth = () => {
    health.mutate(backend.id, {
      onSuccess: (res) =>
        pushToast({
          msg: `${backend.name}: ${res.status}`,
          kind: res.status === "connected" ? "success" : "warning",
        }),
      onError: (e) => pushToast({ msg: "健康检查失败", sub: (e as Error).message }),
    });
  };
  const onUnload = () => {
    unload.mutate(backend.id, {
      onSuccess: (res) =>
        pushToast({
          msg: res.unloaded ? `${backend.name} 已卸载，显存已释放` : `${backend.name} 当前未加载，无需卸载`,
          kind: "success",
        }),
      onError: (e) => pushToast({ msg: "卸载失败", sub: (e as Error).message }),
    });
  };
  const onWarm = (target?: VariantWarmTarget) => {
    if (supportsWarmup) {
      const body = buildWarmupBody(target, setupQ.data);
      warmup.mutate(
        { backendId: backend.id, body },
        {
          onSuccess: (res) => {
            pushToast({
              msg: res.cache_hit ? `${backend.name} 已在显存中` : `${backend.name} 已预热到显存`,
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
            msg: res.reloaded ? `${backend.name} 已预热到显存${tag}` : `${backend.name} 已在显存中${tag}`,
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
        <span className="max-w-[220px] truncate text-sm font-semibold">{backend.name}</span>
        <span className="text-xs text-muted-foreground" title={projectNames.join(" / ")}>
          {projectNames.length > 1
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

      <RuntimeMetrics
        modelVersion={modelVersion}
        gpuInfo={gpu}
        pool={pool}
        videoPool={videoPool}
        cacheHitRate={observe?.cache?.hit_rate ?? backend.health_meta?.cache?.hit_rate}
      />

      <div className="flex items-center gap-2">
        <Button size="xs" onClick={onHealth} disabled={health.isPending} title="健康检查">
          <Icon name="refresh" size={10} />
          健康检查
        </Button>
        <Button size="xs" onClick={onUnload} disabled={unload.isPending} title="卸载模型释放显存">
          <Icon name="pause" size={10} />
          卸载
        </Button>
        <Button
          size="xs"
          onClick={() => onWarm()}
          disabled={reload.isPending || warmup.isPending || (supportsWarmup && setupQ.isLoading)}
          title="预热默认模型"
        >
          <Icon name="play" size={10} />
          预热默认
        </Button>
      </div>

      <VariantPanel
        projectId={projectId}
        backend={backend}
        onWarm={onWarm}
        isWarming={reload.isPending || warmup.isPending}
      />
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
  gpuInfo?: {
    device_index?: number | null;
    memory_used_mb?: number;
    memory_total_mb?: number;
    process_memory_mb?: number | null;
  } | null;
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
