import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Badge } from "@/components/ui/Badge";
import { useToastStore } from "@/components/ui/Toast";
import {
  useApiKeys,
  useCreateApiKey,
  useRevokeApiKey,
} from "@/hooks/useApiKeys";
import type { ApiKey, ApiKeyCreated } from "@/api/apiKeys";

interface Props {
  open: boolean;
  onClose: () => void;
}

const SCOPE_OPTIONS: { id: string; label: string }[] = [
  { id: "annotations:read", label: "标注 - 读" },
  { id: "annotations:write", label: "标注 - 写" },
  { id: "predictions:read", label: "预测 - 读" },
  { id: "datasets:read", label: "数据集 - 读" },
];

function formatDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("zh-CN", { hour12: false });
}

export function ApiKeysModal({ open, onClose }: Props) {
  const { data: keys = [], isLoading } = useApiKeys(open);
  const createKey = useCreateApiKey();
  const revokeKey = useRevokeApiKey();
  const pushToast = useToastStore((s) => s.push);

  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>(["annotations:read"]);
  const [secret, setSecret] = useState<ApiKeyCreated | null>(null);

  useEffect(() => {
    if (!open) {
      setCreating(false);
      setName("");
      setScopes(["annotations:read"]);
      setSecret(null);
      createKey.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    createKey.mutate(
      { name: name.trim(), scopes },
      {
        onSuccess: (data) => {
          setSecret(data);
          setCreating(false);
        },
      },
    );
  };

  const onRevoke = (key: ApiKey) => {
    if (key.revoked_at) return;
    if (!confirm(`吊销 "${key.name}" ？此操作不可恢复。`)) return;
    revokeKey.mutate(key.id, {
      onSuccess: () => pushToast({ msg: "已吊销", kind: "success" }),
      onError: (err) =>
        pushToast({
          msg: "吊销失败",
          sub: err instanceof Error ? err.message : String(err),
          kind: "error",
        }),
    });
  };

  return (
    <Modal open={open} onClose={onClose} title="API 密钥" width={640}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12, fontSize: 13 }}>
        {secret ? (
          <SecretReveal
            data={secret}
            onAck={() => setSecret(null)}
            onCopy={async () => {
              try {
                await navigator.clipboard.writeText(secret.plaintext);
                pushToast({ msg: "已复制到剪贴板", kind: "success" });
              } catch {
                pushToast({ msg: "复制失败，请手动选择文本", kind: "warning" });
              }
            }}
          />
        ) : (
          <>
            <div style={{ color: "var(--color-fg-muted)" }}>
              密钥用于程序化访问 API（CI / 脚本）；创建后请立即复制保存，关闭弹窗后将无法再次查看明文。
            </div>

            {creating ? (
              <form
                onSubmit={submit}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                  padding: 12,
                  background: "var(--color-bg-sunken)",
                  border: "1px solid var(--color-border)",
                  borderRadius: "var(--radius-md)",
                }}
              >
                <Field label="名称">
                  <input
                    type="text"
                    autoFocus
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    maxLength={60}
                    placeholder="如 ci-bot / 数据导出脚本"
                    style={{
                      width: "100%",
                      padding: "7px 10px",
                      border: "1px solid var(--color-border)",
                      borderRadius: "var(--radius-md)",
                      background: "var(--color-bg-elev)",
                      fontSize: 13,
                    }}
                  />
                </Field>
                <Field label="权限范围（scope）">
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    {SCOPE_OPTIONS.map((opt) => (
                      <label
                        key={opt.id}
                        style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, cursor: "pointer" }}
                      >
                        <input
                          type="checkbox"
                          checked={scopes.includes(opt.id)}
                          onChange={(e) => {
                            setScopes((prev) =>
                              e.target.checked
                                ? [...prev, opt.id]
                                : prev.filter((s) => s !== opt.id),
                            );
                          }}
                        />
                        <code style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 11.5 }}>
                          {opt.id}
                        </code>
                        <span style={{ color: "var(--color-fg-muted)" }}>{opt.label}</span>
                      </label>
                    ))}
                  </div>
                </Field>
                <div style={{ fontSize: 11, color: "var(--color-fg-subtle)" }}>
                  注：v0.9.3 phase 1 仅记录 scope，未在路由层强制拦截；后续版本启用。
                </div>
                {createKey.isError && (
                  <div style={{ fontSize: 12, color: "var(--color-danger)" }}>
                    {(createKey.error as Error).message ?? "创建失败"}
                  </div>
                )}
                <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                  <Button type="button" onClick={() => setCreating(false)} disabled={createKey.isPending}>
                    取消
                  </Button>
                  <Button
                    type="submit"
                    variant="primary"
                    disabled={!name.trim() || createKey.isPending}
                  >
                    {createKey.isPending ? "创建中..." : "创建"}
                  </Button>
                </div>
              </form>
            ) : (
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <Button variant="primary" onClick={() => setCreating(true)}>
                  <Icon name="plus" size={12} /> 新建密钥
                </Button>
              </div>
            )}

            <div style={{ border: "1px solid var(--color-border)", borderRadius: "var(--radius-md)" }}>
              <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0, fontSize: 12.5 }}>
                <thead>
                  <tr>
                    {["名称", "前缀", "权限", "最后使用", "创建", ""].map((h, i) => (
                      <th
                        key={i}
                        style={{
                          textAlign: "left",
                          fontWeight: 500,
                          fontSize: 11,
                          color: "var(--color-fg-muted)",
                          padding: "8px 10px",
                          borderBottom: "1px solid var(--color-border)",
                          background: "var(--color-bg-sunken)",
                        }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {isLoading && (
                    <tr>
                      <td colSpan={6} style={{ textAlign: "center", padding: 24, color: "var(--color-fg-subtle)" }}>
                        加载中…
                      </td>
                    </tr>
                  )}
                  {!isLoading && keys.length === 0 && (
                    <tr>
                      <td colSpan={6} style={{ textAlign: "center", padding: 24, color: "var(--color-fg-subtle)" }}>
                        尚未创建任何密钥
                      </td>
                    </tr>
                  )}
                  {keys.map((k) => {
                    const revoked = !!k.revoked_at;
                    return (
                      <tr key={k.id} style={{ opacity: revoked ? 0.5 : 1 }}>
                        <td style={{ padding: "8px 10px", borderBottom: "1px solid var(--color-border)" }}>
                          {k.name}
                          {revoked && (
                            <Badge variant="outline" style={{ marginLeft: 6, fontSize: 10 }}>
                              已吊销
                            </Badge>
                          )}
                        </td>
                        <td
                          className="mono"
                          style={{
                            padding: "8px 10px",
                            borderBottom: "1px solid var(--color-border)",
                            fontFamily: "var(--font-mono, monospace)",
                            fontSize: 11.5,
                          }}
                        >
                          {k.key_prefix}…
                        </td>
                        <td style={{ padding: "8px 10px", borderBottom: "1px solid var(--color-border)" }}>
                          {k.scopes.length === 0 ? (
                            <span style={{ color: "var(--color-fg-subtle)" }}>—</span>
                          ) : (
                            <div style={{ display: "flex", gap: 3, flexWrap: "wrap" }}>
                              {k.scopes.map((s) => (
                                <Badge key={s} variant="outline" style={{ fontSize: 10 }}>
                                  {s}
                                </Badge>
                              ))}
                            </div>
                          )}
                        </td>
                        <td style={{ padding: "8px 10px", borderBottom: "1px solid var(--color-border)", color: "var(--color-fg-muted)" }}>
                          {formatDate(k.last_used_at)}
                        </td>
                        <td style={{ padding: "8px 10px", borderBottom: "1px solid var(--color-border)", color: "var(--color-fg-muted)" }}>
                          {formatDate(k.created_at)}
                        </td>
                        <td style={{ padding: "8px 10px", borderBottom: "1px solid var(--color-border)", textAlign: "right" }}>
                          {!revoked && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => onRevoke(k)}
                              disabled={revokeKey.isPending}
                              title="吊销密钥"
                            >
                              <Icon name="trash" size={11} style={{ color: "var(--color-danger)" }} />
                            </Button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{ fontSize: 11, color: "var(--color-fg-muted)", fontWeight: 500 }}>{label}</span>
      {children}
    </label>
  );
}

function SecretReveal({
  data,
  onAck,
  onCopy,
}: {
  data: ApiKeyCreated;
  onAck: () => void;
  onCopy: () => void | Promise<void>;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ color: "var(--color-fg-muted)" }}>
        密钥 <strong>{data.name}</strong> 已生成。请立即复制保存，关闭后无法再次查看。
      </div>
      <div
        style={{
          padding: 12,
          background: "var(--color-bg-sunken)",
          border: "1px dashed var(--color-warning)",
          borderRadius: "var(--radius-md)",
          fontFamily: "var(--font-mono, monospace)",
          fontSize: 13,
          fontWeight: 500,
          userSelect: "all",
          wordBreak: "break-all",
        }}
      >
        {data.plaintext}
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <Button onClick={() => onCopy()}>复制</Button>
        <Button variant="primary" onClick={onAck}>
          我已记下
        </Button>
      </div>
    </div>
  );
}
