import { Icon } from "@/components/ui/Icon";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { StatCard } from "@/components/ui/StatCard";
import { useRetryVideoAsset, useStorageBuckets, useVideoAssetFailures } from "@/hooks/useStorage";
import { useDatasets } from "@/hooks/useDatasets";
import { useToastStore } from "@/components/ui/Toast";
import { useQueryClient } from "@tanstack/react-query";
import type { DatasetResponse } from "@/api/datasets";
import type { BucketSummary, VideoAssetFailureItem, VideoAssetKind } from "@/api/storage";
import type { IconName } from "@/components/ui/Icon";
import styles from "./StoragePage.module.css";

const TYPE_ICONS: Record<string, IconName> = {
  image: "image",
  video: "video",
  point_cloud: "cube",
  multimodal: "mm",
  other: "layers",
};

const TYPE_LABELS: Record<string, string> = {
  image: "图像",
  video: "视频",
  point_cloud: "3D 点云",
  multimodal: "多模态",
  other: "其他",
};

const ROLE_LABELS: Record<string, string> = {
  annotations: "标注文件",
  datasets: "数据集文件",
};

const VIDEO_ASSET_LABELS: Record<VideoAssetKind, string> = {
  probe: "Probe",
  poster: "Poster",
  frame_timetable: "Frame timetable",
  chunk: "Chunk",
  frame: "Frame cache",
};

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${units[i]}`;
}

function BucketCard({ bucket }: { bucket: BucketSummary }) {
  const isError = bucket.status === "error";
  return (
    <div className={styles.bucketCard}>
      <div className={isError ? styles.bucketIconError : styles.bucketIconSuccess}>
        <Icon name="db" size={18} className={isError ? styles.dangerIcon : styles.successIcon} />
      </div>
      <div className={styles.bucketMain}>
        <div className={styles.bucketName}>{bucket.name}</div>
        <div className={styles.bucketMeta}>
          {ROLE_LABELS[bucket.role] ?? bucket.role}
          {isError && bucket.error && ` · ${bucket.error}`}
        </div>
      </div>
      <div className={styles.bucketStats}>
        <div className={styles.bucketSize}>{formatBytes(bucket.total_size_bytes)}</div>
        <div className={styles.bucketObjects}>
          {bucket.object_count.toLocaleString()} 个对象
        </div>
      </div>
      <span className={styles.shrinkBadge}>
        <Badge variant={isError ? "danger" : "success"} dot>
          {isError ? "连接失败" : "已连接"}
        </Badge>
      </span>
    </div>
  );
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.infoItem}>
      <div className={styles.infoLabel}>{label}</div>
      <div className={styles.infoValue}>{value}</div>
    </div>
  );
}

function DatasetStorageRow({ ds }: { ds: DatasetResponse & { total_size?: number } }) {
  return (
    <tr>
      <td className={styles.datasetNameCell}>
        <div className={styles.datasetNameWrap}>
          <Icon name={TYPE_ICONS[ds.data_type] || "layers"} size={14} className={styles.mutedIcon} />
          <div>
            <div className={styles.datasetName}>{ds.name}</div>
            <div className={styles.datasetId}>{ds.display_id}</div>
          </div>
        </div>
      </td>
      <td className={styles.datasetCell}>
        <Badge variant="outline">{TYPE_LABELS[ds.data_type] || ds.data_type}</Badge>
      </td>
      <td className={styles.datasetCell}>
        <span className={`mono ${styles.monoValue}`}>{ds.file_count.toLocaleString()}</span>
      </td>
      <td className={styles.datasetCell}>
        <span className={`mono ${styles.monoValue}`}>
          {ds.total_size !== undefined ? formatBytes(ds.total_size) : "—"}
        </span>
      </td>
      <td className={styles.datasetCell}>
        <span className={`mono ${styles.monoValue}`}>{ds.project_count}</span>
      </td>
    </tr>
  );
}

function assetDetail(asset: VideoAssetFailureItem): string {
  if (asset.asset_type === "chunk") return `chunk #${asset.chunk_id ?? "?"}`;
  if (asset.asset_type === "frame") {
    return `frame ${asset.frame_index ?? "?"} · ${asset.width ?? "?"}px ${asset.format ?? ""}`;
  }
  return asset.file_name;
}

