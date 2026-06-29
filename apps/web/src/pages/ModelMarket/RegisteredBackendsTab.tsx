import { useState } from "react";
import { clsx } from "clsx";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Icon } from "@/components/ui/Icon";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { useToastStore } from "@/components/ui/Toast";
import {
  adminMlIntegrationsApi,
  type MLBackendItem,
  type GlobalBackendItem,
} from "@/api/adminMlIntegrations";
import { useDeleteMLBackend } from "@/hooks/useMLBackends";
import { usePermissions } from "@/hooks/usePermissions";
import { MlBackendFormModal } from "@/components/projects/MlBackendFormModal";
import {
  GlobalBackendFormModal,
  type GlobalRegistryEditTarget,
} from "./GlobalBackendFormModal";
import { useDeleteRegistry, useRegistryHealth } from "./useGlobalRegistry";
import type { MLBackendResponse } from "@/types";

const STATE_VARIANT: Record<string, "success" | "warning" | "outline" | "danger"> = {
  connected: "success",
  disconnected: "outline",
  error: "danger",
};

const TABLE_CLASS =
  "w-full min-w-[760px] border-separate border-spacing-0 text-sm [&_td]:border-b [&_td]:border-border [&_td]:px-3 [&_td]:py-2";
const TH_CLASS =
  "border-b border-border bg-muted px-3 py-1.5 text-left text-xs font-medium whitespace-nowrap text-muted-foreground";
const RETRY_BTN_CLASS =
  "mt-2 cursor-pointer appearance-none rounded-md border border-border bg-card px-3 py-1 text-xs text-foreground";
