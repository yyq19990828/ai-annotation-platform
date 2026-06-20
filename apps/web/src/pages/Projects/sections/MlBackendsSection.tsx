import { useEffect, useState } from "react";
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
import { useUnsavedWarning } from "@/hooks/useUnsavedWarning";
import { usePermissions } from "@/hooks/usePermissions";
import { MlBackendFormModal } from "@/components/projects/MlBackendFormModal";
import { MlBackendLimitModal } from "@/components/projects/MlBackendLimitModal";
import {
  TextOutputDefaultSelect,
  type TextOutputDefault,
} from "@/components/projects/shared/TextOutputDefaultSelect";
import { mlBackendsApi, type MLBackendCapability } from "@/api/ml-backends";
import type { ProjectResponse } from "@/api/projects";
import type { MLBackendResponse } from "@/types";
import { LABEL_CLASS } from "./formClasses";

function cn(...xs: Array<string | false | null | undefined>): string {
  return xs.filter(Boolean).join(" ");
}

const CONTROL_CLASS =
  "box-border w-full appearance-none rounded-md border border-border bg-muted px-2.5 py-2 text-sm text-foreground outline-none [font-family:inherit]";
const TABLE_HEAD_CELL =
  "whitespace-nowrap border-b border-border bg-muted px-3 py-1.5 text-left text-xs font-medium text-muted-foreground";
