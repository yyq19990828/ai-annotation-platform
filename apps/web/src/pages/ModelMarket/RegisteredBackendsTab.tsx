import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { StatCard } from "@/components/ui/StatCard";
import { Icon } from "@/components/ui/Icon";
import {
  adminMlIntegrationsApi,
  type MLBackendItem,
} from "@/api/adminMlIntegrations";

const STATE_VARIANT: Record<string, "success" | "warning" | "outline" | "danger"> = {
  connected: "success",
  disconnected: "outline",
  error: "danger",
};

function formatDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("zh-CN", { hour12: false });
}

export function RegisteredBackendsTab() {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["admin", "ml-integrations", "overview"],
    queryFn: () => adminMlIntegrationsApi.overview(),
    refetchInterval: 60_000,
  });

  if (isLoading) {
    return (
      <Card style={{ padding: 24, textAlign: "center", color: "var(--color-fg-subtle)" }}>
        加载中…
      </Card>
    );
  }

  if (isError) {
    return (
      <Card style={{ padding: 24, textAlign: "center", color: "var(--color-danger)" }}>
        <Icon name="warning" size={20} style={{ marginBottom: 6 }} />
        <div>加载失败：{(error as Error)?.message ?? "未知错误"}</div>
        <button
          onClick={() => refetch()}
          style={{
            marginTop: 8,
            padding: "4px 12px",
            fontSize: 12,
            border: "1px solid var(--color-border)",
            borderRadius: "var(--radius-md)",
            background: "var(--color-bg-elev)",
            cursor: "pointer",
          }}
        >
          重试
        </button>
      </Card>
    );
  }

  if (!data) return null;

  return (
    <>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: 12,
          marginBottom: 16,
        }}
      >
        <StatCard
          icon="bot"
          label="ML Backend"
          value={`${data.connected_backends} / ${data.total_backends}`}
          hint="已连接 / 总数"
        />
        <StatCard
          icon="folder"
          label="使用项目"
          value={String(data.projects.length)}
          hint="已注册 backend 的项目"
        />
      </div>

      <Card>
        <div
          style={{
            padding: "12px 16px",
            borderBottom: "1px solid var(--color-border)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>项目级 ML Backend</h3>
          <span style={{ fontSize: 11, color: "var(--color-fg-muted)" }}>
            共 {data.projects.length} 个项目 · {data.total_backends} 个 backend
          </span>
        </div>

        {data.projects.length === 0 ? (
          <div
            style={{
              padding: 32,
              textAlign: "center",
              color: "var(--color-fg-subtle)",
              fontSize: 13,
            }}
          >
            <Icon name="bot" size={28} style={{ opacity: 0.25, marginBottom: 6 }} />
            <div>尚无项目注册了 ML Backend</div>
            <div style={{ fontSize: 11.5, marginTop: 4 }}>在项目设置 → AI 模型 中添加</div>
          </div>
        ) : (
          <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 12 }}>
            {data.projects.map((p) => (
              <ProjectGroup key={p.project_id} group={p} />
            ))}
          </div>
        )}
      </Card>
    </>
  );
}

function ProjectGroup({
  group,
}: {
  group: { project_id: string; project_name: string; backends: MLBackendItem[] };
}) {
  return (
    <div
      style={{
        border: "1px solid var(--color-border)",
        borderRadius: "var(--radius-md)",
        background: "var(--color-bg-elev)",
      }}
    >
      <div
        style={{
          padding: "10px 14px",
          borderBottom: "1px solid var(--color-border)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Icon name="folder" size={14} style={{ color: "var(--color-fg-muted)" }} />
          <span style={{ fontSize: 13, fontWeight: 500 }}>{group.project_name}</span>
        </div>
        <a
          href={`/projects/${group.project_id}/settings`}
          style={{ fontSize: 11.5, color: "var(--color-accent)", textDecoration: "none" }}
        >
          打开项目设置 →
        </a>
      </div>
      <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0, fontSize: 12.5 }}>
        <thead>
          <tr>
            {["名称", "URL", "类型", "状态", "最近检查"].map((h) => (
              <th
                key={h}
                style={{
                  textAlign: "left",
                  fontWeight: 500,
                  fontSize: 11,
                  color: "var(--color-fg-muted)",
                  padding: "6px 12px",
                  background: "var(--color-bg-sunken)",
                  borderBottom: "1px solid var(--color-border)",
                }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {group.backends.map((b) => (
            <tr key={b.id}>
              <td style={{ padding: "8px 12px", borderBottom: "1px solid var(--color-border)" }}>
                {b.name}
              </td>
              <td
                style={{
                  padding: "8px 12px",
                  borderBottom: "1px solid var(--color-border)",
                  fontFamily: "var(--font-mono, monospace)",
                  fontSize: 11,
                  color: "var(--color-fg-muted)",
                  maxWidth: 320,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {b.url}
              </td>
              <td style={{ padding: "8px 12px", borderBottom: "1px solid var(--color-border)" }}>
                <Badge variant={b.is_interactive ? "ai" : "outline"}>
                  {b.is_interactive ? "交互式" : "批量"}
                </Badge>
              </td>
              <td style={{ padding: "8px 12px", borderBottom: "1px solid var(--color-border)" }}>
                <Badge variant={STATE_VARIANT[b.state] ?? "outline"} dot>
                  {b.state}
                </Badge>
              </td>
              <td
                style={{
                  padding: "8px 12px",
                  borderBottom: "1px solid var(--color-border)",
                  color: "var(--color-fg-muted)",
                }}
              >
                {formatDate(b.last_checked_at)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
