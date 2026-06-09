// v0.10.26 · 模型市场「变体」面板 — 模型市场扩展二期 ①「模型版本对比 / AB 路由 UI」的可落地片.
// 把 v0.10.23 ModelPool 的「单容器多变体并存」暴露到 super admin 侧:
//   - 已加载变体 (来自 health_meta.pool.loaded_variants) + 各变体 cache 命中 (cache.buckets) + LRU 近度;
//   - 预热控件: 从 /setup.params 的变体 enum 选 (sam_variant, dino_variant) → reload(variant) 预热进显存.
// 不含加权 AB 路由 / 版本并排对比 (仍 defer, 见 ROADMAP).
// v0.10.36 · 按模态拆为「图像推理变体」+「视频追踪变体」两组:
//   - 图像组行为不变 (走图片池 SAM+DINO);
//   - 视频组读 health_meta.video_pool (loaded_variants: string[]) + /setup.supported_trackers,
//     仅 SAM 单下拉 (无 DINO), 预热调 onWarm({sam_variant}, "video") 预热独立 video tracker 池.

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import {
  mlBackendsApi,
  type MLBackendSupportedVariantGroup,
  type MLBackendVariant,
  type MLModelCapability,
} from "@/api/ml-backends";
import type { MLBackendItem } from "@/api/adminMlIntegrations";
import {
  loadedKeysAsGsam2ImageVariants,
  loadedKeysLastUsedMap,
  gsam2ImageVariantsAsCacheBucketKey,
  gsam2ImageVariantsAsLoadedKey,
} from "./poolKeyParse";
import styles from "./VariantPanel.module.css";

interface EnumField {
  enum?: string[];
  default?: string;
}

export interface VariantWarmTarget {
  task?: string;
  variants?: MLBackendVariant;
  taskType?: "image" | "video";
}

// v0.10.36 · SAM2 视频 tracker 变体常量 (图片侧 /setup.params.sam_variant.enum 缺失时回退用).
const SAM2_VIDEO_VARIANTS = ["tiny", "small", "base_plus", "large"];

