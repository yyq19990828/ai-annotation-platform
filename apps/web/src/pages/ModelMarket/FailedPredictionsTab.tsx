import { useState } from "react";
import { clsx } from "clsx";
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

const CELL_CLASS = "px-3 py-2.5 align-middle";
const HEADER_CELL_CLASS = "px-3 py-2.5 text-left text-xs font-medium text-muted-foreground";

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
      <div className="mb-3 flex flex-wrap items-center justify-between gap-4">
        <p className="m-0 text-sm text-muted-foreground">
          ML Backend 调用失败的预测记录；管理员可重试 (单条最多 {MAX_RETRY} 次) 或永久放弃。
        </p>
        <label
          className="inline-flex cursor-pointer items-center gap-1.5 text-sm text-muted-foreground"
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
          <div className="p-8 text-center text-muted-foreground">
            加载中...
          </div>
        ) : !data || data.items.length === 0 ? (
          <div className="px-4 py-15 text-center text-sm text-muted-foreground">
            <Icon name="check" size={26} className="mb-2 opacity-30" />
            <div>暂无失败预测</div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className={HEADER_CELL_CLASS}>项目</th>
                  <th className={HEADER_CELL_CLASS}>任务</th>
                  <th className={HEADER_CELL_CLASS}>Backend</th>
                  <th className={HEADER_CELL_CLASS}>错误类型</th>
                  <th className={HEADER_CELL_CLASS}>消息</th>
                  <th className={HEADER_CELL_CLASS}>重试</th>
                  <th className={HEADER_CELL_CLASS}>时间</th>
                  <th className={HEADER_CELL_CLASS}>操作</th>
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
                      className={clsx("border-b border-border", dismissed && "bg-muted opacity-70")}
                    >
                      <td className={CELL_CLASS}>{it.project_name ?? "—"}</td>
                      <td className={clsx(CELL_CLASS, "mono")}>
                        {it.task_display_id ?? "—"}
                      </td>
                      <td className={CELL_CLASS}>{it.backend_name ?? "—"}</td>
                      <td className={CELL_CLASS}>
                        <Badge variant="outline">{it.error_type}</Badge>
                        {dismissed && (
                          <Badge variant="outline" className="ml-1.5">
                            已放弃
                          </Badge>
                        )}
                      </td>
                      <td
                        className={clsx(
                          CELL_CLASS,
                          "max-w-[280px] overflow-hidden text-ellipsis whitespace-nowrap text-muted-foreground",
                        )}
                        title={it.message}
                      >
                        {it.message}
                      </td>
                      <td className={CELL_CLASS}>
                        <span className="mono">{it.retry_count}</span> / {MAX_RETRY}
                      </td>
                      <td className={clsx(CELL_CLASS, "text-xs text-muted-foreground")}>
                        {new Date(it.created_at).toLocaleString()}
                      </td>
                      <td className={clsx(CELL_CLASS, "whitespace-nowrap")}>
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
                              className="ml-1.5 text-status-danger"
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
          <div className="flex justify-end gap-1.5 border-t border-border px-4 py-2.5">
            <Button
              size="sm"
              variant="ghost"
              disabled={page === 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              上一页
            </Button>
            <span className="self-center text-xs text-muted-foreground">
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
