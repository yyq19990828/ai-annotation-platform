import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Modal } from "@/components/ui/Modal";
import { useToastStore } from "@/components/ui/Toast";
import { usePermissions } from "@/hooks/usePermissions";
import {
  useCreateStorageConnection,
  useDeleteStorageConnection,
  useStorageConnections,
  useTestStorageConnection,
  useUpdateStorageConnection,
} from "@/hooks/useStorageConnections";
import type {
  StorageConnection,
  StorageConnectionKind,
  StorageConnectionScope,
  StorageConnectionTestResult,
} from "@/api/storageConnections";
import styles from "./StorageConnectionsPanel.module.css";

export interface StorageConnectionFormValues {
  name: string;
  kind: StorageConnectionKind;
  scope: StorageConnectionScope;
  config: Record<string, unknown>;
  secret?: Record<string, unknown>;
}

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function asString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function asNumberString(value: unknown) {
  return typeof value === "number" ? String(value) : "";
}

function connectionSummary(conn: StorageConnection) {
  if (conn.kind === "s3") {
    return [
      asString(conn.config.bucket),
      asString(conn.config.endpoint),
      asString(conn.config.base_prefix),
    ]
      .filter(Boolean)
      .join(" / ");
  }
  return [
    asString(conn.config.username),
    asString(conn.config.host),
    asString(conn.config.base_path),
  ]
    .filter(Boolean)
    .join(" / ");
}

function roleLabel(scope: StorageConnectionScope) {
  return scope === "global" ? "全局" : "个人";
}

