import { useState } from "react";
import { clsx } from "clsx";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Icon } from "@/components/ui/Icon";
import { Button } from "@/components/ui/Button";
import { useToastStore } from "@/components/ui/Toast";
import {
  adminMlIntegrationsApi,
  type MLBackendItem,
} from "@/api/adminMlIntegrations";
import { useDeleteMLBackend } from "@/hooks/useMLBackends";
import { MlBackendFormModal } from "@/components/projects/MlBackendFormModal";
import type { MLBackendResponse } from "@/types";
import styles from "./RegisteredBackendsTab.module.css";

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
      <Card>
        <div className={styles.loadingCard}>加载中…</div>
      </Card>
    );
  }

  if (isError) {
    return (
      <Card>
        <div className={styles.errorCard}>
          <Icon name="warning" size={20} className={styles.errorIcon} />
          <div>加载失败：{(error as Error)?.message ?? "未知错误"}</div>
          <button className={styles.retryButton} onClick={() => refetch()}>
            重试
          </button>
        </div>
      </Card>
    );
  }

  if (!data) return null;

  return (
    <>
      <Card>
        <div className={styles.cardHeader}>
          <h3 className={styles.cardTitle}>注册管理</h3>
          <span className={styles.cardMeta}>
            共 {data.projects.length} 个 AI 项目 · {data.total_backends} 个 backend
          </span>
        </div>

        {data.projects.length === 0 ? (
          <div className={styles.emptyState}>
            <Icon name="bot" size={28} className={styles.emptyIcon} />
            <div>尚无项目启用 AI 或注册 ML Backend</div>
            <div className={styles.emptyHint}>新建项目启用 AI 后会出现在这里</div>
          </div>
        ) : (
          <div className={styles.groupList}>
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

  const onDelete = (b: MLBackendItem) => {
    if (!window.confirm(`确认删除 backend「${b.name}」？此操作不可撤销。`)) return;
    del.mutate(b.id, {
      onSuccess: () => pushToast({ msg: "已删除 backend", kind: "success" }),
      onError: (e) => pushToast({ msg: "删除失败", sub: (e as Error).message }),
    });
  };

  return (
    <div className={styles.projectGroup}>
      <div className={styles.projectHeader}>
        <div className={styles.projectTitle}>
          <Icon name="folder" size={14} className={styles.mutedIcon} />
          <span className={styles.projectName}>{group.project_name}</span>
          {group.backends.length === 0 && (
            <Badge variant="warning">AI 已启用 · 未注册 backend</Badge>
          )}
        </div>
        <div className={styles.projectActions}>
          <Button size="sm" onClick={onCreate}>
            <Icon name="plus" size={11} />
            注册
          </Button>
          <a
            href={`/projects/${group.project_id}/settings?section=ml-backends`}
            className={styles.projectSettingsLink}
          >
            打开项目设置 →
          </a>
        </div>
      </div>
      {group.backends.length === 0 ? (
        <div className={styles.emptyGroupState}>
          <div>该项目已启用 AI, 但还没有注册 ML Backend。</div>
          <Button size="sm" onClick={onCreate}>
            <Icon name="plus" size={11} />
            注册第一个 backend
          </Button>
        </div>
      ) : (
        <div className={styles.tableScroller}>
          <table className={styles.backendTable}>
            <thead>
              <tr>
                {["名称", "URL", "类型", "状态", "最近检查", "操作"].map((h) => (
                  <th key={h} className={styles.tableHeaderCell}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {group.backends.map((b) => (
                <tr key={b.id}>
                  <td className={clsx(styles.tableCell, styles.nameCell)} title={b.name}>{b.name}</td>
                  <td className={clsx(styles.tableCell, styles.urlCell)} title={b.url}>
                    {b.url}
                  </td>
                  <td className={styles.tableCell}>
                    <div className={styles.badgeList}>
                      <Badge variant={b.is_interactive ? "ai" : "outline"}>
                        {b.is_interactive ? "交互式" : "批量"}
                      </Badge>
                      {/* v0.9.13 · max_concurrency chip; 缺省（默认 4）不显示, 避免列表噪音 */}
                      {typeof b.extra_params?.max_concurrency === "number" && (
                        <span title="单 backend 最大并发预标请求数" className={styles.inlineChip}>
                          <Badge variant="outline">≤{b.extra_params.max_concurrency} 并发</Badge>
                        </span>
                      )}
                    </div>
                  </td>
                  <td className={clsx(styles.tableCell, styles.statusCell)}>
                    <Badge variant={STATE_VARIANT[b.state] ?? "outline"} dot>
                      {b.state}
                    </Badge>
                    {b.error_message && <div className={styles.errorText}>{b.error_message}</div>}
                  </td>
                  <td className={clsx(styles.tableCell, styles.mutedCell, styles.dateCell)}>
                    {formatDate(b.last_checked_at)}
                  </td>
                  <td className={clsx(styles.tableCell, styles.actionsCell)}>
                    <div className={styles.actionList}>
                      <Button size="sm" onClick={() => onEdit(itemToResponse(b))} title="编辑">
                        <Icon name="edit" size={11} />
                        编辑
                      </Button>
                      <Button
                        size="sm"
                        variant="danger"
                        onClick={() => onDelete(b)}
                        disabled={del.isPending}
                        title="删除"
                      >
                        <Icon name="trash" size={11} />
                        删除
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
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
