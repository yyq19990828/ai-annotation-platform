import { useEffect, useState, type CSSProperties } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { useToastStore } from "@/components/ui/Toast";
import {
  useCreateMLBackend,
  useUpdateMLBackend,
} from "@/hooks/useMLBackends";
import type {
  MLBackendCreatePayload,
  MLBackendUpdatePayload,
} from "@/api/ml-backends";
import type { MLBackendResponse } from "@/types";

interface Props {
  open: boolean;
  projectId: string;
  /** 提供则进入编辑模式 */
  backend?: MLBackendResponse | null;
  onClose: () => void;
}

const labelStyle: CSSProperties = {
  display: "block",
  fontSize: 12,
  fontWeight: 500,
  color: "var(--color-fg-muted)",
  marginBottom: 6,
};

const inputStyle: CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "8px 11px",
  fontSize: 13.5,
  background: "var(--color-bg-sunken)",
  border: "1px solid var(--color-border)",
  borderRadius: "var(--radius-md)",
  color: "var(--color-fg)",
  outline: "none",
  fontFamily: "inherit",
};

export function MlBackendFormModal({ open, projectId, backend, onClose }: Props) {
  const isEdit = !!backend;
  const pushToast = useToastStore((s) => s.push);
  const create = useCreateMLBackend(projectId);
  const update = useUpdateMLBackend(projectId);

  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [isInteractive, setIsInteractive] = useState(false);
  const [authMethod, setAuthMethod] = useState<"none" | "token">("none");
  const [authToken, setAuthToken] = useState("");
  const [extraText, setExtraText] = useState("");
  const [extraOpen, setExtraOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (backend) {
      setName(backend.name);
      setUrl(backend.url);
      setIsInteractive(backend.is_interactive);
      setAuthMethod((backend.auth_method as "none" | "token") ?? "none");
      setAuthToken("");
      const extra = backend.extra_params ?? {};
      setExtraText(Object.keys(extra).length ? JSON.stringify(extra, null, 2) : "");
      setExtraOpen(Object.keys(extra).length > 0);
    } else {
      setName("");
      setUrl("");
      setIsInteractive(false);
      setAuthMethod("none");
      setAuthToken("");
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

    let extraParams: Record<string, unknown> = {};
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

    try {
      if (isEdit && backend) {
        const payload: MLBackendUpdatePayload = {
          name: trimmedName,
          url: trimmedUrl,
          is_interactive: isInteractive,
          auth_method: authMethod,
          extra_params: extraParams,
        };
        if (authMethod === "token" && authToken.trim()) {
          payload.auth_token = authToken.trim();
        }
        await update.mutateAsync({ backendId: backend.id, payload });
        pushToast({ msg: "已更新 backend", kind: "success" });
      } else {
        const payload: MLBackendCreatePayload = {
          name: trimmedName,
          url: trimmedUrl,
          is_interactive: isInteractive,
          auth_method: authMethod,
          extra_params: extraParams,
        };
        if (authMethod === "token" && authToken.trim()) {
          payload.auth_token = authToken.trim();
        }
        await create.mutateAsync(payload);
        pushToast({ msg: "已注册 backend", kind: "success" });
      }
      onClose();
    } catch (e) {
      const err = e as { response?: { data?: { detail?: string } }; message?: string };
      setError(err.response?.data?.detail ?? err.message ?? "请求失败");
    }
  };

  return (
    <Modal
      open={open}
      onClose={submitting ? () => {} : onClose}
      title={isEdit ? "编辑 ML Backend" : "注册 ML Backend"}
      width={560}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div>
          <label style={labelStyle}>名称</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例如 grounded-sam2-prod"
            maxLength={120}
            style={inputStyle}
          />
        </div>
        <div>
          <label style={labelStyle}>URL</label>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="http://172.17.0.1:8001"
            style={{ ...inputStyle, fontFamily: "var(--font-mono, monospace)", fontSize: 12.5 }}
          />
          <div style={{ fontSize: 11, color: "var(--color-fg-subtle)", marginTop: 4 }}>
            后端容器内可达地址。Docker 同主机宿主网常用 <span className="mono">172.17.0.1</span>。
          </div>
        </div>
        <div>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={isInteractive}
              onChange={(e) => setIsInteractive(e.target.checked)}
              style={{ accentColor: "var(--color-ai)" }}
            />
            <Icon name="sparkles" size={14} style={{ color: "var(--color-ai)" }} />
            交互式 backend
          </label>
          <div style={{ fontSize: 11, color: "var(--color-fg-subtle)", marginTop: 4, marginLeft: 24 }}>
            支持 SAM 等点 / 框 prompt；批量预标注 backend 不需勾选。
          </div>
        </div>
        <div>
          <label style={labelStyle}>认证方式</label>
          <select
            value={authMethod}
            onChange={(e) => setAuthMethod(e.target.value as "none" | "token")}
            style={{ ...inputStyle, cursor: "pointer" }}
          >
            <option value="none">none（无认证）</option>
            <option value="token">token（Bearer header）</option>
          </select>
          {authMethod === "token" && (
            <div style={{ marginTop: 8 }}>
              <label style={labelStyle}>Token</label>
              <input
                type="password"
                value={authToken}
                onChange={(e) => setAuthToken(e.target.value)}
                placeholder={isEdit ? "••• 留空则保持原值" : "Bearer token"}
                style={inputStyle}
              />
            </div>
          )}
        </div>
        <div>
          <button
            type="button"
            onClick={() => setExtraOpen((s) => !s)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              fontSize: 12,
              color: "var(--color-fg-muted)",
              background: "transparent",
              border: "none",
              padding: 0,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
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
              style={{
                ...inputStyle,
                marginTop: 6,
                fontFamily: "var(--font-mono, monospace)",
                fontSize: 12,
                resize: "vertical",
              }}
            />
          )}
        </div>
        {error && (
          <div
            style={{
              padding: "8px 11px",
              fontSize: 12,
              color: "var(--color-danger)",
              background: "var(--color-danger-soft, transparent)",
              border: "1px solid var(--color-danger)",
              borderRadius: "var(--radius-md)",
              display: "flex",
              alignItems: "flex-start",
              gap: 6,
            }}
          >
            <Icon name="warning" size={12} style={{ marginTop: 2, flexShrink: 0 }} />
            <span>{error}</span>
          </div>
        )}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
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