export function StorageConnectionForm({
  connection,
  isSuper,
  compact = false,
  submitLabel,
  submitting = false,
  onSubmit,
  onCancel,
}: {
  connection?: StorageConnection | null;
  isSuper: boolean;
  compact?: boolean;
  submitLabel?: string;
  submitting?: boolean;
  onSubmit: (values: StorageConnectionFormValues) => Promise<void> | void;
  onCancel?: () => void;
}) {
  const cfg = connection?.config ?? {};
  const isEditing = !!connection;
  const [name, setName] = useState(connection?.name ?? "");
  const [kind, setKind] = useState<StorageConnectionKind>(connection?.kind ?? "s3");
  const [scope, setScope] = useState<StorageConnectionScope>(
    connection?.scope ?? "owner",
  );
  const [endpoint, setEndpoint] = useState(asString(cfg.endpoint));
  const [bucket, setBucket] = useState(asString(cfg.bucket));
  const [region, setRegion] = useState(asString(cfg.region));
  const [basePrefix, setBasePrefix] = useState(asString(cfg.base_prefix));
  const [useSsl, setUseSsl] = useState(Boolean(cfg.use_ssl));
  const [accessKey, setAccessKey] = useState("");
  const [secretKey, setSecretKey] = useState("");
  const [host, setHost] = useState(asString(cfg.host));
  const [port, setPort] = useState(asNumberString(cfg.port));
  const [username, setUsername] = useState(asString(cfg.username));
  const [basePath, setBasePath] = useState(asString(cfg.base_path));
  const [authType, setAuthType] = useState<"password" | "key">(
    asString(cfg.auth_type) === "key" ? "key" : "password",
  );
  const [password, setPassword] = useState("");
  const [privateKey, setPrivateKey] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [error, setError] = useState<string | null>(null);

  const effectiveScope = isSuper ? scope : "owner";

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const cleanName = name.trim();
    const needsS3Secret = !isEditing || accessKey.trim() || secretKey.trim();
    const needsSftpSecret =
      !isEditing || password.trim() || privateKey.trim() || passphrase.trim();
    const nextErrors: string[] = [];

    if (!cleanName) nextErrors.push("请输入连接器名称");
    if (kind === "s3") {
      if (!endpoint.trim()) nextErrors.push("请输入 S3 endpoint");
      if (!bucket.trim()) nextErrors.push("请输入 bucket");
      if (needsS3Secret && (!accessKey.trim() || !secretKey.trim())) {
        nextErrors.push("请输入 access key 与 secret key");
      }
    } else {
      if (!host.trim()) nextErrors.push("请输入 SFTP host");
      if (!username.trim()) nextErrors.push("请输入用户名");
      if (needsSftpSecret && authType === "password" && !password.trim()) {
        nextErrors.push("请输入密码");
      }
      if (needsSftpSecret && authType === "key" && !privateKey.trim()) {
        nextErrors.push("请输入私钥");
      }
    }

    if (nextErrors.length) {
      setError(nextErrors[0]);
      return;
    }

    const config: Record<string, unknown> =
      kind === "s3"
        ? {
            endpoint: endpoint.trim(),
            bucket: bucket.trim(),
            use_ssl: useSsl,
          }
        : {
            host: host.trim(),
            username: username.trim(),
            auth_type: authType,
          };
    if (kind === "s3") {
      if (region.trim()) config.region = region.trim();
      if (basePrefix.trim()) config.base_prefix = basePrefix.trim();
    } else {
      if (port.trim()) config.port = Number(port);
      if (basePath.trim()) config.base_path = basePath.trim();
    }

    let secret: Record<string, unknown> | undefined;
    if (kind === "s3" && needsS3Secret) {
      secret = {
        access_key: accessKey.trim(),
        secret_key: secretKey.trim(),
      };
    } else if (kind === "sftp" && needsSftpSecret) {
      secret =
        authType === "key"
          ? {
              private_key: privateKey,
              ...(passphrase.trim() ? { passphrase: passphrase.trim() } : {}),
            }
          : { password };
    }

    setError(null);
    await onSubmit({
      name: cleanName,
      kind,
      scope: effectiveScope,
      config,
      secret,
    });
  };

  return (
    <form
      className={cx(styles.form, compact && styles.formCompact)}
      onSubmit={handleSubmit}
    >
      <div className={styles.formGrid}>
        <label className={styles.field}>
          <span>名称</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            className={styles.input}
            placeholder="external-data"
          />
        </label>
        <label className={styles.field}>
          <span>类型</span>
          <select
            value={kind}
            onChange={(event) => setKind(event.target.value as StorageConnectionKind)}
            disabled={isEditing}
            className={styles.input}
          >
            <option value="s3">S3 / OSS</option>
            <option value="sftp">SFTP</option>
          </select>
        </label>
        <label className={styles.field}>
          <span>范围</span>
          <select
            value={effectiveScope}
            onChange={(event) => setScope(event.target.value as StorageConnectionScope)}
            disabled={!isSuper || isEditing}
            className={styles.input}
          >
            <option value="owner">个人</option>
            {isSuper && <option value="global">全局</option>}
          </select>
        </label>
      </div>

      {kind === "s3" ? (
        <div className={styles.formGrid}>
          <label className={styles.fieldWide}>
            <span>Endpoint</span>
            <input
              value={endpoint}
              onChange={(event) => setEndpoint(event.target.value)}
              className={styles.input}
              placeholder="http://minio.example:9000"
            />
          </label>
          <label className={styles.field}>
            <span>Bucket</span>
            <input
              value={bucket}
              onChange={(event) => setBucket(event.target.value)}
              className={styles.input}
              placeholder="datasets"
            />
          </label>
          <label className={styles.field}>
            <span>Region</span>
            <input
              value={region}
              onChange={(event) => setRegion(event.target.value)}
              className={styles.input}
              placeholder="auto"
            />
          </label>
          <label className={styles.fieldWide}>
            <span>Base prefix</span>
            <input
              value={basePrefix}
              onChange={(event) => setBasePrefix(event.target.value)}
              className={styles.input}
              placeholder="imports/"
            />
          </label>
          <label className={styles.checkField}>
            <input
              type="checkbox"
              checked={useSsl}
              onChange={(event) => setUseSsl(event.target.checked)}
            />
            <span>HTTPS</span>
          </label>
          <label className={styles.field}>
            <span>Access key</span>
            <input
              value={accessKey}
              onChange={(event) => setAccessKey(event.target.value)}
              className={styles.input}
              placeholder={isEditing ? "不修改" : "AK"}
            />
          </label>
          <label className={styles.field}>
            <span>Secret key</span>
            <input
              value={secretKey}
              onChange={(event) => setSecretKey(event.target.value)}
              className={styles.input}
              type="password"
              placeholder={isEditing ? "不修改" : "SK"}
            />
          </label>
        </div>
      ) : (
        <div className={styles.formGrid}>
          <label className={styles.fieldWide}>
            <span>Host</span>
            <input
              value={host}
              onChange={(event) => setHost(event.target.value)}
              className={styles.input}
              placeholder="sftp.example.local"
            />
          </label>
          <label className={styles.field}>
            <span>Port</span>
            <input
              value={port}
              onChange={(event) => setPort(event.target.value)}
              className={styles.input}
              inputMode="numeric"
              placeholder="22"
            />
          </label>
          <label className={styles.field}>
            <span>Username</span>
            <input
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              className={styles.input}
              placeholder="annotator"
            />
          </label>
          <label className={styles.fieldWide}>
            <span>Base path</span>
            <input
              value={basePath}
              onChange={(event) => setBasePath(event.target.value)}
              className={styles.input}
              placeholder="/incoming"
            />
          </label>
          <label className={styles.field}>
            <span>Auth</span>
            <select
              value={authType}
              onChange={(event) => setAuthType(event.target.value as "password" | "key")}
              className={styles.input}
            >
              <option value="password">Password</option>
              <option value="key">Private key</option>
            </select>
          </label>
          {authType === "password" ? (
            <label className={styles.field}>
              <span>Password</span>
              <input
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className={styles.input}
                type="password"
                placeholder={isEditing ? "不修改" : "password"}
              />
            </label>
          ) : (
            <>
              <label className={styles.fieldWide}>
                <span>Private key</span>
                <textarea
                  value={privateKey}
                  onChange={(event) => setPrivateKey(event.target.value)}
                  className={styles.textarea}
                  rows={compact ? 3 : 4}
                  placeholder={isEditing ? "不修改" : "-----BEGIN RSA PRIVATE KEY-----"}
                />
              </label>
              <label className={styles.field}>
                <span>Passphrase</span>
                <input
                  value={passphrase}
                  onChange={(event) => setPassphrase(event.target.value)}
                  className={styles.input}
                  type="password"
                />
              </label>
            </>
          )}
        </div>
      )}

      {error && <div className={styles.formError}>{error}</div>}

      <div className={styles.formActions}>
        {onCancel && (
          <Button type="button" onClick={onCancel}>
            取消
          </Button>
        )}
        <Button type="submit" variant="primary" disabled={submitting}>
          <Icon name={isEditing ? "save" : "plus"} size={13} />
          {submitting ? "保存中..." : submitLabel ?? (isEditing ? "保存" : "新建连接器")}
        </Button>
      </div>
    </form>
  );
}

