import { useEffect, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Icon } from "@/components/ui/Icon";
import { Modal } from "@/components/ui/Modal";
import { useToastStore } from "@/components/ui/Toast";
import {
  useAvailableMLBackends,
  useSetMLBackendEnablement,
  useMLBackendHealth,
} from "@/hooks/useMLBackends";
import { useUpdateProject } from "@/hooks/useProjects";
import { useUnsavedWarning } from "@/hooks/useUnsavedWarning";
import { usePermissions } from "@/hooks/usePermissions";
import {
  TextOutputDefaultSelect,
  type TextOutputDefault,
} from "@/components/projects/shared/TextOutputDefaultSelect";
import {
  mlBackendsApi,
  mlBackendSetupQueryKey,
  type MLBackendCapability,
  type ProjectMLBackendItem,
  type ProjectMLBackendEnablementPayload,
} from "@/api/ml-backends";
import type { ProjectResponse } from "@/api/projects";
import type { MLBackendResponse } from "@/types";
import { LABEL_CLASS } from "./formClasses";

function cn(...xs: Array<string | false | null | undefined>): string {
  return xs.filter(Boolean).join(" ");
}

const CONTROL_CLASS =
  "box-border w-full appearance-none rounded-md border border-border bg-muted px-2.5 py-2 text-sm text-foreground outline-none [font-family:inherit]";
const THRESHOLD_CLASS =
  "box-border w-20 appearance-none rounded-md border border-border bg-muted px-2 py-1 text-xs text-foreground outline-none [font-family:inherit]";
const TABLE_HEAD_CELL =
  "whitespace-nowrap border-b border-border bg-muted px-3 py-1.5 text-left text-xs font-medium text-muted-foreground";
const TABLE_CELL = "border-b border-border px-3 py-2 align-middle";

const STATE_VARIANT: Record<string, "success" | "warning" | "outline" | "danger"> = {
  connected: "success",
  disconnected: "outline",
  error: "danger",
};

// 项目级阈值覆盖输入: 本地态编辑, blur 时提交; 空 = 清除覆盖 (回落 backend 默认)。
function OverrideCell({
  item,
  disabled,
  onCommit,
}: {
  item: ProjectMLBackendItem;
  disabled: boolean;
  onCommit: (payload: ProjectMLBackendEnablementPayload) => void;
}) {
  const [box, setBox] = useState<string>(item.box_threshold?.toString() ?? "");
  const [text, setText] = useState<string>(item.text_threshold?.toString() ?? "");

  useEffect(() => {
    setBox(item.box_threshold?.toString() ?? "");
    setText(item.text_threshold?.toString() ?? "");
  }, [item.box_threshold, item.text_threshold]);

  const commit = (field: "box_threshold" | "text_threshold", raw: string) => {
    const trimmed = raw.trim();
    const next = trimmed === "" ? null : Number(trimmed);
    if (trimmed !== "" && Number.isNaN(next)) return;
    const current = field === "box_threshold" ? item.box_threshold : item.text_threshold;
    if ((next ?? null) === (current ?? null)) return;
    onCommit({ enabled: true, [field]: next });
  };

  return (
    <div className="flex flex-col gap-1.5">
      <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <span className="w-7">box</span>
        <input
          type="number"
          step={0.05}
          min={0}
          max={1}
          value={box}
          placeholder="默认"
          disabled={disabled}
          onChange={(e) => setBox(e.target.value)}
          onBlur={(e) => commit("box_threshold", e.target.value)}
          className={THRESHOLD_CLASS}
        />
      </label>
      <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <span className="w-7">text</span>
        <input
          type="number"
          step={0.05}
          min={0}
          max={1}
          value={text}
          placeholder="默认"
          disabled={disabled}
          onChange={(e) => setText(e.target.value)}
          onBlur={(e) => commit("text_threshold", e.target.value)}
          className={THRESHOLD_CLASS}
        />
      </label>
      {item.default_variants && Object.keys(item.default_variants).length > 0 && (
        <div className="mono max-w-[180px] truncate text-[11px] text-muted-foreground" title={JSON.stringify(item.default_variants)}>
          变体: {Object.entries(item.default_variants).map(([k, v]) => `${k}=${String(v)}`).join(", ")}
        </div>
      )}
    </div>
  );
}