const NOWRAP = "whitespace-nowrap";

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
  const { role } = usePermissions();
  const isSuperAdmin = role === "super_admin";
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
        <div className="p-6 text-center text-muted-foreground">加载中…</div>
      </Card>
    );
  }

  if (isError) {
    return (
      <Card>
        <div className="p-6 text-center text-status-danger">
          <Icon name="warning" size={20} className="mb-1.5" />
          <div>加载失败：{(error as Error)?.message ?? "未知错误"}</div>
          <button className={RETRY_BTN_CLASS} onClick={() => refetch()}>
            重试
          </button>
        </div>
      </Card>
    );
  }

  if (!data) return null;

  return (
    <>
      {isSuperAdmin && <GlobalRegistrySection />}

      <Card>
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h3 className="m-0 text-sm font-semibold">注册管理</h3>
          <span className="text-xs text-muted-foreground">
            共 {data.projects.length} 个 AI 项目 · {data.total_backends} 个 backend
          </span>
        </div>

        {data.projects.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            <Icon name="bot" size={28} className="mb-1.5 opacity-25" />
            <div>尚无项目启用 AI 或注册 ML Backend</div>
            <div className="mt-1 text-xs">新建项目启用 AI 后会出现在这里</div>
          </div>
        ) : (
          <div className="flex flex-col gap-3 p-3">
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
    <div className="min-w-0 rounded-md border border-border bg-card">
      <div className="flex items-center justify-between gap-3 border-b border-border px-3.5 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <Icon name="folder" size={14} className="text-muted-foreground" />
          <span className="truncate text-sm font-medium">{group.project_name}</span>
          {group.backends.length === 0 && (
            <Badge variant="warning">AI 已启用 · 未注册 backend</Badge>
          )}
        </div>
        <div className="inline-flex flex-shrink-0 items-center gap-3">
          <Button size="sm" onClick={onCreate}>
            <Icon name="plus" size={11} />
            注册
          </Button>
          <a
            href={`/projects/${group.project_id}/settings?section=ml-backends`}
            className="whitespace-nowrap text-xs text-brand no-underline"
          >
            打开项目设置 →
          </a>
        </div>
      </div>
      {group.backends.length === 0 ? (
        <div className="flex items-center justify-between gap-3 px-3.5 py-4 text-xs text-muted-foreground">
          <div>该项目已启用 AI, 但还没有注册 ML Backend。</div>
          <Button size="sm" onClick={onCreate}>
            <Icon name="plus" size={11} />
            注册第一个 backend
          </Button>
        </div>
      ) : (
        <div className="max-w-full overflow-x-auto">
          <table className={TABLE_CLASS}>
            <thead>
              <tr>
                {["名称", "URL", "类型", "状态", "最近检查", "操作"].map((h) => (
                  <th key={h} className={TH_CLASS}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {group.backends.map((b) => (
                <tr key={b.id}>
                  <td className="max-w-[180px] truncate" title={b.name}>{b.name}</td>
                  <td className="mono max-w-[280px] truncate text-xs text-muted-foreground" title={b.url}>
                    {b.url}
                  </td>
                  <td>
                    <div className="inline-flex flex-wrap items-center gap-1">
                      <Badge variant={b.is_interactive ? "ai" : "outline"}>
                        {b.is_interactive ? "交互式" : "批量"}
                      </Badge>
                      {/* v0.9.13 · max_concurrency chip; 缺省（默认 4）不显示, 避免列表噪音 */}
                      {typeof b.extra_params?.max_concurrency === "number" && (
                        <span title="单 backend 最大并发预标请求数" className="inline-flex">
                          <Badge variant="outline">≤{b.extra_params.max_concurrency} 并发</Badge>
                        </span>
                      )}
                    </div>
                  </td>
                  <td className={NOWRAP}>
                    <Badge variant={STATE_VARIANT[b.state] ?? "outline"} dot>
                      {b.state}
                    </Badge>
                    {b.error_message && (
                      <div className="mt-1 max-w-[220px] truncate text-2xs text-status-danger">
                        {b.error_message}
                      </div>
                    )}
                  </td>
                  <td className={clsx(NOWRAP, "text-muted-foreground")}>
                    {formatDate(b.last_checked_at)}
                  </td>
                  <td className={NOWRAP}>
                    <div className="inline-flex gap-1.5 whitespace-nowrap">
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

// v0.19.0 · ADR-0044 · superadmin 全局注册表区块：列出所有全局 backend，提供注册/编辑/删除/健康检查。
function GlobalRegistrySection() {
  const pushToast = useToastStore((s) => s.push);
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["admin", "ml-integrations", "all"],
    queryFn: () => adminMlIntegrationsApi.listAll(),
    refetchInterval: 60_000,
  });

  const del = useDeleteRegistry();
  const health = useRegistryHealth();

  const [modalOpen, setModalOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<GlobalRegistryEditTarget | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<GlobalBackendItem | null>(null);

  const openCreate = () => {
    setEditTarget(null);
    setModalOpen(true);
  };
  const openEdit = (b: GlobalBackendItem) => {
    setEditTarget({ id: b.id, name: b.name, url: b.url, auth_method: b.auth_method });
    setModalOpen(true);
  };

  const onHealth = (b: GlobalBackendItem) => {
    health.mutate(b.id, {
      onSuccess: (res) =>
        pushToast({
          msg: res.status === "ok" ? `「${res.backend_name}」健康检查通过` : `「${res.backend_name}」检查失败`,
          kind: res.status === "ok" ? "success" : "warning",
        }),
      onError: (e) => pushToast({ msg: "健康检查失败", sub: (e as Error).message, kind: "warning" }),
    });
  };

  const confirmDelete = () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    del.mutate(target.id, {
      onSuccess: () => {
        pushToast({ msg: `已删除「${target.name}」`, kind: "success" });
        setDeleteTarget(null);
      },
      onError: (e) => {
        const err = e as { status?: number; message?: string };
        pushToast({
          msg: err.status === 409 ? "存在运行中的预标任务，无法删除" : "删除失败",
          sub: err.status === 409 ? err.message : (e as Error).message,
          kind: "warning",
        });
        setDeleteTarget(null);
      },
    });
  };

  const items = data?.items ?? [];

  return (
    <>
      <Card className="mb-4">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <Icon name="bot" size={14} className="text-muted-foreground" />
            <h3 className="m-0 text-sm font-semibold">全局注册表</h3>
            <span className="text-xs text-muted-foreground">超管 · 跨项目共享的 ML Backend</span>
          </div>
          <Button size="sm" onClick={openCreate}>
            <Icon name="plus" size={11} />
            注册全局 backend
          </Button>
        </div>

        {isLoading ? (
          <div className="p-6 text-center text-sm text-muted-foreground">加载中…</div>
        ) : isError ? (
          <div className="p-6 text-center text-status-danger">
            <Icon name="warning" size={18} className="mb-1.5" />
            <div>加载失败：{(error as Error)?.message ?? "未知错误"}</div>
            <button className={RETRY_BTN_CLASS} onClick={() => refetch()}>
              重试
            </button>
          </div>
        ) : items.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            <Icon name="bot" size={28} className="mb-1.5 opacity-25" />
            <div>尚无全局 backend</div>
            <div className="mt-1 text-xs">点击右上角「注册全局 backend」添加</div>
          </div>
        ) : (
          <div className="max-w-full overflow-x-auto p-3">
            <table className={TABLE_CLASS}>
              <thead>
                <tr>
                  {["名称", "URL", "来源", "类型", "状态", "最近检查", "操作"].map((h) => (
                    <th key={h} className={TH_CLASS}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map((b) => (
                  <tr key={b.id}>
                    <td className="max-w-[180px] truncate" title={b.name}>
                      {b.name}
                    </td>
                    <td className="mono max-w-[260px] truncate text-xs text-muted-foreground" title={b.url}>
                      {b.url}
                    </td>
                    <td className={NOWRAP}>
                      <Badge variant="outline">{b.source_project_name || "—"}</Badge>
                    </td>
                    <td>
                      <Badge variant={b.is_interactive ? "ai" : "outline"}>
                        {b.is_interactive ? "交互式" : "批量"}
                      </Badge>
                    </td>
                    <td className={NOWRAP}>
                      <Badge variant={STATE_VARIANT[b.state] ?? "outline"} dot>
                        {b.state}
                      </Badge>
                    </td>
                    <td className={clsx(NOWRAP, "text-muted-foreground")}>
                      {formatDate(b.last_checked_at)}
                    </td>
                    <td className={NOWRAP}>
                      <div className="inline-flex gap-1.5 whitespace-nowrap">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => onHealth(b)}
                          disabled={health.isPending}
                          title="健康检查"
                        >
                          <Icon name="activity" size={11} />
                          检查
                        </Button>
                        <Button size="sm" onClick={() => openEdit(b)} title="编辑">
                          <Icon name="edit" size={11} />
                          编辑
                        </Button>
                        <Button
                          size="sm"
                          variant="danger"
                          onClick={() => setDeleteTarget(b)}
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
      </Card>

      <GlobalBackendFormModal
        open={modalOpen}
        backend={editTarget}
        onClose={() => setModalOpen(false)}
      />

      <Modal
        open={!!deleteTarget}
        onClose={() => (del.isPending ? undefined : setDeleteTarget(null))}
        title="删除全局 backend"
        width={420}
      >
        <div className="flex flex-col gap-4 text-sm">
          <p className="m-0 text-foreground">
            确认删除 backend「{deleteTarget?.name}」？此操作不可撤销，且仅在没有运行中预标任务时可成功。
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setDeleteTarget(null)} disabled={del.isPending}>
              取消
            </Button>
            <Button variant="danger" onClick={confirmDelete} disabled={del.isPending}>
              {del.isPending ? "删除中..." : "确认删除"}
            </Button>
          </div>
        </div>
      </Modal>
    </>
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
