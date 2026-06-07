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
import type { MLBackendVariant } from "@/api/ml-backends";
import {
  useMLBackendHealth,
  useMLBackendReload,
  useMLBackendUnload,
} from "@/hooks/useMLBackends";
import { VariantPanel } from "./VariantPanel";
import styles from "./RuntimeObservePanel.module.css";

interface RegisteredRef {
  projectId: string;
  projectName: string;
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

  const registered = useMemo<RegisteredRef[]>(() => {
    const refs: RegisteredRef[] = [];
    for (const project of overviewQ.data?.projects ?? []) {
      for (const backend of project.backends) {
        refs.push({
          projectId: project.project_id,
          projectName: project.project_name,
          backend,
          observe: observedByUrl.get(normalizeUrl(backend.url)),
        });
      }
    }
    return refs;
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
    <div className={styles.wrap}>
      <Card>
        <div className={styles.header}>
          <div className={styles.headerTitle}>
            <Icon name="activity" size={14} className={styles.mutedIcon} />
            <h3 className={styles.title}>运行时观测</h3>
            <span className={styles.meta}>
              {registered.length} 个注册 backend · {envOnlyTargets.length} 个未注册容器
            </span>
          </div>
          <div className={styles.headerActions}>
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
          <div className={styles.note}>加载运行时状态…</div>
        ) : error ? (
          <div className={styles.noteError}>加载失败：{(error as Error).message ?? "未知错误"}</div>
        ) : (
          <div className={styles.list}>
            {registered.length > 0 && (
              <section className={styles.section}>
                <div className={styles.sectionTitle}>已注册 backend</div>
                {registered.map((ref) => (
                  <RegisteredRuntimeCard
                    key={`${ref.projectId}:${ref.backend.id}`}
                    projectId={ref.projectId}
                    projectName={ref.projectName}
                    backend={ref.backend}
                    observe={ref.observe}
                  />
                ))}
              </section>
            )}

            {envOnlyTargets.length > 0 && (
              <section className={styles.section}>
                <div className={styles.sectionTitle}>未注册容器</div>
                {envOnlyTargets.map((target) => (
                  <EnvOnlyCard key={target.url} target={target} />
                ))}
              </section>
            )}

            {registered.length === 0 && envOnlyTargets.length === 0 && (
              <div className={styles.emptyState}>
                <Icon name="activity" size={28} className={styles.emptyIcon} />
                <div>暂无可观测 ML Backend</div>
                <div className={styles.emptyHint}>注册 backend 或配置 ML_BACKEND_OBSERVE_URLS 后会出现在这里</div>
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
  projectName,
  backend,
  observe,
}: {
  projectId: string;
  projectName: string;
  backend: MLBackendItem;
  observe?: ObserveTarget;
}) {
  const pushToast = useToastStore((s) => s.push);
  const health = useMLBackendHealth(projectId);
  const unload = useMLBackendUnload(projectId);
  const reload = useMLBackendReload(projectId);

  const ok = observe?.ok ?? backend.state === "connected";
  const gpu = observe?.gpu_info ?? backend.health_meta?.gpu_info;
  const pool = observe?.pool ?? backend.health_meta?.pool;
  const videoPool = observe?.video_pool ?? backend.health_meta?.video_pool;
  const modelVersion = observe?.model_version ?? backend.health_meta?.model_version;

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
  const onReload = (variant?: MLBackendVariant, taskType?: "image" | "video") => {
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
    <div className={styles.card}>
      <div className={styles.cardTop}>
        <Badge variant={ok ? "success" : "danger"} dot>
          {ok ? "在线" : "离线"}
        </Badge>
        <span className={styles.backendName}>{backend.name}</span>
        <span className={styles.projectName}>{projectName}</span>
        <span className={`mono ${styles.url}`}>{backend.url}</span>
        {observe ? (
          <span className={styles.latency}>{observe.latency_ms}ms</span>
        ) : (
          <Badge variant="outline">未配置直连观测</Badge>
        )}
      </div>

      {observe && !observe.ok && <div className={styles.noteError}>{observe.error ?? "不可达"}</div>}

      <RuntimeMetrics
        modelVersion={modelVersion}
        gpuInfo={gpu}
        pool={pool}
        videoPool={videoPool}
        cacheHitRate={observe?.cache?.hit_rate ?? backend.health_meta?.cache?.hit_rate}
      />

      <div className={styles.actionRow}>
        <Button size="sm" onClick={onHealth} disabled={health.isPending} title="健康检查">
          <Icon name="refresh" size={11} />
          健康检查
        </Button>
        <Button size="sm" onClick={onUnload} disabled={unload.isPending} title="卸载模型释放显存">
          <Icon name="pause" size={11} />
          卸载
        </Button>
        <Button size="sm" onClick={() => onReload()} disabled={reload.isPending} title="重新加载默认模型">
          <Icon name="play" size={11} />
          预热默认
        </Button>
      </div>

      <VariantPanel
        projectId={projectId}
        backend={backend}
        onWarm={(variant, taskType) => onReload(variant, taskType)}
        isWarming={reload.isPending}
      />
    </div>
  );
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
  const [sam, setSam] = useState(samEnum[0] ?? "");
  const [dino, setDino] = useState(dinoEnum[0] ?? "");
  const [genericVariant, setGenericVariant] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      genericGroups.map((group) => [group.key, group.variants?.[0]?.value ?? ""]).filter(([, v]) => v),
    ),
  );
  const canSmoke = samEnum.length > 0 || dinoEnum.length > 0;

  const onSmokeTest = async () => {
    const payload: SmokeTestRequest = canSmoke
      ? { url: target.url, sam_variant: sam || undefined, dino_variant: dino || undefined }
      : { url: target.url, variant: genericVariant };
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
    <div className={styles.card}>
      <div className={styles.cardTop}>
        <Badge variant={target.ok ? "success" : "danger"} dot>
          {target.ok ? "在线" : "离线"}
        </Badge>
        <span className={`mono ${styles.url}`}>{target.url}</span>
        <span className={styles.latency}>{target.latency_ms}ms</span>
      </div>

      {!target.ok ? (
        <div className={styles.noteError}>{target.error ?? "不可达"}</div>
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
            <div className={styles.variantPicker}>
              {samEnum.length > 0 && (
                <select value={sam} onChange={(e) => setSam(e.target.value)} className={styles.select}>
                  {samEnum.map((option) => (
                    <option key={option} value={option}>
                      sam:{option}
                    </option>
                  ))}
                </select>
              )}
              {dinoEnum.length > 0 && (
                <select value={dino} onChange={(e) => setDino(e.target.value)} className={styles.select}>
                  {dinoEnum.map((option) => (
                    <option key={option} value={option}>
                      dino:{option}
                    </option>
                  ))}
                </select>
              )}
              {genericGroups.map((group) => (
                <label key={group.key} className={styles.field}>
                  <span className={styles.label}>{group.title ?? group.key}</span>
                  <select
                    value={genericVariant[group.key] ?? ""}
                    onChange={(e) =>
                      setGenericVariant((value) => ({ ...value, [group.key]: e.target.value }))
                    }
                    className={styles.select}
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
            <div className={styles.note}>该容器不暴露变体目录</div>
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
  gpuInfo?: { memory_used_mb?: number; memory_total_mb?: number } | null;
  pool?: { cap?: number; loaded_variants?: unknown[] } | null;
  videoPool?: { cap?: number; loaded_variants?: string[]; active_sessions?: number } | null;
  cacheHitRate?: number;
}) {
  const loaded = pool?.loaded_variants ?? [];
  const videoLoaded = videoPool?.loaded_variants ?? [];
  return (
    <div className={styles.metrics}>
      {modelVersion && <span className="mono">{modelVersion}</span>}
      {gpuInfo?.memory_used_mb != null && gpuInfo?.memory_total_mb != null && (
        <span>
          GPU {gpuInfo.memory_used_mb}/{gpuInfo.memory_total_mb} MB
        </span>
      )}
      {cacheHitRate != null && <span>cache {(cacheHitRate * 100).toFixed(1)}%</span>}
      <span>
        图像池 {loaded.length}
        {pool?.cap != null && `/${pool.cap}`}
      </span>
      {videoPool && (
        <span>
          视频池 {videoLoaded.length}
          {videoPool.cap != null && `/${videoPool.cap}`}
          {videoPool.active_sessions != null && ` · ${videoPool.active_sessions} 会话`}
        </span>
      )}
    </div>
  );
}
