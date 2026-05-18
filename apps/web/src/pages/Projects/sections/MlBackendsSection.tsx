import { useState } from "react";
import { useQueries } from "@tanstack/react-query";
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
import { useUpdateProject } from "@/hooks/useProjects";
import { usePermissions } from "@/hooks/usePermissions";
import { MlBackendFormModal } from "@/components/projects/MlBackendFormModal";
import { MlBackendLimitModal } from "@/components/projects/MlBackendLimitModal";
import { mlBackendsApi, type MLBackendCapability } from "@/api/ml-backends";
import type { ProjectResponse } from "@/api/projects";
import type { MLBackendResponse } from "@/types";
import styles from "./MlBackendsSection.module.css";

function cn(...xs: Array<string | false | null | undefined>): string {
  return xs.filter(Boolean).join(" ");
}

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
  // v0.9.5 · 行内「绑定到本项目」快捷绑定，免回基本信息 tab 手选
  const updateProject = useUpdateProject(project.id);
  const onBind = (b: MLBackendResponse) => {
    updateProject.mutate(
      { ml_backend_id: b.id, ai_enabled: true } as Parameters<typeof updateProject.mutate>[0],
      {
        onSuccess: () =>
          pushToast({ msg: `已绑定 backend「${b.name}」`, kind: "success" }),
        onError: (e) => pushToast({ msg: "绑定失败", sub: (e as Error).message }),
      },
    );
  };

  // v0.10.3 · 容量上限. 后端 ml_backend_limit 来自 settings.max_ml_backends_per_project.
  // 0 视为不限 (与后端一致, 见 apps/api/app/api/v1/ml_backends.py:65).
  const limit = (project as ProjectResponse & { ml_backend_limit?: number }).ml_backend_limit ?? 1;
  const atLimit = limit > 0 && backends.length >= limit;

  // v0.10.3 · 每个 backend 拉一次 /setup 拿 supported_prompts; 失败容忍, 列显示 "—".
  // 管理面板低频, 不做合并端点; 未来 N>5 再优化.
  const capabilities = useQueries({
    queries: backends.map((b) => ({
      queryKey: ["ml-backends", project.id, b.id, "setup"],
      queryFn: () => mlBackendsApi.setup(project.id, b.id),
      staleTime: 60_000,
      retry: false,
    })),
  });

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<MLBackendResponse | null>(null);
  const [limitDetail, setLimitDetail] = useState<{
    open: boolean;
    serverMessage?: string;
    currentOverride?: number;
  }>({ open: false });

  const openCreate = () => {
    if (atLimit) {
      setLimitDetail({ open: true });
      return;
    }
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

  const registerTitle = !canManage
    ? "需要 PROJECT_ADMIN 权限"
    : atLimit
    ? `已达上限 ${limit}，请先解绑现有后端`
    : undefined;

  return (
    <Card>
      <div className={styles.cardHeader}>
        <div>
          <h3 className={styles.cardTitle}>
            ML 模型
            <span
              data-testid="ml-backend-quota"
              className={styles.quota}
            >
              已用 {backends.length} / {limit > 0 ? limit : "∞"}
            </span>
          </h3>
          <div className={styles.subtitle}>
            管理本项目作用域的 ML backend；注册后回「基本信息」可绑定为预标注 backend。
          </div>
        </div>
        <Button
          variant="primary"
          disabled={!canManage || atLimit}
          onClick={openCreate}
          title={registerTitle}
        >
          <Icon name="plus" size={12} />
          注册 backend
        </Button>
      </div>

      <div className={styles.body}>
        {isLoading && (
          <div className={styles.placeholder}>
            加载中…
          </div>
        )}
        {isError && (
          <div className={cn(styles.placeholder, styles.errorText)}>
            <Icon name="warning" size={14} className={styles.warningIcon} />
            加载失败：{(error as Error)?.message ?? "未知错误"}
          </div>
        )}
        {!isLoading && !isError && backends.length === 0 && (
          <div className={styles.emptyState}>
            <Icon name="bot" size={28} className={styles.emptyIcon} />
            <div>本项目暂未注册任何 ML backend</div>
            <div className={styles.emptyHint}>点击右上角「注册 backend」开始接入</div>
          </div>
        )}
        {!isLoading && backends.length > 0 && (
          <table className={styles.table}>
            <thead>
              <tr>
                {["名称", "URL", "类型", "能力", "状态", "最近检查", "操作"].map((h) => (
                  <th
                    key={h}
                    className={styles.tableHeadCell}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {backends.map((b, i) => {
                const capQ = capabilities[i];
                const cap = capQ?.data as MLBackendCapability | undefined;
                return (
                  <tr key={b.id}>
                    <td className={styles.tableCell}>{b.name}</td>
                    <td className={cn(styles.tableCell, styles.urlCell)}>
                      {b.url}
                    </td>
                    <td className={styles.tableCell}>
                      <Badge variant={b.is_interactive ? "ai" : "outline"}>
                        {b.is_interactive ? "交互式" : "批量"}
                      </Badge>
                    </td>
                    <td className={styles.tableCell}>
                      {capQ?.isLoading && (
                        <span className={styles.subtleText}>…</span>
                      )}
                      {capQ?.isError && (
                        <span className={styles.subtleText}>—</span>
                      )}
                      {cap?.supported_prompts && (
                        <div className={styles.capabilityList}>
                          {cap.supported_prompts.map((p) => (
                            <Badge key={p} variant="outline">
                              {p}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className={styles.tableCell}>
                      <Badge variant={STATE_VARIANT[b.state] ?? "outline"} dot>
                        {b.state}
                      </Badge>
                    </td>
                    <td className={cn(styles.tableCell, styles.mutedCell)}>
                      {formatDate(b.last_checked_at)}
                    </td>
                    <td className={styles.tableCell}>
                      <div className={styles.actions}>
                        {project.ml_backend_id !== b.id && (
                          <Button
                            size="sm"
                            variant="ai"
                            onClick={() => onBind(b)}
                            disabled={!canManage || updateProject.isPending}
                            title={canManage ? "绑定到本项目（同时启用 AI）" : "需要 PROJECT_ADMIN 权限"}
                          >
                            绑定到本项目
                          </Button>
                        )}
                        {project.ml_backend_id === b.id && (
                          <span className={styles.boundBadge}>
                            <Badge variant="ai">
                              已绑定
                            </Badge>
                          </span>
                        )}
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
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <MlBackendFormModal
        open={modalOpen}
        projectId={project.id}
        backend={editing}
        onClose={() => setModalOpen(false)}
        onLimitReached={(d) =>
          setLimitDetail({
            open: true,
            serverMessage: d.message,
            currentOverride: d.current,
          })
        }
      />
      <MlBackendLimitModal
        open={limitDetail.open}
        limit={limit}
        current={limitDetail.currentOverride ?? backends.length}
        serverMessage={limitDetail.serverMessage}
        onClose={() => setLimitDetail({ open: false })}
      />
    </Card>
  );
}
