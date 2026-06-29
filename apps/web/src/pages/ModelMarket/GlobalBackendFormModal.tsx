/**
 * v0.19.0 · ADR-0044 · superadmin 全局 ML backend 注册/编辑弹窗。
 *
 * 字段：name / url / 认证 / max_concurrency / extra_params + 测试连接，调用全局注册表端点：
 * 新建 = createRegistry，编辑 = updateRegistry。编辑时数据源（GlobalBackendItem）不含
 * extra_params，故仅当用户实际填写时才下发 extra_params / auth_token，避免把后端已有值覆盖为空。
 */
import { useEffect, useState } from "react";
import { clsx } from "clsx";
import { useQuery } from "@tanstack/react-query";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { useToastStore } from "@/components/ui/Toast";
import {
  adminMlIntegrationsApi,
  type ProbeResponse,
  type MLBackendRegistryCreatePayload,
  type MLBackendRegistryUpdatePayload,
} from "@/api/adminMlIntegrations";
import { useCreateRegistry, useUpdateRegistry } from "./useGlobalRegistry";

/** 编辑模式入参：来自 GlobalBackendItem 的最小子集（不含 extra_params）。 */
export interface GlobalRegistryEditTarget {
  id: string;
  name: string;
  url: string;
  auth_method: string;
}

interface Props {
  open: boolean;
  /** 提供则进入编辑模式 */
  backend?: GlobalRegistryEditTarget | null;
  onClose: () => void;
}

const LABEL_CLASS = "mb-1.5 block text-xs font-medium text-muted-foreground";
const INPUT_CLASS =
  "box-border w-full appearance-none rounded-md border border-border bg-muted px-2.5 py-2 text-sm text-foreground outline-none [font-family:inherit]";
const MONO_INPUT_CLASS = "font-mono text-xs";
const HELP_CLASS = "mt-1 text-2xs text-muted-foreground";

