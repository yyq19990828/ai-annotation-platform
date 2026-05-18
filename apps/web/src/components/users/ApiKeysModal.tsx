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
import styles from "./ApiKeysModal.module.css";

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
      <div className={styles.root}>
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
            <div className={styles.muted}>
              密钥用于程序化访问 API（CI / 脚本）；创建后请立即复制保存，关闭弹窗后将无法再次查看明文。
            </div>

            {creating ? (
              <form
                onSubmit={submit}
                className={styles.createForm}
              >
                <Field label="名称">
                  <input
                    type="text"
                    autoFocus
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    maxLength={60}
                    placeholder="如 ci-bot / 数据导出脚本"
                    className={styles.input}
                  />
                </Field>
                <Field label="权限范围（scope）">
                  <div className={styles.scopeList}>
                    {SCOPE_OPTIONS.map((opt) => (
                      <label
                        key={opt.id}
                        className={styles.scopeOption}
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
                        <code className={styles.scopeCode}>
                          {opt.id}
                        </code>
                        <span className={styles.muted}>{opt.label}</span>
                      </label>
                    ))}
                  </div>
                </Field>
                <div className={styles.note}>
                  注：v0.9.3 phase 1 仅记录 scope，未在路由层强制拦截；后续版本启用。
                </div>
                {createKey.isError && (
                  <div className={styles.errorText}>
                    {(createKey.error as Error).message ?? "创建失败"}
                  </div>
                )}
                <div className={styles.actions}>
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
              <div className={styles.rightAction}>
                <Button variant="primary" onClick={() => setCreating(true)}>
                  <Icon name="plus" size={12} /> 新建密钥
                </Button>
              </div>
            )}

            <div className={styles.tableShell}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    {["名称", "前缀", "权限", "最后使用", "创建", ""].map((h, i) => (
                      <th
                        key={i}
                        className={styles.th}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {isLoading && (
                    <tr>
                      <td colSpan={6} className={styles.emptyCell}>
                        加载中…
                      </td>
                    </tr>
                  )}
                  {!isLoading && keys.length === 0 && (
                    <tr>
                      <td colSpan={6} className={styles.emptyCell}>
                        尚未创建任何密钥
                      </td>
                    </tr>
                  )}
                  {keys.map((k) => {
                    const revoked = !!k.revoked_at;
                    return (
                      <tr key={k.id} className={revoked ? styles.revokedRow : undefined}>
                        <td className={styles.cell}>
                          {k.name}
                          {revoked && (
                            <span className={styles.revokedBadge}>
                              <Badge variant="outline">
                              已吊销
                              </Badge>
                            </span>
                          )}
                        </td>
                        <td
                          className={`${styles.cell} mono ${styles.keyPrefix}`}
                        >
                          {k.key_prefix}…
                        </td>
                        <td className={styles.cell}>
                          {k.scopes.length === 0 ? (
                            <span className={styles.subtle}>—</span>
                          ) : (
                            <div className={styles.scopeBadges}>
                              {k.scopes.map((s) => (
                                <Badge key={s} variant="outline">
                                  {s}
                                </Badge>
                              ))}
                            </div>
                          )}
                        </td>
                        <td className={`${styles.cell} ${styles.dateCell}`}>
                          {formatDate(k.last_used_at)}
                        </td>
                        <td className={`${styles.cell} ${styles.dateCell}`}>
                          {formatDate(k.created_at)}
                        </td>
                        <td className={`${styles.cell} ${styles.actionsCell}`}>
                          {!revoked && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => onRevoke(k)}
                              disabled={revokeKey.isPending}
                              title="吊销密钥"
                            >
                              <Icon name="trash" size={11} className={styles.dangerIcon} />
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
    <label className={styles.field}>
      <span className={styles.fieldLabel}>{label}</span>
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
    <div className={styles.secretRoot}>
      <div className={styles.muted}>
        密钥 <strong>{data.name}</strong> 已生成。请立即复制保存，关闭后无法再次查看。
      </div>
      <div
        className={styles.secretBox}
      >
        {data.plaintext}
      </div>
      <div className={styles.actions}>
        <Button onClick={() => onCopy()}>复制</Button>
        <Button variant="primary" onClick={onAck}>
          我已记下
        </Button>
      </div>
    </div>
  );
}
