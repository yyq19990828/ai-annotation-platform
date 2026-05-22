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
import { mlBackendsApi, type MLBackendVariant } from "@/api/ml-backends";
import type { MLBackendItem } from "@/api/adminMlIntegrations";
import styles from "./VariantPanel.module.css";

interface EnumField {
  enum?: string[];
  default?: string;
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
  // v0.10.36 · taskType 透传给 reload: "video" 预热独立 video tracker 池.
  onWarm: (variant: MLBackendVariant, taskType?: "image" | "video") => void;
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

  const pool = backend.health_meta?.pool;
  const buckets = backend.health_meta?.cache?.buckets ?? {};
  const lruTs = pool?.per_variant_lru_ts ?? {};
  const loaded = useMemo(() => pool?.loaded_variants ?? [], [pool?.loaded_variants]);

  // v0.10.36 · 视频追踪: 独立 video 池 + supported_trackers.
  const videoPool = backend.health_meta?.video_pool;
  const hasVideoMeta = backend.health_meta != null && "video_pool" in backend.health_meta;
  const supportedTrackers = setup?.supported_trackers ?? [];
  const supportsVideo = supportedTrackers.length > 0;
  const videoLoaded = useMemo(() => videoPool?.loaded_variants ?? [], [videoPool?.loaded_variants]);
  // 视频 SAM 候选: 优先复用图片侧 enum, 否则用 SAM2 视频变体常量.
  const videoSamEnum = samEnum.length > 0 ? samEnum : SAM2_VIDEO_VARIANTS;

  const [sam, setSam] = useState("");
  const [dino, setDino] = useState("");
  const [videoSam, setVideoSam] = useState("");

  // setup 到达后填默认变体 (首挂载时 enum 还是空, useState 初值填不进).
  useEffect(() => {
    if (samEnum.length > 0 && !sam) setSam(samField?.default ?? samEnum[0]);
    if (dinoEnum.length > 0 && !dino) setDino(dinoField?.default ?? dinoEnum[0]);
    if (videoSamEnum.length > 0 && !videoSam) setVideoSam(videoSamEnum[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setup]);

  if (isLoading) return <div className={styles.note}>加载变体能力…</div>;
  if (isError) return <div className={styles.noteError}>无法获取 /setup（后端不可达或未实现）</div>;

  const isSelectedLoaded = loaded.some(
    (v) => v.sam_variant === sam && v.dino_variant === dino,
  );
  const isVideoSelectedLoaded = videoLoaded.includes(videoSam);

  return (
    <div className={styles.panel}>
      {/* 图像推理变体 (走图片池, 行为不变); 仅当 /setup.params 有 image 变体 enum 时显示. */}
      {supportsVariants && (
        <>
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
                      const key = `${v.sam_variant}/${v.dino_variant}`;
                      const bucket = buckets[key];
                      const ts = lruTs[key];
                      return (
                        <tr key={key}>
                          <td className={styles.variantCell} title={key}>
                            <span className="mono">{key}</span>
                          </td>
                          <td className={styles.metricCell}>
                            {bucket?.hit_rate != null
                              ? `${(bucket.hit_rate * 100).toFixed(1)}% (${bucket.hits ?? 0}/${(bucket.hits ?? 0) + (bucket.misses ?? 0)})`
                              : "—"}
                          </td>
                          <td className={styles.muted}>{ts != null ? `t+${ts.toFixed(0)}s` : "—"}</td>
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
                onClick={() => onWarm({ sam_variant: sam || undefined, dino_variant: dino || undefined })}
                disabled={isWarming}
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
      <div className={styles.section}>
        <div className={styles.sectionTitle}>
          视频追踪变体 · 已加载（视频池）
          {supportsVideo && videoPool?.cap != null && (
            <span className={styles.cap}>
              {videoLoaded.length}/{videoPool.cap}
              {videoPool.active_sessions != null && ` · ${videoPool.active_sessions} 会话`}
            </span>
          )}
        </div>
        {!supportsVideo ? (
          <div className={styles.note}>该后端不支持视频追踪</div>
        ) : !hasVideoMeta ? (
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
                onClick={() => onWarm({ sam_variant: videoSam || undefined }, "video")}
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
    </div>
  );
}
