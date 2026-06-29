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
import { usePermissions } from "@/hooks/usePermissions";
import {
  GlobalBackendFormModal,
  type GlobalRegistryEditTarget,
} from "./GlobalBackendFormModal";
import { useDeleteRegistry, useRegistryHealth } from "./useGlobalRegistry";

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

// v0.19.0 · ADR-0044 · 注册管理 tab：
//   1. 全局注册表（扁平 · 跨项目共享 · 超管做注册/编辑/删除/健康检查，项目管理员只读）
//   2. 项目启用概览（仅超管 · 只读 · 列「项目→已启用 backend」+ 打开项目设置链接）
// 已删除旧的「按项目分组注册」卡片：注册现为全局一次，不再按项目各注册一份。
export function RegisteredBackendsTab() {
  const { role } = usePermissions();
  const isSuperAdmin = role === "super_admin";
  return (
    <>
      <GlobalRegistrySection isSuperAdmin={isSuperAdmin} />
      {isSuperAdmin && <ProjectEnablementOverview />}
    </>
  );
}

// 超管 · 跨项目共享的全局 ML Backend 注册表，提供注册/编辑/删除/健康检查。
// 项目管理员可见同一列表但只读（注册由超管维护，项目启用在项目设置里做）。
function GlobalRegistrySection({ isSuperAdmin }: { isSuperAdmin: boolean }) {
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
  const headers = isSuperAdmin
    ? ["名称", "URL", "来源", "类型", "状态", "最近检查", "操作"]
    : ["名称", "URL", "来源", "类型", "状态", "最近检查"];

  return (
    <>
      <Card className="mb-4">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <Icon name="bot" size={14} className="text-muted-foreground" />
            <h3 className="m-0 text-sm font-semibold">全局注册表</h3>
            <span className="text-xs text-muted-foreground">跨项目共享的 ML Backend</span>
          </div>
          {isSuperAdmin && (
            <Button size="sm" onClick={openCreate}>
              <Icon name="plus" size={11} />
              注册全局 backend
            </Button>
          )}
        </div>

        {!isSuperAdmin && (
          <div className="border-b border-border bg-muted/40 px-4 py-2 text-xs text-muted-foreground">
            注册由超级管理员维护；项目侧请在「项目设置 → ML 模型」里勾选启用所需 backend。
          </div>
        )}

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
            {isSuperAdmin && <div className="mt-1 text-xs">点击右上角「注册全局 backend」添加</div>}
          </div>
        ) : (
          <div className="max-w-full overflow-x-auto p-3">
            <table className={TABLE_CLASS}>
              <thead>
                <tr>
                  {headers.map((h) => (
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
                      <div className="inline-flex flex-wrap items-center gap-1">
                        <Badge variant={b.is_interactive ? "ai" : "outline"}>
                          {b.is_interactive ? "交互式" : "批量"}
                        </Badge>
                        {/* max_concurrency chip; 缺省（默认 4）不显示, 避免列表噪音。
                            v0.19.0 起限速真正 per-物理-backend 生效, 故在全局表展示。 */}
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
                    </td>
                    <td className={clsx(NOWRAP, "text-muted-foreground")}>
                      {formatDate(b.last_checked_at)}
                    </td>
                    {isSuperAdmin && (
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
                    )}
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

// 仅超管 · 只读「项目启用概览」：复用 /overview（其 projects 已按 project_ml_backend.enabled
// 聚合），列出每个项目已启用了哪些全局 backend，并提供「打开项目设置」入口。无注册/编辑/删除动作
// —— 项目启用本身在项目设置里做，这里只看不改。
function ProjectEnablementOverview() {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["admin", "ml-integrations", "overview"],
    queryFn: () => adminMlIntegrationsApi.overview(),
    refetchInterval: 60_000,
  });

  return (
    <Card>
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <Icon name="folder" size={14} className="text-muted-foreground" />
          <h3 className="m-0 text-sm font-semibold">项目启用概览</h3>
        </div>
        {data && (
          <span className="text-xs text-muted-foreground">
            共 {data.projects.length} 个 AI 项目 · {data.total_backends} 个 backend
          </span>
        )}
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
      ) : !data || data.projects.length === 0 ? (
        <div className="p-8 text-center text-sm text-muted-foreground">
          <Icon name="bot" size={28} className="mb-1.5 opacity-25" />
          <div>尚无项目启用 AI 或 backend</div>
          <div className="mt-1 text-xs">在项目设置里启用 AI 并勾选 backend 后会出现在这里</div>
        </div>
      ) : (
        <div className="flex flex-col gap-2 p-3">
          {data.projects.map((p) => (
            <ProjectEnablementRow key={p.project_id} group={p} />
          ))}
        </div>
      )}
    </Card>
  );
}

function ProjectEnablementRow({
  group,
}: {
  group: { project_id: string; project_name: string; backends: MLBackendItem[] };
}) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-3 rounded-md border border-border bg-card px-3.5 py-2.5">
      <div className="flex min-w-0 items-center gap-2">
        <Icon name="folder" size={14} className="text-muted-foreground" />
        <span className="truncate text-sm font-medium">{group.project_name}</span>
        {group.backends.length === 0 ? (
          <Badge variant="warning">AI 已启用 · 未启用 backend</Badge>
        ) : (
          <div className="flex flex-wrap items-center gap-1">
            {group.backends.map((b) => (
              <span key={b.id} title={`${b.url} · ${b.state}`} className="inline-flex">
                <Badge variant={STATE_VARIANT[b.state] ?? "outline"} dot>
                  {b.name}
                </Badge>
              </span>
            ))}
          </div>
        )}
      </div>
      <a
        href={`/projects/${group.project_id}/settings?section=ml-backends`}
        className="whitespace-nowrap text-xs text-brand no-underline"
      >
        打开项目设置 →
      </a>
    </div>
  );
}