// v0.19.0 · ADR-0044 · 「管理 backend」悬浮面板: 列出全部全局 backend, 在此勾选启用/停用
// + 编辑项目级阈值覆盖。主表只展示已启用项, 增删启用都在本面板里做。
function ManageBackendsPanel({
  open,
  onClose,
  items,
  canManage,
  pending,
  onToggle,
  onCommitOverride,
}: {
  open: boolean;
  onClose: () => void;
  items: ProjectMLBackendItem[];
  canManage: boolean;
  pending: boolean;
  onToggle: (item: ProjectMLBackendItem, next: boolean) => void;
  onCommitOverride: (
    item: ProjectMLBackendItem,
    payload: ProjectMLBackendEnablementPayload,
  ) => void;
}) {
  return (
    <Modal open={open} onClose={onClose} title="管理项目 ML backend" width={720}>
      <div className="mb-3 text-xs text-muted-foreground">
        勾选启用本项目要用的全局 backend，并可按项目调整阈值覆盖；全局 backend 由超管在「模型市场」注册。
      </div>
      {items.length === 0 ? (
        <div className="rounded-md border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          <Icon name="bot" size={28} className="mb-1.5 opacity-25" />
          <div>暂无可用的全局 ML backend</div>
          <div className="mt-1 text-xs">请由超管在「模型市场」注册全局 backend 后，在此勾选启用</div>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((item) => {
            const b = item.backend;
            return (
              <li
                key={b.id}
                className="flex items-start gap-3 rounded-md border border-border bg-background p-3"
              >
                <input
                  type="checkbox"
                  aria-label={`启用 ${b.name}`}
                  checked={item.enabled}
                  disabled={!canManage || pending}
                  onChange={(e) => onToggle(item, e.target.checked)}
                  className="mt-1 accent-violet-500"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium" title={b.name}>
                      {b.name}
                    </span>
                    <Badge variant={b.is_interactive ? "ai" : "outline"}>
                      {b.is_interactive ? "交互式" : "批量"}
                    </Badge>
                    <Badge variant={STATE_VARIANT[b.state] ?? "outline"} dot>
                      {b.state}
                    </Badge>
                  </div>
                  <div
                    className="mono mt-0.5 truncate text-xs text-muted-foreground"
                    title={b.url}
                  >
                    {b.url}
                  </div>
                  {item.enabled && (
                    <div className="mt-2">
                      <OverrideCell
                        item={item}
                        disabled={!canManage || pending}
                        onCommit={(payload) => onCommitOverride(item, payload)}
                      />
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Modal>
  );
}

export function MlBackendsSection({ project }: { project: ProjectResponse }) {
  const pushToast = useToastStore((s) => s.push);
  const { role } = usePermissions();
  const canManage = role === "super_admin" || role === "project_admin";

  const [manageOpen, setManageOpen] = useState(false);

  const { data, isLoading, isError, error } = useAvailableMLBackends(project.id);
  const items = data?.items ?? [];
  const enabledItems = items.filter((it) => it.enabled);
  const enabledBackends = enabledItems.map((it) => it.backend);

  const setEnablement = useSetMLBackendEnablement(project.id);
  const health = useMLBackendHealth(project.id);
  // 行内「设为主后端」快捷设置项目主后端，免回基本信息 tab 手选。
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
          pushToast({ msg: `已设为项目主后端「${b.name}」`, kind: "success" }),
        onError: (e) => pushToast({ msg: "设置失败", sub: (e as Error).message }),
      },
    );
  };

  // v0.19.0 · ADR-0044 · 启用/停用某全局 backend + 写项目级覆盖。覆盖缺省 = 不改动。
  const onToggleEnabled = (item: ProjectMLBackendItem, next: boolean) => {
    setEnablement.mutate(
      { registryId: item.backend.id, payload: { enabled: next } },
      {
        onSuccess: () =>
          pushToast({
            msg: next ? `已启用「${item.backend.name}」` : `已停用「${item.backend.name}」`,
            kind: "success",
          }),
        onError: (e) => pushToast({ msg: "操作失败", sub: (e as Error).message }),
      },
    );
  };

  const onCommitOverride = (
    item: ProjectMLBackendItem,
    payload: ProjectMLBackendEnablementPayload,
  ) => {
    setEnablement.mutate(
      { registryId: item.backend.id, payload },
      {
        onSuccess: () => pushToast({ msg: "项目级覆盖已保存", kind: "success" }),
        onError: (e) => pushToast({ msg: "保存失败", sub: (e as Error).message }),
      },
    );
  };

  // 仅对已启用 backend 拉 /setup 拿 supported_prompts; 失败容忍, 列显示 "—"。
  // 管理面板低频, 不做合并端点; 未来 N>5 再优化。
  const capabilities = useQueries({
    queries: enabledBackends.map((b) => ({
      queryKey: mlBackendSetupQueryKey(project.id, b.id),
      queryFn: () => mlBackendsApi.setup(project.id, b.id),
      staleTime: 60_000,
      retry: false,
    })),
  });
  const capById = new Map(enabledBackends.map((b, i) => [b.id, capabilities[i]]));

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
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3.5">
        <div>
          <h3 className="text-sm font-semibold">
            ML 模型
            <span
              data-testid="ml-backend-quota"
              className="ml-2 text-xs font-medium text-muted-foreground"
            >
              已启用 {enabledBackends.length} / {items.length}
            </span>
          </h3>
          <div className="mt-0.5 text-xs text-muted-foreground">
            本表仅显示本项目已启用的 ML backend；点「管理 backend」可启用/停用全局 backend 并调整项目级阈值覆盖。
          </div>
        </div>
        {canManage && (
          <Button
            variant="primary"
            onClick={() => setManageOpen(true)}
            disabled={isLoading || isError}
          >
            <Icon name="plus" size={13} />
            管理 backend
          </Button>
        )}
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
            <label className={LABEL_CLASS}>项目主后端</label>
            <select
              value={mlBackendId ?? ""}
              onChange={(e) => setMlBackendId(e.target.value || null)}
              disabled={!aiEnabled}
              className={cn(CONTROL_CLASS, "cursor-pointer")}
            >
              <option value="">未设项目主后端（项目按肉眼标注运行，AI 待接入）</option>
              {enabledBackends.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                  {b.state === "connected" ? " · 在线" : ` · ${b.state}`}
                  {b.is_interactive ? " · 交互式" : ""}
                </option>
              ))}
            </select>
            <div className="mt-1 text-xs leading-normal text-muted-foreground">
              项目主后端用于工作台 AI 与新建预标配置的初始选择 / fallback；多阶段预标注中，每个阶段显式选择的 backend/model 仍然独立生效。平台所有“模型名”展示均直接来自 backend.name。
              {enabledBackends.length === 0 && (
                <span className="ml-1 text-status-caution">
                  暂无已启用 backend；请在下方启用清单中勾选。
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
        {!isLoading && !isError && enabledItems.length === 0 && (
          <div className="rounded-md border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            <Icon name="bot" size={28} className="mb-1.5 opacity-25" />
            <div>本项目暂未启用任何 ML backend</div>
            <div className="mt-1 text-xs">
              {items.length > 0
                ? "点右上「管理 backend」从全局注册表勾选启用"
                : "请由超管在「模型市场」注册全局 backend 后，再来此启用"}
            </div>
          </div>
        )}
        {!isLoading && !isError && enabledItems.length > 0 && (
          <div className="w-full overflow-x-auto">
            <table className="w-full min-w-[920px] border-separate border-spacing-0 text-sm">
              <thead>
                <tr>
                  {["名称", "URL", "类型", "能力", "状态", "项目级覆盖", "操作"].map((h) => (
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
                {enabledItems.map((item) => {
                  const b = item.backend;
                  const capQ = capById.get(b.id);
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
                      <td className={TABLE_CELL}>
                        <OverrideCell
                          item={item}
                          disabled={!canManage || setEnablement.isPending}
                          onCommit={(payload) => onCommitOverride(item, payload)}
                        />
                      </td>
                      <td className={TABLE_CELL}>
                        <div className="inline-flex gap-1.5 whitespace-nowrap">
                        {project.ml_backend_id !== b.id && (
                          <Button
                            size="sm"
                            variant="ai"
                            onClick={() => onBind(b)}
                            disabled={!canManage || updateProject.isPending}
                            title={canManage ? "设为本项目主后端（同时启用 AI）" : "需要 PROJECT_ADMIN 权限"}
                          >
                            设为主后端
                          </Button>
                        )}
                        {project.ml_backend_id === b.id && (
                          <span className="self-center">
                            <Badge variant="ai">
                              主后端
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

      <ManageBackendsPanel
        open={manageOpen}
        onClose={() => setManageOpen(false)}
        items={items}
        canManage={canManage}
        pending={setEnablement.isPending}
        onToggle={onToggleEnabled}
        onCommitOverride={onCommitOverride}
      />
    </Card>
  );
}
