import { useState } from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Icon } from "@/components/ui/Icon";
import { useToastStore } from "@/components/ui/Toast";
import {
  useMLBackends,
  useDeleteMLBackend,
  useMLBackendHealth,
} from "@/hooks/useMLBackends";
import { usePermissions } from "@/hooks/usePermissions";
import { MlBackendFormModal } from "@/components/projects/MlBackendFormModal";
import type { ProjectResponse } from "@/api/projects";
import type { MLBackendResponse } from "@/types";

const STATE_VARIANT: Record<string, "success" | "warning" | "outline" | "danger"> = {
  connected: "success",
  disconnected: "outline",
  error: "danger",
};

function formatDate(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("zh-CN", { hour12: false });
}

export function MlBackendsSection({ project }: { project: ProjectResponse }) {
  const pushToast = useToastStore((s) => s.push);
  const { role } = usePermissions();
  const canManage = role === "super_admin" || role === "project_admin";

  const { data: backends = [], isLoading, isError, error } = useMLBackends(project.id);
  const del = useDeleteMLBackend(project.id);
  const health = useMLBackendHealth(project.id);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<MLBackendResponse | null>(null);

  const openCreate = () => {
    setEditing(null);
    setModalOpen(true);
  };
  const openEdit = (b: MLBackendResponse) => {
    setEditing(b);
    setModalOpen(true);
  };
  const onDelete = (b: MLBackendResponse) => {
    if (!window.confirm(`确认删除 backend「${b.name}」？此操作不可撤销。`)) return;
    del.mutate(b.id, {
      onSuccess: () => pushToast({ msg: "已删除 backend", kind: "success" }),
      onError: (e) => pushToast({ msg: "删除失败", sub: (e as Error).message }),
    });
  };
  const onHealth = (b: MLBackendResponse) => {
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
    <Card>
      <div
        style={{
          padding: "14px 16px",
          borderBottom: "1px solid var(--color-border)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <div>
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>ML 模型</h3>
          <div style={{ fontSize: 11.5, color: "var(--color-fg-muted)", marginTop: 2 }}>
            管理本项目作用域的 ML backend；注册后回「基本信息」可绑定为预标注 backend。
          </div>
        </div>
        <Button variant="primary" disabled={!canManage} onClick={openCreate} title={canManage ? undefined : "需要 PROJECT_ADMIN 权限"}>
          <Icon name="plus" size={12} />
          注册 backend
        </Button>
      </div>

      <div style={{ padding: 12 }}>
        {isLoading && (
          <div style={{ padding: 24, textAlign: "center", fontSize: 13, color: "var(--color-fg-subtle)" }}>
            加载中…
          </div>
        )}
        {isError && (
          <div style={{ padding: 24, textAlign: "center", fontSize: 13, color: "var(--color-danger)" }}>
            <Icon name="warning" size={14} style={{ marginRight: 6 }} />
            加载失败：{(error as Error)?.message ?? "未知错误"}
          </div>
        )}
        {!isLoading && !isError && backends.length === 0 && (
          <div
            style={{
              padding: 32,
              textAlign: "center",
              color: "var(--color-fg-subtle)",
              fontSize: 13,
              border: "1px dashed var(--color-border)",
              borderRadius: "var(--radius-md)",
            }}
          >
            <Icon name="bot" size={28} style={{ opacity: 0.25, marginBottom: 6 }} />
            <div>本项目暂未注册任何 ML backend</div>
            <div style={{ fontSize: 11.5, marginTop: 4 }}>点击右上角「注册 backend」开始接入</div>
          </div>
        )}
        {!isLoading && backends.length > 0 && (
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
              {backends.map((b) => (
                <tr key={b.id}>
                  <td style={cellStyle}>{b.name}</td>
                  <td
                    style={{
                      ...cellStyle,
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
                  <td style={cellStyle}>
                    <Badge variant={b.is_interactive ? "ai" : "outline"}>
                      {b.is_interactive ? "交互式" : "批量"}
                    </Badge>
                  </td>
                  <td style={cellStyle}>
                    <Badge variant={STATE_VARIANT[b.state] ?? "outline"} dot>
                      {b.state}
                    </Badge>
                  </td>
                  <td style={{ ...cellStyle, color: "var(--color-fg-muted)" }}>
                    {formatDate(b.last_checked_at)}
                  </td>
                  <td style={cellStyle}>
                    <div style={{ display: "inline-flex", gap: 6 }}>
                      <Button
                        size="sm"
                        onClick={() => onHealth(b)}
                        disabled={health.isPending}
                        title="健康检查"
                      >
                        <Icon name="refresh" size={11} />
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => openEdit(b)}
                        disabled={!canManage}
                        title={canManage ? "编辑" : "需要 PROJECT_ADMIN 权限"}
                      >
                        <Icon name="edit" size={11} />
                      </Button>
                      <Button
                        size="sm"
                        variant="danger"
                        onClick={() => onDelete(b)}
                        disabled={!canManage || del.isPending}
                        title={canManage ? "删除" : "需要 PROJECT_ADMIN 权限"}
                      >
                        <Icon name="trash" size={11} />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <MlBackendFormModal
        open={modalOpen}
        projectId={project.id}
        backend={editing}
        onClose={() => setModalOpen(false)}
      />
    </Card>
  );
}

const cellStyle = {
  padding: "8px 12px",
  borderBottom: "1px solid var(--color-border)",
} as const;