function VideoAssetFailuresPanel() {
  const { data, isLoading, isError } = useVideoAssetFailures(50, 0);
  const retry = useRetryVideoAsset();
  const pushToast = useToastStore((s) => s.push);
  const items = data?.items ?? [];

  const onRetry = (asset: VideoAssetFailureItem) => {
    retry.mutate(
      {
        asset_type: asset.asset_type,
        dataset_item_id: asset.dataset_item_id,
        chunk_id: asset.chunk_id,
        frame_index: asset.frame_index,
        width: asset.width,
        format: asset.format === "jpeg" ? "jpeg" : asset.format === "webp" ? "webp" : null,
      },
      {
        onSuccess: () => pushToast({ msg: "已加入 media 重试队列", kind: "success" }),
        onError: (err) =>
          pushToast({ msg: "重试失败", sub: (err as Error).message, kind: "error" }),
      },
    );
  };

  return (
    <div className={styles.failuresPanel}>
      <Card>
      <div className={styles.cardHeaderSplit}>
        <div>
          <h3 className={styles.cardTitle}>视频资产失败</h3>
          <p className={styles.cardDescription}>
            probe、poster、时间表和帧缓存失败会在这里集中处理。
          </p>
        </div>
        <span className={styles.centerBadge}>
          <Badge variant={items.length ? "danger" : "success"} dot>
            {items.length ? `${data?.total ?? items.length} 个失败` : "正常"}
          </Badge>
        </span>
      </div>
      {isLoading ? (
        <div className={styles.emptyState}>加载中...</div>
      ) : isError ? (
        <div className={styles.errorState}>无法加载视频资产状态</div>
      ) : items.length === 0 ? (
        <div className={styles.emptyState}>
          <Icon name="check" size={26} className={styles.emptyIcon} />
          <div>暂无视频资产失败</div>
        </div>
      ) : (
        <div className={styles.tableScroll}>
          <table className={styles.assetTable}>
            <thead>
              <tr className={styles.tableBorderRow}>
                <th className={styles.assetTh}>类型</th>
                <th className={styles.assetTh}>视频</th>
                <th className={styles.assetTh}>项目 / 任务</th>
                <th className={styles.assetTh}>错误</th>
                <th className={styles.assetTh}>更新时间</th>
                <th className={styles.assetTh}>操作</th>
              </tr>
            </thead>
            <tbody>
              {items.map((asset) => (
                <tr key={asset.asset_key} className={styles.tableBorderRow}>
                  <td className={styles.assetTd}>
                    <Badge variant="outline">{VIDEO_ASSET_LABELS[asset.asset_type]}</Badge>
                  </td>
                  <td className={styles.assetTd}>
                    <div className={styles.assetFileName}>{asset.file_name}</div>
                    <div className={styles.assetSubtle}>
                      {assetDetail(asset)}
                    </div>
                  </td>
                  <td className={styles.assetTd}>
                    <div>{asset.project_name ?? "—"}</div>
                    <div className={`mono ${styles.assetSubtle}`}>
                      {asset.task_display_id ?? "—"}
                    </div>
                  </td>
                  <td className={`${styles.assetTd} ${styles.assetErrorCell}`}>
                    <div title={asset.error} className={styles.assetErrorText}>
                      {asset.error}
                    </div>
                  </td>
                  <td className={`${styles.assetTd} ${styles.assetDateCell}`}>
                    {asset.updated_at ? new Date(asset.updated_at).toLocaleString() : "—"}
                  </td>
                  <td className={`${styles.assetTd} ${styles.nowrap}`}>
                    <Button
                      size="sm"
                      variant="primary"
                      disabled={retry.isPending}
                      onClick={() => onRetry(asset)}
                    >
                      <Icon name="refresh" size={11} />
                      重试
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      </Card>
    </div>
  );
}

export function StoragePage() {
  const qc = useQueryClient();
  const { data: bucketsData, isError: bucketsError } = useStorageBuckets();
  const { data: datasetsData } = useDatasets();

  const buckets = bucketsData?.items ?? [];
  const datasets = datasetsData?.items ?? [];
  const totalDatasets = datasetsData?.total ?? 0;

  const handleRefresh = () => {
    qc.invalidateQueries({ queryKey: ["storage-buckets"] });
    qc.invalidateQueries({ queryKey: ["datasets"] });
  };

  return (
    <div className={styles.page}>
      {/* Header */}
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>存储管理</h1>
          <p className={styles.pageDescription}>查看存储后端状态与数据集分布</p>
        </div>
        <Button onClick={handleRefresh}>
          <Icon name="refresh" size={13} /> 刷新状态
        </Button>
      </div>

      {/* Stats */}
      <div className={styles.statsGrid}>
        <StatCard icon="db" label="存储后端" value="MinIO (S3)" />
        <StatCard icon="folder" label="存储桶" value={String(buckets.length)} />
        <StatCard icon="layers" label="数据集数量" value={String(totalDatasets)} />
        <StatCard
          icon="activity"
          label="总容量"
          value={bucketsData ? formatBytes(bucketsData.total_size_bytes) : "—"}
        />
      </div>

      <div className={styles.contentGrid}>
        {/* Storage backends */}
        <Card>
          <div className={styles.cardHeader}>
            <h3 className={styles.cardTitle}>存储桶</h3>
          </div>
          <div className={styles.cardBody}>
            {bucketsError && buckets.length === 0 ? (
              <div className={styles.storageError}>
                <Icon name="db" size={24} className={styles.storageErrorIcon} />
                <div>无法连接存储后端</div>
              </div>
            ) : (
              buckets.map((b) => <BucketCard key={b.name} bucket={b} />)
            )}
            <div className={styles.infoGrid}>
              <InfoItem label="存储类型" value="S3 兼容 (MinIO)" />
              <InfoItem label="协议" value="HTTP (开发环境)" />
              <InfoItem
                label="总对象数"
                value={bucketsData ? bucketsData.total_object_count.toLocaleString() : "—"}
              />
              <InfoItem
                label="总占用空间"
                value={bucketsData ? formatBytes(bucketsData.total_size_bytes) : "—"}
              />
            </div>
          </div>
        </Card>

        {/* Dataset storage overview */}
        <Card>
          <div className={styles.cardHeader}>
            <h3 className={styles.cardTitle}>数据集存储概览</h3>
          </div>
          {datasets.length > 0 ? (
            <table className={styles.datasetTable}>
              <thead>
                <tr>
                  {["数据集", "类型", "文件数", "容量", "关联项目"].map((h, i) => (
                    <th key={i} className={i === 0 ? styles.datasetThFirst : styles.datasetTh}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {datasets.map((ds) => (
                  <DatasetStorageRow key={ds.id} ds={ds as DatasetResponse & { total_size?: number }} />
                ))}
              </tbody>
            </table>
          ) : (
            <div className={styles.emptyDataset}>
              <Icon name="layers" size={28} className={styles.emptyIcon} />
              <div>暂无数据集</div>
            </div>
          )}
        </Card>
      </div>

      <VideoAssetFailuresPanel />
    </div>
  );
}
