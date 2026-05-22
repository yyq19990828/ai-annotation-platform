// v0.10.26 · 模型市场「容器直连观测」面板.
// 与项目注册解耦: 没有任何项目注册 backend 时, 运维也能直连 env 配的 ML_BACKEND_OBSERVE_URLS
// 看健康度 / 已加载变体 / 变体目录, 并对每个变体「试启动」(空池时 warm→自动 unload 验证可加载性).
// registered 标记提示该 URL 已被项目占用, 避免与注册 backend 生命周期冲突.

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { useToastStore } from "@/components/ui/Toast";
import {
  adminMlIntegrationsApi,
  type ObserveTarget,
  type SmokeTestRequest,
} from "@/api/adminMlIntegrations";
import styles from "./ObserveBackendsPanel.module.css";

export function ObserveBackendsPanel() {
  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ["admin", "ml-integrations", "observe"],
    queryFn: () => adminMlIntegrationsApi.observe(),
    refetchInterval: 60_000,
  });

  // configured_count=0 → 未配 ML_BACKEND_OBSERVE_URLS, 不渲染面板 (避免空噪音).
  if (!isLoading && !isError && data && data.configured_count === 0) return null;

  return (
    <div className={styles.wrap}>
    <Card>
      <div className={styles.header}>
        <div className={styles.headerTitle}>
          <Icon name="bot" size={14} className={styles.mutedIcon} />
          <h3 className={styles.title}>AI 后端容器（直连观测）</h3>
          {data && <span className={styles.meta}>{data.configured_count} 个配置容器</span>}
        </div>
        <Button size="sm" onClick={() => refetch()} disabled={isFetching} title="刷新探测">
          <Icon name="refresh" size={11} />
        </Button>
      </div>

      {isLoading ? (
        <div className={styles.note}>探测中…</div>
      ) : isError ? (
        <div className={styles.noteError}>加载失败：{(error as Error)?.message ?? "未知错误"}</div>
      ) : (
        <div className={styles.list}>
          {data?.targets.map((t) => (
            <TargetCard key={t.url} target={t} />
          ))}
        </div>
      )}
    </Card>
    </div>
  );
}

function TargetCard({ target: t }: { target: ObserveTarget }) {
  const pushToast = useToastStore((s) => s.push);
  const [busy, setBusy] = useState(false);
  const samEnum = t.variant_catalog?.sam_variant ?? [];
  const dinoEnum = t.variant_catalog?.dino_variant ?? [];
  const [sam, setSam] = useState(samEnum[0] ?? "");
  const [dino, setDino] = useState(dinoEnum[0] ?? "");
  const loaded = t.pool?.loaded_variants ?? [];
  // v0.10.36 · 视频追踪观测: supported_trackers + 独立 video 池.
  const supportedTrackers = t.supported_trackers ?? [];
  const supportsVideo = supportedTrackers.length > 0;
  const hasVideoMeta = "video_pool" in t;
  const videoLoaded = t.video_pool?.loaded_variants ?? [];

  const onSmokeTest = async () => {
    const payload: SmokeTestRequest = {
      url: t.url,
      sam_variant: sam || undefined,
      dino_variant: dino || undefined,
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
    <div className={styles.card}>
      <div className={styles.cardTop}>
        <Badge variant={t.ok ? "success" : "danger"} dot>
          {t.ok ? "在线" : "离线"}
        </Badge>
        <span className={`mono ${styles.url}`}>{t.url}</span>
        <span className={styles.latency}>{t.latency_ms}ms</span>
        {t.registered && (
          <span title="此 URL 已被项目注册占用">
            <Badge variant="outline">已注册：{t.registered_label}</Badge>
          </span>
        )}
      </div>

      {!t.ok ? (
        <div className={styles.noteError}>{t.error ?? "不可达"}</div>
      ) : (
        <>
          <div className={styles.metaRow}>
            {t.model_version && <span className="mono">{t.model_version}</span>}
            {t.gpu_info?.memory_used_mb != null && t.gpu_info?.memory_total_mb != null && (
              <span>
                GPU {t.gpu_info.memory_used_mb}/{t.gpu_info.memory_total_mb} MB
              </span>
            )}
          </div>

          {/* 图像推理: 图片池已加载变体 (行为不变). */}
          <div className={styles.metaRow}>
            <span className={styles.groupLabel}>图像推理</span>
            <span>
              已加载{" "}
              {loaded.length === 0
                ? "无（空池）"
                : loaded.map((v) => `${v.sam_variant}/${v.dino_variant}`).join("、")}
              {t.pool?.cap != null && `（${loaded.length}/${t.pool.cap}）`}
            </span>
          </div>

          {/* v0.10.36 · 视频追踪: 独立 video 池 + supported_trackers. */}
          <div className={styles.metaRow}>
            <span className={styles.groupLabel}>视频追踪</span>
            {!supportsVideo ? (
              <span>不支持视频追踪</span>
            ) : !hasVideoMeta ? (
              <span>未上报 video 观测</span>
            ) : (
              <span>
                已加载{" "}
                {videoLoaded.length === 0 ? "无（空池）" : videoLoaded.join("、")}
                {t.video_pool?.cap != null && `（${videoLoaded.length}/${t.video_pool.cap}）`}
                {t.video_pool?.active_sessions != null && ` · ${t.video_pool.active_sessions} 会话`}
              </span>
            )}
          </div>

          {!t.supports_variants ? (
            <div className={styles.note}>该容器不暴露变体目录（/setup 无变体 enum）</div>
          ) : (
            <div className={styles.warmRow}>
              {samEnum.length > 0 && (
                <select value={sam} onChange={(e) => setSam(e.target.value)} className={styles.select}>
                  {samEnum.map((o) => (
                    <option key={o} value={o}>
                      sam:{o}
                    </option>
                  ))}
                </select>
              )}
              {dinoEnum.length > 0 && (
                <select value={dino} onChange={(e) => setDino(e.target.value)} className={styles.select}>
                  {dinoEnum.map((o) => (
                    <option key={o} value={o}>
                      dino:{o}
                    </option>
                  ))}
                </select>
              )}
              <Button size="sm" onClick={onSmokeTest} disabled={busy} title="空池时 warm→自动卸载验证可加载性">
                <Icon name="play" size={11} />
                试启动
              </Button>
            </div>
          )}
          <div className={styles.hint}>
            「试启动」仅在容器空池时执行（warm→自动卸载还原）；已有变体常驻时只确认可加载性、不挤显存。
          </div>
        </>
      )}
    </div>
  );
}
