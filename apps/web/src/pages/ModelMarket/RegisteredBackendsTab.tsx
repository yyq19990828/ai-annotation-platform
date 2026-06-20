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

const STATE_VARIANT: Record<string, "success" | "warning" | "outline" | "danger"> = {
  connected: "success",
  disconnected: "outline",
  error: "danger",
};

const TABLE_CLASS =
  "w-full min-w-[760px] border-separate border-spacing-0 text-[12.5px] [&_td]:border-b [&_td]:border-border [&_td]:px-3 [&_td]:py-2";
const TH_CLASS =
  "border-b border-border bg-muted px-3 py-1.5 text-left text-[11px] font-medium whitespace-nowrap text-muted-foreground";
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
      <Card>
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h3 className="m-0 text-sm font-semibold">注册管理</h3>
          <span className="text-[11px] text-muted-foreground">
            共 {data.projects.length} 个 AI 项目 · {data.total_backends} 个 backend
          </span>
        </div>

        {data.projects.length === 0 ? (
          <div className="p-8 text-center text-[13px] text-muted-foreground">
            <Icon name="bot" size={28} className="mb-1.5 opacity-25" />
            <div>尚无项目启用 AI 或注册 ML Backend</div>
            <div className="mt-1 text-[11.5px]">新建项目启用 AI 后会出现在这里</div>
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
          <span className="truncate text-[13px] font-medium">{group.project_name}</span>
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
            className="whitespace-nowrap text-[11.5px] text-brand no-underline"
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
                  <td className="mono max-w-[280px] truncate text-[11px] text-muted-foreground" title={b.url}>
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
                      <div className="mt-1 max-w-[220px] truncate text-[10.5px] text-status-danger">
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
