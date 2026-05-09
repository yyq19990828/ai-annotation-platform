import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { StatCard } from "@/components/ui/StatCard";
import { Icon } from "@/components/ui/Icon";
import { Button } from "@/components/ui/Button";
import { useToastStore } from "@/components/ui/Toast";
import {
  adminMlIntegrationsApi,
  type MLBackendItem,
} from "@/api/adminMlIntegrations";
import {
  useDeleteMLBackend,
  useMLBackendHealth,
} from "@/hooks/useMLBackends";
import { MlBackendFormModal } from "@/components/projects/MlBackendFormModal";
import type { MLBackendResponse } from "@/types";

const STATE_VARIANT: Record<string, "success" | "warning" | "outline" | "danger"> = {
  connected: "success",
  disconnected: "outline",
  error: "danger",
};

function formatDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("zh-CN", { hour12: false });
}

interface ModalState {
  open: boolean;
  projectId: string;
  backend: MLBackendResponse | null;
}

export function RegisteredBackendsTab() {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["admin", "ml-integrations", "overview"],
    queryFn: () => adminMlIntegrationsApi.overview(),
    refetchInterval: 60_000,
  });

  const [modal, setModal] = useState<ModalState>({ open: false, projectId: "", backend: null });

  const openCreate = (projectId: string) => setModal({ open: true, projectId, backend: null });
  const openEdit = (projectId: string, backend: MLBackendResponse) =>
    setModal({ open: true, projectId, backend });
  const closeModal = () => setModal((s) => ({ ...s, open: false }));

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
            <div style={{ fontSize: 11.5, marginTop: 4 }}>到具体项目的「项目设置 → ML 模型」中注册</div>
          </div>
        ) : (
          <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 12 }}>
            {data.projects.map((p) => (
              <ProjectGroup
                key={p.project_id}
                group={p}
                onCreate={() => openCreate(p.project_id)}
                onEdit={(b) => openEdit(p.project_id, b)}
              />
            ))}
          </div>
        )}
      </Card>

      <MlBackendFormModal
        open={modal.open}
        projectId={modal.projectId}
        backend={modal.backend}
        onClose={closeModal}
      />
    </>
  );
}

function ProjectGroup({
  group,
  onCreate,
  onEdit,
}: {
  group: { project_id: string; project_name: string; backends: MLBackendItem[] };
  onCreate: () => void;
  onEdit: (backend: MLBackendResponse) => void;
}) {
  const pushToast = useToastStore((s) => s.push);
  const del = useDeleteMLBackend(group.project_id);
  const health = useMLBackendHealth(group.project_id);

  const onDelete = (b: MLBackendItem) => {
    if (!window.confirm(`确认删除 backend「${b.name}」？此操作不可撤销。`)) return;
    del.mutate(b.id, {
      onSuccess: () => pushToast({ msg: "已删除 backend", kind: "success" }),
      onError: (e) => pushToast({ msg: "删除失败", sub: (e as Error).message }),
    });
  };

  const onHealth = (b: MLBackendItem) => {
    health.mutate(b.id, {
      onSuccess: (res) =>
        pushToast({
          msg: `${b.name}: ${res.status}`,
          kind: res.status === "connected" ? "success" : "warning",
        }),
      onError: (e) => pushToast({ msg: "健康检查失败", sub: (e as Error).message }),
    });
  };

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
        <div style={{ display: "inline-flex", alignItems: "center", gap: 12 }}>
          <Button size="sm" onClick={onCreate}>
            <Icon name="plus" size={11} />
            注册
          </Button>
          <a
            href={`/projects/${group.project_id}/settings?section=ml-backends`}
            style={{ fontSize: 11.5, color: "var(--color-accent)", textDecoration: "none" }}
          >
            打开项目设置 →
          </a>
        </div>
      </div>
      <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0, fontSize: 12.5 }}>
        <thead>
          <tr>
            {["名称", "URL", "类型", "状态", "最近检查", "操作"].map((h) => (
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
                  maxWidth: 280,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {b.url}
              </td>
              <td style={{ padding: "8px 12px", borderBottom: "1px solid var(--color-border)" }}>
                <div style={{ display: "inline-flex", gap: 4, alignItems: "center", flexWrap: "wrap" }}>
                  <Badge variant={b.is_interactive ? "ai" : "outline"}>
                    {b.is_interactive ? "交互式" : "批量"}
                  </Badge>
                  {/* v0.9.13 · max_concurrency chip; 缺省（默认 4）不显示, 避免列表噪音 */}
                  {typeof b.extra_params?.max_concurrency === "number" && (
                    <span title="单 backend 最大并发预标请求数" style={{ display: "inline-flex" }}>
                      <Badge variant="outline">≤{b.extra_params.max_concurrency} 并发</Badge>
                    </span>
                  )}
                </div>
              </td>
              <td style={{ padding: "8px 12px", borderBottom: "1px solid var(--color-border)" }}>
                <Badge variant={STATE_VARIANT[b.state] ?? "outline"} dot>
                  {b.state}
                </Badge>
                {/* v0.9.6 · 深度健康指标 (gpu_info / cache hit / model_version), 由 /health 缓存. */}
                {b.health_meta && (
                  <div
                    style={{
                      marginTop: 4,
                      fontSize: 10.5,
                      color: "var(--color-fg-subtle)",
                      lineHeight: 1.5,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {b.health_meta.model_version && (
                      <div className="mono" title="model_version">
                        {b.health_meta.model_version}
                      </div>
                    )}
                    {b.health_meta.gpu_info?.memory_used_mb != null &&
                      b.health_meta.gpu_info?.memory_total_mb != null && (
                        <div title="GPU 显存 used / total">
                          GPU {b.health_meta.gpu_info.memory_used_mb}/
                          {b.health_meta.gpu_info.memory_total_mb} MB
                        </div>
                      )}
                    {typeof b.health_meta.cache?.hit_rate === "number" && (
                      <div title="cache hit rate">
                        cache {(b.health_meta.cache.hit_rate * 100).toFixed(1)}%
                      </div>
                    )}
                  </div>
                )}
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
              <td style={{ padding: "8px 12px", borderBottom: "1px solid var(--color-border)" }}>
                <div style={{ display: "inline-flex", gap: 6 }}>
                  <Button size="sm" onClick={() => onHealth(b)} disabled={health.isPending} title="健康检查">
                    <Icon name="refresh" size={11} />
                  </Button>
                  <Button size="sm" onClick={() => onEdit(itemToResponse(b))} title="编辑">
                    <Icon name="edit" size={11} />
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() => onDelete(b)}
                    disabled={del.isPending}
                    title="删除"
                  >
                    <Icon name="trash" size={11} />
                  </Button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function itemToResponse(b: MLBackendItem): MLBackendResponse {
  return {
    id: b.id,
    project_id: b.project_id,
    name: b.name,
    url: b.url,
    state: b.state,
    is_interactive: b.is_interactive,
    auth_method: b.auth_method,
    extra_params: b.extra_params,
    error_message: b.error_message,
    last_checked_at: b.last_checked_at ?? undefined,
    created_at: b.created_at,
    updated_at: b.updated_at,
  } as MLBackendResponse;
}
