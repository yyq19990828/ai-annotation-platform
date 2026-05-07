import { useState } from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Icon } from "@/components/ui/Icon";
import { useToastStore } from "@/components/ui/Toast";
import {
  useFailedPredictions,
  useRetryFailedPrediction,
  useDismissFailedPrediction,
  useRestoreFailedPrediction,
} from "@/hooks/useFailedPredictions";

const MAX_RETRY = 3;

export function FailedPredictionsTab() {
  const [page, setPage] = useState(1);
  const [includeDismissed, setIncludeDismissed] = useState(false);
  const pageSize = 30;
  const { data, isLoading } = useFailedPredictions(page, pageSize, includeDismissed);
  const retry = useRetryFailedPrediction();
  const dismiss = useDismissFailedPrediction();
  const restore = useRestoreFailedPrediction();
  const pushToast = useToastStore((s) => s.push);

  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const onRetry = (id: string) => {
    retry.mutate(id, {
      onSuccess: () => pushToast({ msg: "已加入重试队列", kind: "success" }),
      onError: (err) => {
        const status = (err as { status?: number; message?: string }).status;
        if (status === 409) {
          pushToast({ msg: `重试次数已到上限（${MAX_RETRY}）或已放弃`, kind: "error" });
        } else {
          pushToast({
            msg: "重试失败",
            sub: (err as Error).message,
            kind: "error",
          });
        }
      },
    });
  };

  const onDismiss = (id: string, displayId: string | null) => {
    if (
      !window.confirm(
        `确定永久放弃失败预测 ${displayId ?? id.slice(0, 8)} 吗？\n` +
          `放弃后该预测不再出现在默认列表，可在「显示已放弃」中恢复。`,
      )
    ) {
      return;
    }
    dismiss.mutate(id, {
      onSuccess: () => pushToast({ msg: "已永久放弃", kind: "success" }),
      onError: (err) =>
        pushToast({ msg: "放弃失败", sub: (err as Error).message, kind: "error" }),
    });
  };

  const onRestore = (id: string) => {
    restore.mutate(id, {
      onSuccess: () => pushToast({ msg: "已恢复", kind: "success" }),
      onError: (err) =>
        pushToast({ msg: "恢复失败", sub: (err as Error).message, kind: "error" }),
    });
  };

  return (
    <>
      <div
        style={{
          marginBottom: 12,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        <p style={{ color: "var(--color-fg-muted)", fontSize: 12.5, margin: 0 }}>
          ML Backend 调用失败的预测记录；管理员可重试 (单条最多 {MAX_RETRY} 次) 或永久放弃。
        </p>
        <label
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            fontSize: 12.5,
            color: "var(--color-fg-muted)",
            cursor: "pointer",
          }}
          data-testid="toggle-include-dismissed"
        >
          <input
            type="checkbox"
            checked={includeDismissed}
            onChange={(e) => {
              setIncludeDismissed(e.target.checked);
              setPage(1);
            }}
          />
          显示已放弃
        </label>
      </div>

      <Card>
        {isLoading ? (
          <div style={{ padding: 32, textAlign: "center", color: "var(--color-fg-subtle)" }}>
            加载中...
          </div>
        ) : !data || data.items.length === 0 ? (
          <div
            style={{
              padding: "60px 16px",
              textAlign: "center",
              color: "var(--color-fg-subtle)",
              fontSize: 13,
            }}
          >
            <Icon name="check" size={26} style={{ opacity: 0.3, marginBottom: 8 }} />
            <div>暂无失败预测</div>
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--color-border)" }}>
                  <th style={th}>项目</th>
                  <th style={th}>任务</th>
                  <th style={th}>Backend</th>
                  <th style={th}>错误类型</th>
                  <th style={th}>消息</th>
                  <th style={th}>重试</th>
                  <th style={th}>时间</th>
                  <th style={th}>操作</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((it) => {
                  const dismissed = it.dismissed_at !== null;
                  const blocked = (it.retry_count ?? 0) >= MAX_RETRY;
                  return (
                    <tr
                      key={it.id}
                      data-testid={`failed-prediction-row-${it.id}`}
                      style={{
                        borderBottom: "1px solid var(--color-border)",
                        background: dismissed ? "var(--color-bg-subtle, #f5f5f5)" : undefined,
                        opacity: dismissed ? 0.7 : 1,
                      }}
                    >
                      <td style={td}>{it.project_name ?? "—"}</td>
                      <td style={{ ...td, fontFamily: "var(--font-mono)" }}>
                        {it.task_display_id ?? "—"}
                      </td>
                      <td style={td}>{it.backend_name ?? "—"}</td>
                      <td style={td}>
                        <Badge variant="outline">{it.error_type}</Badge>
                        {dismissed && (
                          <Badge variant="outline" style={{ marginLeft: 6 }}>
                            已放弃
                          </Badge>
                        )}
                      </td>
                      <td
                        style={{
                          ...td,
                          maxWidth: 280,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          color: "var(--color-fg-muted)",
                        }}
                        title={it.message}
                      >
                        {it.message}
                      </td>
                      <td style={td}>
                        <span className="mono">{it.retry_count}</span> / {MAX_RETRY}
                      </td>
                      <td style={{ ...td, color: "var(--color-fg-subtle)", fontSize: 12 }}>
                        {new Date(it.created_at).toLocaleString()}
                      </td>
                      <td style={{ ...td, whiteSpace: "nowrap" }}>
                        {dismissed ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={restore.isPending}
                            onClick={() => onRestore(it.id)}
                            data-testid={`restore-${it.id}`}
                          >
                            <Icon name="refresh" size={11} />
                            恢复
                          </Button>
                        ) : (
                          <>
                            <Button
                              size="sm"
                              variant={blocked ? "ghost" : "primary"}
                              disabled={blocked || retry.isPending}
                              onClick={() => onRetry(it.id)}
                              data-testid={`retry-${it.id}`}
                            >
                              <Icon name="refresh" size={11} />
                              {blocked ? "已达上限" : "重试"}
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={dismiss.isPending}
                              onClick={() => onDismiss(it.id, it.task_display_id)}
                              data-testid={`dismiss-${it.id}`}
                              style={{ marginLeft: 6, color: "var(--color-danger, #c33)" }}
                            >
                              放弃
                            </Button>
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {totalPages > 1 && (
          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              gap: 6,
              padding: "10px 16px",
              borderTop: "1px solid var(--color-border)",
            }}
          >
            <Button
              size="sm"
              variant="ghost"
              disabled={page === 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              上一页
            </Button>
            <span style={{ fontSize: 12, alignSelf: "center", color: "var(--color-fg-muted)" }}>
              {page} / {totalPages}
            </span>
            <Button
              size="sm"
              variant="ghost"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              下一页
            </Button>
          </div>
        )}
      </Card>
    </>
  );
}

const th: React.CSSProperties = {
  textAlign: "left",
  fontWeight: 500,
  fontSize: 12,
  color: "var(--color-fg-muted)",
  padding: "10px 12px",
};

const td: React.CSSProperties = {
  padding: "10px 12px",
  verticalAlign: "middle",
};
