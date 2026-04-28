import { Icon } from "@/components/ui/Icon";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { StatCard } from "@/components/ui/StatCard";
import { useStorageHealth } from "@/hooks/useStorage";
import { useDatasets } from "@/hooks/useDatasets";
import { useQueryClient } from "@tanstack/react-query";
import type { DatasetResponse } from "@/api/datasets";
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

function StorageBackendCard({ status, bucket, isError }: { status: string; bucket: string; isError: boolean }) {
  return (
    <Card>
      <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--color-border)" }}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>存储后端</h3>
      </div>
      <div style={{ padding: 16 }}>
        <div style={{
          display: "flex", alignItems: "center", gap: 12,
          padding: 16, borderRadius: "var(--radius-lg)",
          border: "1px solid var(--color-border)", background: "var(--color-bg-elev)",
        }}>
          <div style={{
            width: 40, height: 40, borderRadius: 8,
            background: isError ? "oklch(0.95 0.05 25)" : "oklch(0.95 0.05 152)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <Icon name="db" size={20} style={{ color: isError ? "var(--color-danger)" : "var(--color-success)" }} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, fontSize: 14 }}>MinIO 对象存储</div>
            <div style={{ fontSize: 12, color: "var(--color-fg-muted)", marginTop: 2 }}>S3 兼容存储 · 存储桶: {bucket}</div>
          </div>
          <Badge variant={isError ? "danger" : "success"} dot>
            {isError ? "连接失败" : "已连接"}
          </Badge>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 16 }}>
          <InfoItem label="存储类型" value="S3 兼容 (MinIO)" />
          <InfoItem label="存储桶" value={bucket} />
          <InfoItem label="协议" value="HTTP (开发环境)" />
          <InfoItem label="状态" value={status === "ok" ? "正常运行" : "异常"} />
        </div>
      </div>
    </Card>
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

function DatasetStorageRow({ ds }: { ds: DatasetResponse }) {
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
        <span className="mono" style={{ fontSize: 13 }}>{ds.project_count}</span>
      </td>
    </tr>
  );
}

export function StoragePage() {
  const qc = useQueryClient();
  const { data: health, isError } = useStorageHealth();
  const { data: datasetsData } = useDatasets();

  const datasets = datasetsData?.items ?? [];
  const totalDatasets = datasetsData?.total ?? 0;
  const bucket = health?.bucket ?? "annotations";
  const status = health?.status ?? "unknown";

  return (
    <div style={{ padding: "20px 28px 40px", maxWidth: 1480, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 24, marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 600, margin: "0 0 4px", letterSpacing: "-0.01em" }}>存储管理</h1>
          <p style={{ color: "var(--color-fg-muted)", fontSize: 13, margin: 0 }}>查看存储后端状态与数据集分布</p>
        </div>
        <Button onClick={() => qc.invalidateQueries({ queryKey: ["storage-health"] })}>
          <Icon name="refresh" size={13} /> 刷新状态
        </Button>
      </div>

      {/* Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 20 }}>
        <StatCard icon="db" label="存储后端" value="MinIO" />
        <StatCard icon="folder" label="存储桶" value={bucket} />
        <StatCard icon="layers" label="数据集数量" value={String(totalDatasets)} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        {/* Storage backend */}
        <StorageBackendCard status={status} bucket={bucket} isError={isError} />

        {/* Dataset storage overview */}
        <Card>
          <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--color-border)" }}>
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>数据集存储概览</h3>
          </div>
          {datasets.length > 0 ? (
            <>
              <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0, fontSize: 13 }}>
                <thead>
                  <tr>
                    {["数据集", "类型", "文件数", "关联项目"].map((h, i) => (
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
                    <DatasetStorageRow key={ds.id} ds={ds} />
                  ))}
                </tbody>
              </table>
              <div style={{ padding: "10px 16px", fontSize: 11, color: "var(--color-fg-subtle)", borderTop: "1px solid var(--color-border)" }}>
                文件大小统计将在后续版本中支持
              </div>
            </>
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