const TABLE_CELL = "border-b border-border px-3 py-2 align-middle";

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
  // v0.9.5 · 行内「设为默认」快捷设置项目默认后端，免回基本信息 tab 手选
  const updateProject = useUpdateProject(project.id);
  const [aiEnabled, setAiEnabled] = useState(project.ai_enabled);
  const [mlBackendId, setMlBackendId] = useState<string | null>(
    project.ml_backend_id ?? null,
  );
  const [iouThreshold, setIouThreshold] = useState(project.iou_dedup_threshold ?? 0.7);
  const [textOutputDefault, setTextOutputDefault] = useState<string>(
    project.text_output_default ?? "",
  );

  useEffect(() => {
    setAiEnabled(project.ai_enabled);
    setMlBackendId(project.ml_backend_id ?? null);
    setIouThreshold(project.iou_dedup_threshold ?? 0.7);
    setTextOutputDefault(project.text_output_default ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id]);

  const aiSettingsDirty =
    aiEnabled !== project.ai_enabled ||
    (mlBackendId ?? null) !== (project.ml_backend_id ?? null) ||
    Math.abs(iouThreshold - (project.iou_dedup_threshold ?? 0.7)) > 0.001 ||
    textOutputDefault !== (project.text_output_default ?? "");

  useUnsavedWarning(aiSettingsDirty);

  const onSaveAiSettings = () => {
    updateProject.mutate(
      {
        ai_enabled: aiEnabled,
        ml_backend_id: aiEnabled ? mlBackendId : null,
        iou_dedup_threshold: iouThreshold,
        text_output_default: (textOutputDefault || null) as "box" | "mask" | "both" | null,
      },
      {
        onSuccess: () =>
          pushToast({ msg: "AI 预标注设置已保存", kind: "success" }),
        onError: (e) => pushToast({ msg: "保存失败", sub: (e as Error).message }),
      },
    );
  };

  const onBind = (b: MLBackendResponse) => {
    updateProject.mutate(
      {
        ml_backend_id: b.id,
        ai_enabled: true,
      } as Parameters<typeof updateProject.mutate>[0],
      {
        onSuccess: () =>
          pushToast({ msg: `已设为默认后端「${b.name}」`, kind: "success" }),
        onError: (e) => pushToast({ msg: "设置失败", sub: (e as Error).message }),
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
    ? `已达上限 ${limit}，请先删除现有后端`
    : undefined;

  return (
    <Card>
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3.5">
        <div>
          <h3 className="text-sm font-semibold">
            ML 模型
            <span
              data-testid="ml-backend-quota"
              className="ml-2 text-xs font-medium text-muted-foreground"
            >
              已用 {backends.length} / {limit > 0 ? limit : "∞"}
            </span>
          </h3>
          <div className="mt-0.5 text-xs text-muted-foreground">
            管理本项目作用域的 ML backend，并配置 AI 预标注入口。
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

      <div className="border-b border-border bg-background px-4 py-3.5">
        <div className="mb-3 flex items-center justify-between gap-3">
          <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-semibold">
            <input
              type="checkbox"
              checked={aiEnabled}
              onChange={(e) => setAiEnabled(e.target.checked)}
              className="accent-violet-500"
            />
            <Icon name="sparkles" size={14} className="text-status-info" />
            启用 AI 预标注
          </label>
          {aiSettingsDirty && (
            <span
              className="inline-flex items-center gap-1.5 text-xs font-medium text-status-caution"
              data-testid="ai-settings-unsaved"
            >
              <span className="size-1.5 rounded-full bg-amber-500" />
              有未保存的修改
            </span>
          )}
        </div>

        <div className="grid grid-cols-[minmax(260px,1.2fr)_minmax(220px,1fr)] gap-3.5 [&>:last-child]:col-span-full">
          <div>
            <label className={LABEL_CLASS}>默认 ML Backend</label>
            <select
              value={mlBackendId ?? ""}
              onChange={(e) => setMlBackendId(e.target.value || null)}
              disabled={!aiEnabled}
              className={cn(CONTROL_CLASS, "cursor-pointer")}
            >
              <option value="">未设默认（项目按肉眼标注运行，AI 待接入）</option>
              {backends.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                  {b.state === "connected" ? " · 在线" : ` · ${b.state}`}
                  {b.is_interactive ? " · 交互式" : ""}
                </option>
              ))}
            </select>
            <div className="mt-1 text-xs leading-normal text-muted-foreground">
              设为默认后，平台所有“模型名”展示均直接来自 backend.name；该后端作为工作台 / 批量页的默认选项，仍可在 AI 面板切换到其它已注册后端。后端专属推理参数在工作台 AI 面板按用户独立调整。
              {backends.length === 0 && (
                <span className="ml-1 text-status-caution">
                  暂无可用 backend；可先在本页注册。
                </span>
              )}
            </div>
          </div>

          <div>
            <label className={LABEL_CLASS}>
              AI 框去重阈值 <span className="font-normal text-muted-foreground">同类 AI 框与人工框 IoU 高于此值时淡化</span>
            </label>
            <div className="flex min-h-9 items-center gap-3">
              <input
                type="range"
                min={0.3}
                max={0.95}
                step={0.05}
                value={iouThreshold}
                onChange={(e) => setIouThreshold(Number(e.target.value))}
                disabled={!aiEnabled}
                className="flex-1 accent-violet-500"
              />
              <span className={cn("mono", "min-w-[48px] text-right text-sm text-foreground")}>
                {iouThreshold.toFixed(2)}
              </span>
            </div>
          </div>

          <div>
            <label className={LABEL_CLASS}>
              SAM 文本预标默认输出 <span className="font-normal text-muted-foreground">工作台“找全图”的初始值</span>
            </label>
            <TextOutputDefaultSelect
              value={textOutputDefault as TextOutputDefault}
              onChange={(v) => setTextOutputDefault(v)}
              disabled={!aiEnabled}
            />
          </div>
        </div>

        <div className="mt-3 flex justify-end">
          <Button
            variant="primary"
            disabled={!aiSettingsDirty || updateProject.isPending}
            onClick={onSaveAiSettings}
          >
            {updateProject.isPending ? "保存中..." : "保存 AI 设置"}
          </Button>
        </div>
      </div>

      <div className="p-3">
        {isLoading && (
          <div className="p-6 text-center text-sm text-muted-foreground">
            加载中…
          </div>
        )}
        {isError && (
          <div className="p-6 text-center text-sm text-status-danger">
            <Icon name="warning" size={14} className="mr-1.5" />
            加载失败：{(error as Error)?.message ?? "未知错误"}
          </div>
        )}
        {!isLoading && !isError && backends.length === 0 && (
          <div className="rounded-md border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            <Icon name="bot" size={28} className="mb-1.5 opacity-25" />
            <div>本项目暂未注册任何 ML backend</div>
            <div className="mt-1 text-xs">点击右上角「注册 backend」开始接入</div>
          </div>
        )}
        {!isLoading && backends.length > 0 && (
          <div className="w-full overflow-x-auto">
            <table className="w-full min-w-[1040px] border-separate border-spacing-0 text-sm">
              <thead>
                <tr>
                  {["名称", "URL", "类型", "能力", "状态", "最近检查", "操作"].map((h) => (
                    <th
                      key={h}
                      className={TABLE_HEAD_CELL}
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
                      <td className={TABLE_CELL}>
                        <div className="max-w-[180px] truncate" title={b.name}>{b.name}</div>
                      </td>
                      <td className={cn(TABLE_CELL, "mono max-w-[280px] truncate text-xs text-muted-foreground")} title={b.url}>
                        {b.url}
                      </td>
                      <td className={cn(TABLE_CELL, "whitespace-nowrap")}>
                        <Badge variant={b.is_interactive ? "ai" : "outline"}>
                          {b.is_interactive ? "交互式" : "批量"}
                        </Badge>
                      </td>
                      <td className={TABLE_CELL}>
                        {capQ?.isLoading && (
                          <span className="text-xs text-muted-foreground">…</span>
                        )}
                        {capQ?.isError && (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                        {cap?.supported_prompts && (
                          <div className="inline-flex flex-wrap gap-1">
                            {cap.supported_prompts.map((p) => (
                              <Badge key={p} variant="outline">
                                {p}
                              </Badge>
                            ))}
                            {/* v0.10.37 · 视频追踪能力 (supported_trackers 非空 ⇒ 支持 video 模态) */}
                            {cap.supported_trackers?.map((t) => (
                              <Badge key={t} variant="ai">
                                <Icon name="video" size={10} />
                                {t}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className={cn(TABLE_CELL, "whitespace-nowrap")}>
                        <Badge variant={STATE_VARIANT[b.state] ?? "outline"} dot>
                          {b.state}
                        </Badge>
                      </td>
                      <td className={cn(TABLE_CELL, "whitespace-nowrap text-muted-foreground")}>
                        {formatDate(b.last_checked_at)}
                      </td>
                      <td className={TABLE_CELL}>
                        <div className="inline-flex gap-1.5 whitespace-nowrap">
                        {project.ml_backend_id !== b.id && (
                          <Button
                            size="sm"
                            variant="ai"
                            onClick={() => onBind(b)}
                            disabled={!canManage || updateProject.isPending}
                            title={canManage ? "设为本项目默认后端（同时启用 AI）" : "需要 PROJECT_ADMIN 权限"}
                          >
                            设为默认
                          </Button>
                        )}
                        {project.ml_backend_id === b.id && (
                          <span className="self-center">
                            <Badge variant="ai">
                              默认
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
          </div>
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
