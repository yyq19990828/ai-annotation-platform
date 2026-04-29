import { Icon } from "@/components/ui/Icon";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { StatCard } from "@/components/ui/StatCard";
import { useStorageBuckets } from "@/hooks/useStorage";
import { useDatasets } from "@/hooks/useDatasets";
import { useQueryClient } from "@tanstack/react-query";
import type { DatasetResponse } from "@/api/datasets";
import type { BucketSummary } from "@/api/storage";
import type { IconName } from "@/components/ui/Icon";

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
    <div style={{
      display: "flex", alignItems: "center", gap: 12,
      padding: 14, borderRadius: "var(--radius-lg)",
      border: "1px solid var(--color-border)", background: "var(--color-bg-elev)",
      marginBottom: 10,
    }}>
      <div style={{
        width: 38, height: 38, borderRadius: 8, flexShrink: 0,
        background: isError ? "oklch(0.95 0.05 25)" : "oklch(0.95 0.05 152)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <Icon name="db" size={18} style={{ color: isError ? "var(--color-danger)" : "var(--color-success)" }} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 13 }}>{bucket.name}</div>
        <div style={{ fontSize: 11.5, color: "var(--color-fg-muted)", marginTop: 1 }}>
          {ROLE_LABELS[bucket.role] ?? bucket.role}
          {isError && bucket.error && ` · ${bucket.error}`}
        </div>
      </div>
      <div style={{ textAlign: "right", flexShrink: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>{formatBytes(bucket.total_size_bytes)}</div>
        <div style={{ fontSize: 11, color: "var(--color-fg-subtle)", marginTop: 1 }}>
          {bucket.object_count.toLocaleString()} 个对象
        </div>
      </div>
      <Badge variant={isError ? "danger" : "success"} dot style={{ flexShrink: 0 }}>
        {isError ? "连接失败" : "已连接"}
      </Badge>
    </div>
  );
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ padding: "10px 12px", background: "var(--color-bg-sunken)", borderRadius: "var(--radius-md)" }}>
      <div style={{ fontSize: 11, color: "var(--color-fg-subtle)", marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 500 }}>{value}</div>
    </div>
  );
}

function DatasetStorageRow({ ds }: { ds: DatasetResponse & { total_size?: number } }) {
  return (
    <tr>
      <td style={{ padding: "10px 12px 10px 16px", borderBottom: "1px solid var(--color-border)", verticalAlign: "middle" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Icon name={TYPE_ICONS[ds.data_type] || "layers"} size={14} style={{ color: "var(--color-fg-muted)" }} />
          <div>
            <div style={{ fontWeight: 500, fontSize: 13 }}>{ds.name}</div>
            <div style={{ fontSize: 11, color: "var(--color-fg-subtle)" }}>{ds.display_id}</div>
          </div>
        </div>
      </td>
      <td style={{ padding: "10px 12px", borderBottom: "1px solid var(--color-border)", verticalAlign: "middle" }}>
        <Badge variant="outline">{TYPE_LABELS[ds.data_type] || ds.data_type}</Badge>
      </td>
      <td style={{ padding: "10px 12px", borderBottom: "1px solid var(--color-border)", verticalAlign: "middle" }}>
        <span className="mono" style={{ fontSize: 13 }}>{ds.file_count.toLocaleString()}</span>
      </td>
      <td style={{ padding: "10px 12px", borderBottom: "1px solid var(--color-border)", verticalAlign: "middle" }}>
        <span className="mono" style={{ fontSize: 13 }}>
          {ds.total_size !== undefined ? formatBytes(ds.total_size) : "—"}
        </span>
      </td>
      <td style={{ padding: "10px 12px", borderBottom: "1px solid var(--color-border)", verticalAlign: "middle" }}>
        <span className="mono" style={{ fontSize: 13 }}>{ds.project_count}</span>
      </td>
    </tr>
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
    <div style={{ padding: "20px 28px 40px", maxWidth: 1480, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 24, marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 600, margin: "0 0 4px", letterSpacing: "-0.01em" }}>存储管理</h1>
          <p style={{ color: "var(--color-fg-muted)", fontSize: 13, margin: 0 }}>查看存储后端状态与数据集分布</p>
        </div>
        <Button onClick={handleRefresh}>
          <Icon name="refresh" size={13} /> 刷新状态
        </Button>
      </div>

      {/* Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 20 }}>
        <StatCard icon="db" label="存储后端" value="MinIO (S3)" />
        <StatCard icon="folder" label="存储桶" value={String(buckets.length)} />
        <StatCard icon="layers" label="数据集数量" value={String(totalDatasets)} />
        <StatCard
          icon="activity"
          label="总容量"
          value={bucketsData ? formatBytes(bucketsData.total_size_bytes) : "—"}
        />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        {/* Storage backends */}
        <Card>
          <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--color-border)" }}>
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>存储桶</h3>
          </div>
          <div style={{ padding: 16 }}>
            {bucketsError && buckets.length === 0 ? (
              <div style={{ padding: "20px 0", textAlign: "center", color: "var(--color-danger)", fontSize: 13 }}>
                <Icon name="db" size={24} style={{ opacity: 0.4, marginBottom: 6 }} />
                <div>无法连接存储后端</div>
              </div>
            ) : (
              buckets.map((b) => <BucketCard key={b.name} bucket={b} />)
            )}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 4 }}>
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
          <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--color-border)" }}>
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>数据集存储概览</h3>
          </div>
          {datasets.length > 0 ? (
            <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0, fontSize: 13 }}>
              <thead>
                <tr>
                  {["数据集", "类型", "文件数", "容量", "关联项目"].map((h, i) => (
                    <th key={i} style={{
                      textAlign: "left", fontWeight: 500, fontSize: 11,
                      color: "var(--color-fg-muted)", padding: "8px 12px",
                      borderBottom: "1px solid var(--color-border)",
                      background: "var(--color-bg-sunken)",
                      ...(i === 0 ? { paddingLeft: 16 } : {}),
                    }}>{h}</th>
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
            <div style={{ padding: "32px 16px", textAlign: "center", color: "var(--color-fg-subtle)", fontSize: 13 }}>
              <Icon name="layers" size={28} style={{ opacity: 0.25, marginBottom: 8 }} />
              <div>暂无数据集</div>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