export function StorageConnectionsPanel({
  showForm: showFormProp,
  onShowFormChange,
  hideHeaderAction = false,
}: {
  showForm?: boolean;
  onShowFormChange?: (open: boolean) => void;
  hideHeaderAction?: boolean;
} = {}) {
  const { role } = usePermissions();
  const isSuper = role === "super_admin";
  const canManage = isSuper || role === "project_admin";
  const pushToast = useToastStore((s) => s.push);
  const { data: connections = [], isLoading } = useStorageConnections();
  const createMutation = useCreateStorageConnection();
  const updateMutation = useUpdateStorageConnection();
  const deleteMutation = useDeleteStorageConnection();
  const testMutation = useTestStorageConnection();
  const [showFormLocal, setShowFormLocal] = useState(false);
  const showForm = showFormProp ?? showFormLocal;
  const setShowForm = onShowFormChange ?? setShowFormLocal;
  const [editing, setEditing] = useState<StorageConnection | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, StorageConnectionTestResult>>({});

  const submitConnection = async (values: StorageConnectionFormValues) => {
    if (editing) {
      await updateMutation.mutateAsync({
        id: editing.id,
        payload: {
          name: values.name,
          config: values.config,
          ...(values.secret ? { secret: values.secret } : {}),
        },
      });
      pushToast({ msg: "连接器已更新" });
    } else {
      await createMutation.mutateAsync({
        name: values.name,
        kind: values.kind,
        scope: values.scope,
        config: values.config,
        secret: values.secret ?? {},
      });
      pushToast({ msg: "连接器已创建" });
    }
    setEditing(null);
    setShowForm(false);
  };

  const runTest = (id: string) => {
    setTestingId(id);
    testMutation.mutate(id, {
      onSuccess: (result) => {
        setTestResults((prev) => ({ ...prev, [id]: result }));
        pushToast({
          msg: result.ok ? "连接成功" : "连接失败",
          sub: result.message,
          kind: result.ok ? "success" : "warning",
        });
      },
      onSettled: () => setTestingId(null),
    });
  };

  const removeConnection = (conn: StorageConnection) => {
    if (!window.confirm(`删除连接器 "${conn.name}"？`)) return;
    deleteMutation.mutate(conn.id, {
      onSuccess: () => pushToast({ msg: "连接器已删除" }),
    });
  };

  return (
    <section className={styles.panel}>
      <div className={styles.panelHeader}>
        <div>
          <h3 className={styles.title}>数据源连接器</h3>
          <div className={styles.subtitle}>S3 / OSS / SFTP</div>
        </div>
        {canManage && !hideHeaderAction && (
          <Button
            size="sm"
            variant="primary"
            onClick={() => {
              setEditing(null);
              setShowForm(true);
            }}
          >
            <Icon name="plus" size={12} />
            新建数据源
          </Button>
        )}
      </div>

      {canManage && (
        <Modal
          open={showForm}
          onClose={() => {
            setEditing(null);
            setShowForm(false);
          }}
          title={editing ? "编辑数据源" : "新建数据源"}
          width={640}
        >
          <StorageConnectionForm
            key={editing?.id ?? "new"}
            connection={editing}
            isSuper={isSuper}
            submitLabel={editing ? "保存" : "新建数据源"}
            submitting={createMutation.isPending || updateMutation.isPending}
            onSubmit={submitConnection}
            onCancel={() => {
              setEditing(null);
              setShowForm(false);
            }}
          />
        </Modal>
      )}

      <div className={styles.list}>
        {isLoading && <div className={styles.empty}>加载中...</div>}
        {!isLoading && connections.length === 0 && (
          <div className={styles.empty}>暂无连接器</div>
        )}
        {!isLoading &&
          connections.map((conn) => {
            const result = testResults[conn.id];
            const canEditConn = canManage && (isSuper || conn.scope === "owner");
            return (
              <div key={conn.id} className={styles.connectionRow}>
                <div className={styles.connectionIcon}>
                  <Icon name={conn.kind === "s3" ? "db" : "folderOpen"} size={15} />
                </div>
                <div className={styles.connectionMain}>
                  <div className={styles.connectionTop}>
                    <span className={styles.connectionName}>{conn.name}</span>
                    <span className={styles.badge}>{conn.kind.toUpperCase()}</span>
                    <span className={styles.badge}>{roleLabel(conn.scope)}</span>
                    <span className={conn.secret_set ? styles.secretOk : styles.secretMissing}>
                      {conn.secret_set ? "已加密" : "未配置密钥"}
                    </span>
                  </div>
                  <div className={styles.connectionMeta}>
                    {connectionSummary(conn) || "未配置目标路径"}
                  </div>
                  {result && (
                    <div className={cx(styles.testResult, result.ok ? styles.testOk : styles.testFail)}>
                      {result.message}
                      {result.sample_count !== null && ` · 样本 ${result.sample_count}`}
                    </div>
                  )}
                </div>
                <div className={styles.rowActions}>
                  <Button
                    size="sm"
                    onClick={() => runTest(conn.id)}
                    disabled={testingId === conn.id}
                  >
                    <Icon name="activity" size={12} />
                    {testingId === conn.id ? "测试中" : "测试"}
                  </Button>
                  {canEditConn && (
                    <Button
                      size="sm"
                      onClick={() => {
                        setEditing(conn);
                        setShowForm(true);
                      }}
                    >
                      <Icon name="edit" size={12} />
                      编辑
                    </Button>
                  )}
                  {canEditConn && (
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={() => removeConnection(conn)}
                      disabled={deleteMutation.isPending}
                    >
                      <Icon name="trash" size={12} />
                      删除
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
      </div>
    </section>
  );
}