export function VariantPanel({
  projectId,
  backend,
  onWarm,
  isWarming,
}: {
  projectId: string;
  backend: MLBackendItem;
  onWarm: (target?: VariantWarmTarget) => void;
  isWarming: boolean;
}) {
  const { data: setup, isLoading, isError } = useQuery({
    queryKey: ["ml-backend-setup", projectId, backend.id],
    queryFn: () => mlBackendsApi.setup(projectId, backend.id),
    staleTime: 30_000,
  });

  const props = (setup?.params?.properties ?? {}) as Record<string, EnumField>;
  const samField = props.sam_variant;
  const dinoField = props.dino_variant;
  const samEnum = samField?.enum ?? [];
  const dinoEnum = dinoField?.enum ?? [];
  const supportsVariants = samEnum.length > 0 || dinoEnum.length > 0;
  const genericVariantGroups = (setup?.supported_variants ?? []).filter(
    (group) => Array.isArray(group.variants) && group.variants.length > 0,
  );
  const modalities = backend.health_meta?.capabilities?.modalities ?? [];
  const hasModalitySnapshot = modalities.length > 0;

  const pool = backend.health_meta?.pool;
  const buckets = backend.health_meta?.cache?.buckets ?? {};
  // v0.14.14: 优先读协议 PoolStatus.loaded_keys (key="sam=X/dino=Y"); 老字段
  // loaded_variants/per_variant_lru_ts 作 fallback (gsam2 双发期; 旧 backend 兼容).
  const loaded = useMemo(() => {
    const fromKeys = loadedKeysAsGsam2ImageVariants(pool?.loaded_keys);
    if (fromKeys.length > 0) return fromKeys;
    return pool?.loaded_variants ?? [];
  }, [pool?.loaded_keys, pool?.loaded_variants]);
  // last_used 兼容: 新 backend 走 loaded_keys[*].last_used_at (ISO → 秒-ago);
  // 老 backend 走 per_variant_lru_ts (相对 monotonic_seconds). 展示语义略有偏差
  // (一个是 "t-Xs", 一个是 "t+Xs"), 这里统一 fallback 用老逻辑.
  const lruTs = useMemo(() => {
    if (pool?.loaded_keys && pool.loaded_keys.length > 0) {
      return loadedKeysLastUsedMap(pool.loaded_keys);
    }
    return pool?.per_variant_lru_ts ?? {};
  }, [pool?.loaded_keys, pool?.per_variant_lru_ts]);
  const useRelativeAgo = (pool?.loaded_keys?.length ?? 0) > 0;

  // v0.10.36 · 视频追踪: 独立 video 池 + supported_trackers.
  const videoPool = backend.health_meta?.video_pool;
  const hasVideoMeta = backend.health_meta != null && "video_pool" in backend.health_meta;
  const supportedTrackers = setup?.supported_trackers ?? [];
  const supportsVideo = supportedTrackers.length > 0;
  const showImageGroup = hasModalitySnapshot
    ? modalities.includes("image")
    : supportsVariants || genericVariantGroups.length > 0;
  const showVideoGroup = hasModalitySnapshot ? modalities.includes("video") : supportsVideo;
  // v0.14.14: video pool 同样优先 loaded_keys (key 就是 sam_variant 字符串).
  const videoLoaded = useMemo<string[]>(() => {
    const keys = videoPool?.loaded_keys;
    if (keys && keys.length > 0) return keys.map((k) => k.key);
    return videoPool?.loaded_variants ?? [];
  }, [videoPool?.loaded_keys, videoPool?.loaded_variants]);
  // 视频 SAM 候选: 优先复用图片侧 enum, 否则用 SAM2 视频变体常量.
  const videoSamEnum = samEnum.length > 0 ? samEnum : SAM2_VIDEO_VARIANTS;

  const [sam, setSam] = useState("");
  const [dino, setDino] = useState("");
  const [videoSam, setVideoSam] = useState("");
  // 预热/变体面板默认收起 — 运行时观测一屏多个 backend, 展开后(尤其多任务 YOLO)很长.
  const [collapsed, setCollapsed] = useState(true);

  // setup 到达后填默认变体 (首挂载时 enum 还是空, useState 初值填不进).
  useEffect(() => {
    if (samEnum.length > 0 && !sam) setSam(samField?.default ?? samEnum[0]);
    if (dinoEnum.length > 0 && !dino) setDino(dinoField?.default ?? dinoEnum[0]);
    if (videoSamEnum.length > 0 && !videoSam) setVideoSam(videoSamEnum[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setup]);

  if (isLoading) return <div className={styles.note}>加载变体能力…</div>;
  if (isError) return <div className={styles.noteError}>无法获取 /setup（后端不可达或未实现）</div>;

  const isMultiModelBackend =
    !supportsVariants && genericVariantGroups.length === 0 && (setup?.models?.length ?? 0) > 0;

  const isSelectedLoaded = loaded.some(
    (v) => v.sam_variant === sam && v.dino_variant === dino,
  );
  const isVideoSelectedLoaded = videoLoaded.includes(videoSam);

  const body = isMultiModelBackend ? (
    setup!.models!.map((model) => (
      <ModelVariantWarmSection
        key={model.id}
        model={model}
        loadedKeys={pool?.loaded_keys?.map((key) => key.key) ?? []}
        isWarming={isWarming}
        onWarm={onWarm}
      />
    ))
  ) : (
    <>
      {/* 图像推理变体 (走图片池); v0.10.41 起优先按持久化 modalities 门控, 未探测时回落旧 enum 判断. */}
      {showImageGroup && (
        <>
          {genericVariantGroups.length > 0 && (
            <div className={styles.section}>
              <div className={styles.sectionTitle}>通用变体目录</div>
              <GenericVariantDirectory groups={genericVariantGroups} />
              {!supportsVariants && (
                <div className={styles.hint}>该 backend 暂未实现通用 warm 接口，变体目录仅用于只读展示。</div>
              )}
            </div>
          )}

          <div className={styles.section}>
            <div className={styles.sectionTitle}>
              图像推理变体 · 已加载
              {pool?.cap != null && (
                <span className={styles.cap}>
                  {loaded.length}/{pool.cap}
                </span>
              )}
            </div>
            {loaded.length === 0 ? (
              <div className={styles.note}>暂无变体常驻显存（idle 卸载或未预热）</div>
            ) : (
              <div className={styles.tableScroller}>
                <table className={styles.variantTable}>
                  <thead>
                    <tr>
                      {["变体", "cache 命中", "最近使用"].map((h) => (
                        <th key={h}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {loaded.map((v) => {
                      // bucket key 用老语义 ("sam/dino") 不变 — cache.buckets 由 backend
                      // 自己产生, 仍是这个 key 形式.
                      const bucketKey = gsam2ImageVariantsAsCacheBucketKey(v);
                      // lru key 取决于来源: 新 loaded_keys 用 "sam=X/dino=Y" 作 key,
                      // 老 per_variant_lru_ts 用 "sam/dino" 作 key.
                      const lruKey = useRelativeAgo
                        ? gsam2ImageVariantsAsLoadedKey(v)
                        : bucketKey;
                      const bucket = buckets[bucketKey];
                      const ts = lruTs[lruKey];
                      return (
                        <tr key={bucketKey}>
                          <td className={styles.variantCell} title={bucketKey}>
                            <span className="mono">{bucketKey}</span>
                          </td>
                          <td className={styles.metricCell}>
                            {bucket?.hit_rate != null
                              ? `${(bucket.hit_rate * 100).toFixed(1)}% (${bucket.hits ?? 0}/${(bucket.hits ?? 0) + (bucket.misses ?? 0)})`
                              : "—"}
                          </td>
                          <td className={styles.muted}>
                            {ts != null
                              ? (useRelativeAgo ? `t-${ts.toFixed(0)}s` : `t+${ts.toFixed(0)}s`)
                              : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className={styles.section}>
            <div className={styles.sectionTitle}>图像推理变体 · 预热</div>
            <div className={styles.warmRow}>
              {samEnum.length > 0 && (
                <label className={styles.field}>
                  <span className={styles.label}>SAM</span>
                  <select value={sam} onChange={(e) => setSam(e.target.value)} className={styles.select}>
                    {samEnum.map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {dinoEnum.length > 0 && (
                <label className={styles.field}>
                  <span className={styles.label}>DINO</span>
                  <select value={dino} onChange={(e) => setDino(e.target.value)} className={styles.select}>
                    {dinoEnum.map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <Button
                size="sm"
                onClick={() => onWarm({
                  variants: {
                    ...(sam ? { sam_variant: sam } : {}),
                    ...(dino ? { dino_variant: dino } : {}),
                  },
                })}
                disabled={isWarming || !supportsVariants}
                title={supportsVariants ? "预热旧 SAM/DINO 变体" : "待 backend 实现通用 warm 接口"}
              >
                <Icon name="play" size={11} />
                预热
              </Button>
              {isSelectedLoaded && <Badge variant="success">已在显存</Badge>}
            </div>
            <div className={styles.hint}>
              预热把所选变体载入 pool（受 cap 限制，超出按 LRU 驱逐）；预热后请「健康检查」刷新上表。
            </div>
          </div>
        </>
      )}

      {/* v0.10.36 · 视频追踪变体 (走独立 video tracker 池, 仅 SAM 无 DINO). */}
      {showVideoGroup && (
        <div className={styles.section}>
          <div className={styles.sectionTitle}>
            视频追踪变体 · 已加载（视频池）
            {videoPool?.cap != null && (
              <span className={styles.cap}>
                {videoLoaded.length}/{videoPool.cap}
                {videoPool.active_sessions != null && ` · ${videoPool.active_sessions} 会话`}
              </span>
            )}
          </div>
          {!hasVideoMeta ? (
            <div className={styles.note}>该 backend 未上报 video 观测</div>
          ) : (
            <>
              {videoLoaded.length === 0 ? (
                <div className={styles.note}>视频池暂无常驻变体（首次追踪自动冷启）</div>
              ) : (
                <div className={styles.tableScroller}>
                  <table className={styles.variantTable}>
                    <thead>
                      <tr>
                        <th>SAM 变体</th>
                      </tr>
                    </thead>
                    <tbody>
                      {videoLoaded.map((v) => (
                        <tr key={v}>
                          <td className={styles.variantCell} title={v}>
                            <span className="mono">{v}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div className={styles.warmRow}>
                <label className={styles.field}>
                  <span className={styles.label}>SAM</span>
                  <select
                    value={videoSam}
                    onChange={(e) => setVideoSam(e.target.value)}
                    className={styles.select}
                  >
                    {videoSamEnum.map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                </label>
                <Button
                  size="sm"
                  onClick={() => onWarm({
                    taskType: "video",
                    variants: videoSam ? { sam_variant: videoSam } : {},
                  })}
                  disabled={isWarming}
                >
                  <Icon name="play" size={11} />
                  预热
                </Button>
                {isVideoSelectedLoaded && <Badge variant="success">已在显存</Badge>}
              </div>
              <div className={styles.hint}>
                视频追踪池首次请求自动冷启；预热可提前载入显存。tracker 不使用 DINO。
              </div>
            </>
          )}
        </div>
      )}
    </>
  );

  return (
    <div className={styles.panel}>
      <button
        type="button"
        className={styles.collapseHeader}
        onClick={() => setCollapsed((c) => !c)}
        aria-expanded={!collapsed}
      >
        <Icon name={collapsed ? "chevRight" : "chevDown"} size={12} />
        <span className={styles.collapseTitle}>模型预热 · 变体</span>
        <span className={styles.collapseHint}>{collapsed ? "展开" : "收起"}</span>
      </button>
      {!collapsed && <div className={styles.collapseBody}>{body}</div>}
    </div>
  );
}

function ModelVariantWarmSection({
  model,
  loadedKeys,
  isWarming,
  onWarm,
}: {
  model: MLModelCapability;
  loadedKeys: string[];
  isWarming: boolean;
  onWarm: (target?: VariantWarmTarget) => void;
}) {
  const groups = (model.supported_variants ?? []).filter(
    (group) => Array.isArray(group.variants) && group.variants.length > 0,
  );
  const [variants, setVariants] = useState<Record<string, string>>(() => pickInitialVariants(model));

  useEffect(() => {
    setVariants(pickInitialVariants(model));
  }, [model]);

  const selectedKey = selectedLoadedKey(model.task, variants);
  const isLoaded = selectedKey ? loadedKeys.includes(selectedKey) : false;

  if (groups.length === 0) {
    return (
      <div className={styles.section}>
        <div className={styles.sectionTitle}>{model.display_name ?? model.id}</div>
        <div className={styles.note}>该 model 无可选变体</div>
      </div>
    );
  }

  return (
    <div className={styles.section}>
      <div className={styles.sectionTitle}>
        {model.task ?? model.id}
        <span className={styles.cap}>{model.display_name ?? model.id}</span>
      </div>
      <div className={styles.warmRow}>
        {groups.map((group, idx) => {
          const options = filterModelOptions(model, groups, idx, variants);
          return (
            <label key={group.key} className={styles.field}>
              <span className={styles.label}>{group.title ?? group.key}</span>
              <select
                value={variants[group.key] ?? ""}
                onChange={(event) =>
                  setVariants((current) => sanitizeVariantSelection(
                    model,
                    groups,
                    { ...current, [group.key]: event.target.value },
                  ))
                }
                className={styles.select}
              >
                {options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label ?? option.value}
                    {option.vram_gb != null ? ` · ${option.vram_gb}GB` : ""}
                    {option.tier ? ` · ${option.tier}` : ""}
                  </option>
                ))}
              </select>
            </label>
          );
        })}
        <Button
          size="sm"
          onClick={() => onWarm({ task: model.task, variants })}
          disabled={isWarming || Object.keys(variants).length === 0}
        >
          <Icon name="play" size={11} />
          预热
        </Button>
        {isLoaded && <Badge variant="success">已在显存</Badge>}
      </div>
      <GenericVariantDirectory groups={groups} />
    </div>
  );
}

function pickInitialVariants(model: MLModelCapability): Record<string, string> {
  const out: Record<string, string> = { ...(model.default_variants ?? {}) };
  for (const group of model.supported_variants ?? []) {
    if (out[group.key]) continue;
    const options = group.variants ?? [];
    const recommended = options.find((option) => option.recommended);
    const picked = recommended ?? options[0];
    if (picked?.value) out[group.key] = picked.value;
  }
  return sanitizeVariantSelection(
    model,
    (model.supported_variants ?? []).filter(
      (group) => Array.isArray(group.variants) && group.variants.length > 0,
    ),
    out,
  );
}

function filterModelOptions(
  model: MLModelCapability,
  groups: MLBackendSupportedVariantGroup[],
  axisIndex: number,
  variants: Record<string, string>,
) {
  const group = groups[axisIndex]!;
  const options = group.variants ?? [];
  const combos = model.variant_combinations ?? [];
  if (combos.length === 0) return options;
  const allowed = new Set<string>();
  for (const combo of combos) {
    let matches = true;
    for (let i = 0; i < axisIndex; i++) {
      const key = groups[i]!.key;
      if (variants[key] && combo[i] !== variants[key]) {
        matches = false;
        break;
      }
    }
    if (matches && combo[axisIndex]) allowed.add(combo[axisIndex]!);
  }
  const filtered = options.filter((option) => allowed.has(option.value));
  return filtered.length > 0 ? filtered : options;
}

function sanitizeVariantSelection(
  model: MLModelCapability,
  groups: MLBackendSupportedVariantGroup[],
  variants: Record<string, string>,
): Record<string, string> {
  const next = { ...variants };
  for (let idx = 0; idx < groups.length; idx++) {
    const options = filterModelOptions(model, groups, idx, next);
    const current = next[groups[idx]!.key];
    if (!current || !options.some((option) => option.value === current)) {
      const recommended = options.find((option) => option.recommended);
      next[groups[idx]!.key] = (recommended ?? options[0])?.value ?? "";
    }
  }
  return Object.fromEntries(Object.entries(next).filter(([, value]) => value));
}

function selectedLoadedKey(task: string | undefined, variants: Record<string, string>): string | null {
  const series = variants.series;
  const size = variants.size;
  if (task && series && size) return `${series}/${size}/${task}`;
  if (variants.sam_variant && variants.dino_variant) {
    return `sam=${variants.sam_variant}/dino=${variants.dino_variant}`;
  }
  if (variants.model_variant) return variants.model_variant;
  return null;
}

function GenericVariantDirectory({ groups }: { groups: MLBackendSupportedVariantGroup[] }) {
  return (
    <div className={styles.genericGrid}>
      {groups.map((group) => (
        <div key={group.key} className={styles.genericGroup}>
          <div className={styles.genericTitle}>{group.title ?? group.key}</div>
          <div className={styles.genericOptions}>
            {group.variants!.map((option) => (
              <span key={option.value} className={option.recommended ? `${styles.genericPill} ${styles.genericPillOn}` : styles.genericPill}>
                <span className="mono">{option.label ?? option.value}</span>
                {option.vram_gb != null && <span className={styles.genericMeta}> · {option.vram_gb}GB</span>}
                {option.tier && <span className={styles.genericMeta}> · {option.tier}</span>}
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