export function GlobalBackendFormModal({ open, backend, onClose }: Props) {
  const isEdit = !!backend;
  const pushToast = useToastStore((s) => s.push);
  const create = useCreateRegistry();
  const update = useUpdateRegistry();

  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [authMethod, setAuthMethod] = useState<"none" | "token">("none");
  const [authToken, setAuthToken] = useState("");
  const [maxConcurrency, setMaxConcurrency] = useState("");
  const [extraText, setExtraText] = useState("");
  const [extraOpen, setExtraOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hintsQ = useQuery({
    queryKey: ["admin", "ml-integrations", "runtime-hints"],
    queryFn: () => adminMlIntegrationsApi.runtimeHints(),
    staleTime: Infinity,
    enabled: open,
  });
  const urlPlaceholder = hintsQ.data?.ml_backend_default_url ?? "http://172.17.0.1:8001";

  const [probing, setProbing] = useState(false);
  const [probeResult, setProbeResult] = useState<ProbeResponse | null>(null);

  const onProbe = async () => {
    const trimmedUrl = url.trim();
    if (!trimmedUrl) {
      setProbeResult({ ok: false, latency_ms: 0, error: "请先填 URL" });
      return;
    }
    if (!/^https?:\/\//i.test(trimmedUrl)) {
      setProbeResult({ ok: false, latency_ms: 0, error: "URL 需 http(s):// 开头" });
      return;
    }
    setProbing(true);
    setProbeResult(null);
    try {
      const res = await adminMlIntegrationsApi.probe({
        url: trimmedUrl,
        auth_method: authMethod,
        auth_token: authMethod === "token" && authToken.trim() ? authToken.trim() : null,
      });
      setProbeResult(res);
    } catch (e) {
      setProbeResult({ ok: false, latency_ms: 0, error: (e as Error).message ?? "请求失败" });
    } finally {
      setProbing(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    setError(null);
    setProbeResult(null);
    if (backend) {
      setName(backend.name);
      setUrl(backend.url);
      setAuthMethod((backend.auth_method as "none" | "token") ?? "none");
      setAuthToken("");
      // GlobalBackendItem 不含 extra_params，编辑时留空，提交时不下发以保留后端原值。
      setMaxConcurrency("");
      setExtraText("");
      setExtraOpen(false);
    } else {
      setName("");
      setUrl("");
      setAuthMethod("none");
      setAuthToken("");
      setMaxConcurrency("");
      setExtraText("");
      setExtraOpen(false);
    }
  }, [open, backend]);

  const submitting = create.isPending || update.isPending;

  const onSubmit = async () => {
    setError(null);
    const trimmedName = name.trim();
    const trimmedUrl = url.trim();
    if (!trimmedName) {
      setError("名称不能为空");
      return;
    }
    if (!trimmedUrl) {
      setError("URL 不能为空");
      return;
    }
    if (!/^https?:\/\//i.test(trimmedUrl)) {
      setError("URL 需以 http:// 或 https:// 开头");
      return;
    }

    // extra_params：仅当用户填了 textarea 或 max_concurrency 时才构造并下发。
    let extraParams: Record<string, unknown> | undefined;
    if (extraText.trim()) {
      try {
        const parsed = JSON.parse(extraText);
        if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
          throw new Error("extra_params 必须是 JSON 对象");
        }
        extraParams = parsed as Record<string, unknown>;
      } catch (e) {
        setError(`extra_params JSON 解析失败：${(e as Error).message}`);
        return;
      }
    }
    if (maxConcurrency.trim()) {
      const mc = Number(maxConcurrency);
      if (!Number.isInteger(mc) || mc < 1 || mc > 32) {
        setError("max_concurrency 需为 1-32 整数");
        return;
      }
      extraParams = { ...(extraParams ?? {}), max_concurrency: mc };
    }

    const token = authMethod === "token" && authToken.trim() ? authToken.trim() : undefined;

    try {
      if (isEdit && backend) {
        const payload: MLBackendRegistryUpdatePayload = {
          name: trimmedName,
          url: trimmedUrl,
          auth_method: authMethod,
        };
        if (extraParams !== undefined) payload.extra_params = extraParams;
        if (token) payload.auth_token = token;
        await update.mutateAsync({ id: backend.id, payload });
        pushToast({ msg: "已更新全局 backend", kind: "success" });
      } else {
        const payload: MLBackendRegistryCreatePayload = {
          name: trimmedName,
          url: trimmedUrl,
          auth_method: authMethod,
        };
        if (extraParams !== undefined) payload.extra_params = extraParams;
        if (token) payload.auth_token = token;
        await create.mutateAsync(payload);
        pushToast({ msg: "已注册全局 backend", kind: "success" });
      }
      onClose();
    } catch (e) {
      const apiErr = e as { status?: number; message?: string };
      if (apiErr.status === 409) {
        setError(apiErr.message || "该 URL 已被注册（不可重复）");
        return;
      }
      setError(apiErr.message ?? "请求失败");
    }
  };

  return (
    <Modal
      open={open}
      onClose={submitting ? () => {} : onClose}
      title={isEdit ? "编辑全局 ML Backend" : "注册全局 ML Backend"}
      width={560}
    >
      <div className="flex flex-col gap-3.5">
        <div>
          <label className={LABEL_CLASS}>名称</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例如 grounded-sam2-prod"
            maxLength={120}
            className={INPUT_CLASS}
          />
        </div>
        <div>
          <label className={LABEL_CLASS}>URL</label>
          <input
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              setProbeResult(null);
            }}
            placeholder={urlPlaceholder}
            className={clsx(INPUT_CLASS, MONO_INPUT_CLASS)}
          />
          <div className={HELP_CLASS}>
            后端容器内可达地址。Docker 同主机宿主网常用 <span className="font-mono">172.17.0.1</span>。
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button size="sm" variant="ghost" onClick={onProbe} disabled={probing}>
              {probing ? (
                <Icon name="loader2" size={11} className="spin" />
              ) : (
                <Icon name="activity" size={11} />
              )}
              {probing ? "探测中..." : "测试连接"}
            </Button>
            {probeResult && (
              <span
                className={clsx(
                  "inline-flex items-center gap-1 text-xs",
                  probeResult.ok ? "text-status-positive" : "text-status-danger",
                )}
              >
                <Icon name={probeResult.ok ? "check" : "warning"} size={11} />
                {probeResult.ok ? (
                  <>
                    已连接 ({probeResult.latency_ms}ms
                    {probeResult.model_version ? `, ${probeResult.model_version}` : ""})
                  </>
                ) : (
                  <>无法连接：{probeResult.error ?? "未知错误"}</>
                )}
              </span>
            )}
          </div>
        </div>
        <div className={HELP_CLASS}>
          <Icon name="sparkles" size={12} className="mr-1 inline text-chart-4" />
          交互能力 / 支持模态（图像 prompt、视频 tracker）将在健康检查时从 backend 自报的{" "}
          <span className="font-mono">/setup</span> 自动探测，无需手填。
        </div>
        <div>
          <label className={LABEL_CLASS}>认证方式</label>
          <select
            value={authMethod}
            onChange={(e) => setAuthMethod(e.target.value as "none" | "token")}
            className={clsx(INPUT_CLASS, "cursor-pointer")}
          >
            <option value="none">none（无认证）</option>
            <option value="token">token（Bearer header）</option>
          </select>
          {authMethod === "token" && (
            <div className="mt-2">
              <label className={LABEL_CLASS}>Token</label>
              <input
                type="password"
                value={authToken}
                onChange={(e) => setAuthToken(e.target.value)}
                placeholder={isEdit ? "••• 留空则保持原值" : "Bearer token"}
                className={INPUT_CLASS}
              />
            </div>
          )}
        </div>
        <div>
          <label className={LABEL_CLASS}>最大并发（max_concurrency）</label>
          <input
            type="number"
            min={1}
            max={32}
            value={maxConcurrency}
            onChange={(e) => setMaxConcurrency(e.target.value)}
            placeholder={isEdit ? "留空保持原值" : "默认 4"}
            className={clsx(INPUT_CLASS, "w-[120px]")}
          />
          <div className={HELP_CLASS}>
            单 backend 同时处理的预标请求上限；{isEdit ? "留空保持原值。" : "留空走默认（4）。"}
          </div>
        </div>
        <div>
          <button
            type="button"
            onClick={() => setExtraOpen((s) => !s)}
            className="inline-flex cursor-pointer appearance-none items-center gap-1 border-0 bg-transparent p-0 text-xs text-muted-foreground [font-family:inherit]"
          >
            <Icon name={extraOpen ? "chevDown" : "chevRight"} size={12} />
            高级 · extra_params (JSON)
          </button>
          {extraOpen && (
            <textarea
              value={extraText}
              onChange={(e) => setExtraText(e.target.value)}
              placeholder='{ "model_size": "large" }'
              rows={4}
              className={clsx(INPUT_CLASS, MONO_INPUT_CLASS, "mt-1.5 resize-y")}
            />
          )}
          {isEdit && (
            <div className={HELP_CLASS}>编辑时留空不会清除后端已有的 extra_params。</div>
          )}
        </div>
        {error && (
          <div className="flex items-start gap-1.5 rounded-md border border-status-danger bg-status-danger-soft px-2.5 py-2 text-xs text-status-danger">
            <Icon name="warning" size={12} className="mt-0.5 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            取消
          </Button>
          <Button variant="primary" onClick={onSubmit} disabled={submitting}>
            {submitting ? "提交中..." : isEdit ? "保存" : "注册"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
