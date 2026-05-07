import { useState } from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Icon } from "@/components/ui/Icon";
import { useToastStore } from "@/components/ui/Toast";
import {
  useFailedPredictions,
  useRetryFailedPrediction,
} from "@/hooks/useFailedPredictions";

const MAX_RETRY = 3;

export function FailedPredictionsPage() {
  const [page, setPage] = useState(1);
  const pageSize = 30;
  const { data, isLoading } = useFailedPredictions(page, pageSize);
  const retry = useRetryFailedPrediction();
  const pushToast = useToastStore((s) => s.push);

  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const onRetry = (id: string) => {
    retry.mutate(id, {
      onSuccess: () => pushToast({ msg: "已加入重试队列", kind: "success" }),
      onError: (err) => {
        const status = (err as { status?: number; message?: string }).status;
        if (status === 409) {
          pushToast({ msg: `重试次数已到上限（${MAX_RETRY}）`, kind: "error" });
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

  return (
    <div style={{ padding: "20px 28px 40px", maxWidth: 1480, margin: "0 auto" }}>
      <div style={{ marginBottom: 16 }}>
        <h1 style={{ fontSize: 20, fontWeight: 600, margin: "0 0 4px" }}>失败预测</h1>
        <p style={{ color: "var(--color-fg-muted)", fontSize: 13, margin: 0 }}>
          ML Backend 调用失败的预测记录；管理员可重试 (单条最多 {MAX_RETRY} 次)。
        </p>
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
                  <th style={th}></th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((it) => {
                  const blocked = (it.retry_count ?? 0) >= MAX_RETRY;
                  return (
                    <tr key={it.id} style={{ borderBottom: "1px solid var(--color-border)" }}>
                      <td style={td}>{it.project_name ?? "—"}</td>
                      <td style={{ ...td, fontFamily: "var(--font-mono)" }}>
                        {it.task_display_id ?? "—"}
                      </td>
                      <td style={td}>{it.backend_name ?? "—"}</td>
                      <td style={td}>
                        <Badge variant="outline">{it.error_type}</Badge>
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
                      <td style={td}>
                        <Button
                          size="sm"
                          variant={blocked ? "ghost" : "primary"}
                          disabled={blocked || retry.isPending}
                          onClick={() => onRetry(it.id)}
                        >
                          <Icon name="refresh" size={11} />
                          {blocked ? "已达上限" : "重试"}
                        </Button>
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
    </div>
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
