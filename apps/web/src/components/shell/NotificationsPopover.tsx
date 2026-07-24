import { useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { clsx } from "clsx";
import { Icon } from "@/components/ui/Icon";
import type { IconName } from "@/components/ui/Icon";
import {
  useNotifications,
  useClearReadNotifications,
  useDeleteNotification,
  useMarkAllRead,
  useMarkRead,
  useUnreadCount,
} from "@/hooks/useNotifications";
import type { NotificationItem } from "@/api/notifications";
import { useAuthStore } from "@/stores/authStore";
import { useBugDrawerStore } from "@/stores/bugDrawerStore";
import { DropdownMenu } from "@/components/ui/DropdownMenu";
import { buildWorkbenchUrl, currentWorkbenchReturnTo } from "@/utils/workbenchNavigation";
import {
  FILTERS,
  GROUP_LABELS,
  GROUP_ORDER,
  filterNotificationItems,
  groupNotificationItems,
  type NotificationFilter,
} from "./NotificationsPopover.helpers";

type NotificationTone = "default" | "danger" | "success" | "ai" | "accent";

const TONE_CLASS: Record<NotificationTone, string> = {
  default: "bg-muted text-muted-foreground",
  danger: "bg-status-danger-soft text-status-danger",
  success: "bg-status-positive-soft text-status-positive",
  ai: "bg-status-info-soft text-status-info",
  accent: "bg-brand/10 text-brand",
};

function relativeTime(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return "刚刚";
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
  return `${Math.floor(diff / 86400)} 天前`;
}

const TYPE_LABEL: Record<string, string> = {
  "bug_report.commented": "评论了反馈",
  "bug_report.status_changed": "更新了反馈状态",
  "bug_report.reopened": "重新打开了反馈",
  "batch.rejected": "驳回了批次",
  "batch.review_reopened": "重新打开了批次审核",
  "batch.admin_locked": "锁定了批次",
  "batch.admin_unlocked": "解锁了批次",
  "batch.unarchived": "取消归档了批次",
  "task.approved": "通过了任务",
  "task.rejected": "退回了任务",
  "task.reopened": "重新打开了任务",
  "feedback.reconcile_drift": "反馈双写对账发现不一致",
  "failed_prediction.retry.started": "开始重试失败预测",
  "failed_prediction.retry.succeeded": "失败预测重试成功",
  "failed_prediction.retry.failed": "失败预测重试失败",
  "export.ready": "导出完成",
  "export.failed": "导出失败",
  "job.completed": "后台任务完成",
  "job.failed": "后台任务失败",
  "job.cancelled": "后台任务已取消",
  "user.deactivation_requested": "申请注销账号",
  "user.deactivation_completed": "账号注销完成",
};

const JOB_KIND_LABEL: Record<string, string> = {
  batch_predict: "批量预标",
  video_tracker: "视频追踪",
  video_correction: "视频 Mask 纠错",
  predictions_import: "预测导入",
  prediction_retry: "失败预测重试",
  dataset_import: "数据集导入",
  create_tasks: "建任务",
  audit_archive: "审计归档",
  mask_qc: "Mask 质检",
  mask_repair: "Mask 批量修复",
  mask_repair_rollback: "Mask 修复回滚",
  mask_format_import: "Mask 格式导入",
};

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function jobVerb(item: NotificationItem): string | null {
  if (!item.type.startsWith("job.")) return null;
  const payload = item.payload || {};
  const kind = stringValue((payload as { kind?: unknown }).kind);
  const label = JOB_KIND_LABEL[kind] ?? "后台任务";
  if (item.type === "job.completed") return `${label}完成`;
  if (item.type === "job.failed") return `${label}失败`;
  if (item.type === "job.cancelled") return `${label}已取消`;
  return null;
}

function jobTitle(item: NotificationItem): string {
  const payload = item.payload || {};
  const kind = stringValue((payload as { kind?: unknown }).kind);
  if (kind === "batch_predict") {
    return stringValue((payload as { ml_backend_name?: unknown }).ml_backend_name);
  }
  if (kind === "video_tracker") {
    return stringValue((payload as { model_key?: unknown }).model_key);
  }
  if (kind === "predictions_import") {
    return stringValue((payload as { format?: unknown }).format).toUpperCase();
  }
  if (kind === "prediction_retry") {
    return stringValue((payload as { ml_backend_name?: unknown }).ml_backend_name);
  }
  if (kind === "dataset_import") {
    return stringValue((payload as { dataset_name?: unknown }).dataset_name);
  }
  if (kind === "mask_format_import") {
    return stringValue((payload as { format?: unknown }).format).toUpperCase();
  }
  return "";
}

export function jobSnippet(item: NotificationItem): string {
  const payload = item.payload || {};
  const error = stringValue((payload as { error_message?: unknown }).error_message);
  if (error) return error;

  // skip_predicted 下候选 task 全部已预标被跳过 → 给明确文案, 免得「成功 0/失败 0」被误读为没生效。
  const reason = stringValue((payload as { reason?: unknown }).reason);
  if (reason === "all_predicted") {
    const skippedCount = (payload as { skipped_count?: unknown }).skipped_count;
    return `已全部预标，跳过 ${skippedCount ?? 0} 个`;
  }

  const success = (payload as { success_count?: unknown }).success_count;
  const failed = (payload as { failed_count?: unknown }).failed_count;
  if (success !== undefined || failed !== undefined) {
    return `成功 ${success ?? 0} / 失败 ${failed ?? 0}`;
  }

  const imported = (payload as { imported?: unknown }).imported;
  const skipped = (payload as { skipped?: unknown }).skipped;
  const errorCount = (payload as { error_count?: unknown }).error_count;
  if (imported !== undefined || skipped !== undefined || errorCount !== undefined) {
    return `导入 ${imported ?? 0} / 跳过 ${skipped ?? 0} / 错误 ${errorCount ?? 0}`;
  }

  return "";
}

function notificationVisual(item: NotificationItem): {
  icon: IconName;
  tone: NotificationTone;
} {
  if (
    item.type === "task.rejected" ||
    item.type.endsWith(".failed") ||
    item.type === "export.failed"
  ) {
    return { icon: "warning", tone: "danger" };
  }
  if (
    item.type === "task.approved" ||
    item.type.endsWith(".succeeded") ||
    item.type.endsWith(".completed") ||
    item.type === "export.ready"
  ) {
    return { icon: "checkCircle", tone: "success" };
  }
  if (item.type.startsWith("job.") || item.type.startsWith("failed_prediction.")) {
    return { icon: "cpu", tone: "ai" };
  }
  if (item.type.startsWith("bug_report.")) {
    return { icon: "messageCircle", tone: "accent" };
  }
  if (item.type.startsWith("batch.")) {
    return { icon: "layers", tone: "default" };
  }
  return { icon: "bell", tone: "default" };
}

interface NotifRowProps {
  item: NotificationItem;
  onClick: () => void;
  onDelete: () => void;
  deletePending: boolean;
}

function NotifRow({ item, onClick, onDelete, deletePending }: NotifRowProps) {
  const isUnread = item.read_at === null;
  const visual = notificationVisual(item);
  const payload = item.payload || {};
  const actorName = (payload as { actor_name?: string }).actor_name || "系统";
  const fromStatus = (payload as { from_status?: string }).from_status;
  const toStatus = (payload as { to_status?: string }).to_status;
  const reopen = Boolean((payload as { reopen?: boolean }).reopen);

  // v0.7.0：batch.rejected 复用同一行渲染，但 payload 字段不同
  const isBatchRejected = item.type === "batch.rejected";
  // v0.10.27：导出完成/失败复用同一行；payload 含 project_display_id / format / download_url / error
  const isExport = item.target_type === "export";
  const isJob = item.target_type === "async_job";
  const displayId = isBatchRejected
    ? (payload as { batch_display_id?: string }).batch_display_id || ""
    : isExport
      ? (payload as { project_display_id?: string }).project_display_id || ""
      : isJob
        ? stringValue(
            (payload as { batch_display_id?: unknown }).batch_display_id ||
              (payload as { task_display_id?: unknown }).task_display_id ||
              (payload as { project_display_id?: unknown }).project_display_id,
          )
        : (payload as { display_id?: string }).display_id || "";
  const title = isBatchRejected
    ? (payload as { batch_name?: string }).batch_name || ""
    : isExport
      ? ((payload as { format?: string }).format || "").toUpperCase()
      : isJob
        ? jobTitle(item)
        : (payload as { title?: string }).title || "";
  const snippet = isBatchRejected
    ? (payload as { feedback?: string }).feedback || ""
    : isExport
      ? (payload as { error?: string }).error || ""
      : isJob
        ? jobSnippet(item)
        : (payload as { snippet?: string }).snippet || "";

  const verb =
    jobVerb(item) ??
    (reopen
      ? "重新打开了反馈"
      : item.type === "bug_report.status_changed"
        ? `状态 ${fromStatus ?? ""} → ${toStatus ?? ""}`
        : TYPE_LABEL[item.type] || item.type);

  return (
    <div
      onClick={onClick}
      className={clsx(
        "group flex cursor-pointer items-start gap-2.5 border-b border-border px-3.5 py-2.5",
        isUnread && "bg-brand/10",
      )}
    >
      <div
        className={clsx(
          "relative mt-px inline-flex h-[26px] w-[26px] flex-shrink-0 items-center justify-center rounded-md border",
          TONE_CLASS[visual.tone],
          isUnread ? "border-brand" : "border-border",
        )}
      >
        <Icon name={visual.icon} size={14} />
        {isUnread && (
          <span className="absolute -right-0.5 -top-0.5 h-[7px] w-[7px] rounded-full border border-popover bg-brand" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm">
          <span className="font-medium">{actorName}</span>{" "}
          <span className="text-muted-foreground">{verb}</span>
          {displayId && (
            <>
              {" "}
              <span className="text-muted-foreground">· {displayId}</span>
            </>
          )}
        </div>
        {title && (
          <div className="mt-0.5 overflow-hidden text-ellipsis whitespace-nowrap text-xs text-foreground">
            {title}
          </div>
        )}
        {snippet && (
          <div className="mt-0.5 overflow-hidden text-ellipsis whitespace-nowrap text-xs text-muted-foreground">
            "{snippet}"
          </div>
        )}
        <div className="mt-0.5 text-xs text-muted-foreground">{relativeTime(item.created_at)}</div>
      </div>
      <button
        type="button"
        className="-mt-0.5 inline-flex h-[22px] w-[22px] flex-shrink-0 cursor-pointer appearance-none items-center justify-center rounded-sm border border-transparent bg-transparent text-muted-foreground opacity-0 hover:bg-status-danger-soft hover:text-rose-500 focus-visible:opacity-100 group-hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-40"
        title="删除通知"
        aria-label="删除通知"
        disabled={deletePending}
        onClick={(event) => {
          event.stopPropagation();
          onDelete();
        }}
      >
        <Icon name="x" size={12} />
      </button>
    </div>
  );
}

/**
 * v0.7.6 · 自包含 trigger + popover；v0.9.3 改用 DropdownMenu content 模式以统一外观与键盘行为。
 * 触发按钮保留特殊视觉（铃铛 + 未读红点）；面板内容沿用原 header + 列表。
 */
export function NotificationsPopover() {
  const navigate = useNavigate();
  const location = useLocation();
  const role = useAuthStore((s) => s.user?.role);
  const openBugDrawer = useBugDrawerStore((s) => s.openDrawer);
  const { data: unreadData } = useUnreadCount();
  const unread = unreadData?.unread ?? 0;

  return (
    <DropdownMenu
      align="end"
      minWidth={0}
      zIndex={200}
      panelStyle={{ width: "min(520px, calc(100vw - 24px))" }}
      disablePanelPadding
      trigger={({ open, toggle, ref }) => (
        <button
          ref={ref}
          type="button"
          title="通知"
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={toggle}
          className={clsx(
            "relative inline-flex h-[30px] w-[30px] cursor-pointer appearance-none items-center justify-center rounded-md border border-transparent bg-transparent text-muted-foreground",
            open && "bg-muted",
          )}
        >
          <Icon name="bell" size={15} />
          {unread > 0 && (
            <span className="absolute right-[5px] top-1.5 h-[7px] w-[7px] rounded-full border-[1.5px] border-card bg-rose-500" />
          )}
        </button>
      )}
      content={({ close }) => (
        <NotificationsPanel
          unread={unread}
          onItemClick={(item) => {
            if (item.target_type === "bug_report") {
              if (role === "super_admin" || role === "project_admin") {
                navigate("/bugs");
              } else {
                openBugDrawer(item.target_id);
              }
            } else if (item.target_type === "batch") {
              const payload = (item.payload || {}) as { project_id?: string };
              const projectId = payload.project_id;
              if (projectId) {
                navigate(
                  buildWorkbenchUrl(projectId, {
                    batchId: item.target_id,
                    returnTo: currentWorkbenchReturnTo(location),
                  }),
                );
              }
            } else if (item.target_type === "export") {
              // v0.10.27：点导出完成通知 → 用预签名 URL 触发下载（7 天内有效）。
              const payload = (item.payload || {}) as { download_url?: string };
              if (payload.download_url) {
                window.open(payload.download_url, "_blank", "noopener");
              }
            } else if (item.target_type === "async_job") {
              const payload = (item.payload || {}) as {
                kind?: string;
                dataset_id?: string;
              };
              if (payload.kind === "dataset_import" && payload.dataset_id) {
                // 数据集导入完成 → 跳数据集列表并自动展开该数据集
                navigate(`/datasets?dataset=${payload.dataset_id}`);
              } else {
                navigate(
                  payload.kind === "video_tracker" ? "/ai-pre/jobs?tab=video" : "/ai-pre/jobs",
                );
              }
            }
            close();
          }}
        />
      )}
    />
  );
}

function NotificationsPanel({
  unread,
  onItemClick,
}: {
  unread: number;
  onItemClick: (item: NotificationItem) => void;
}) {
  const notificationsQ = useNotifications(true); // panel 已渲染 = popover 已打开
  const clearRead = useClearReadNotifications();
  const deleteNotification = useDeleteNotification();
  const markAllRead = useMarkAllRead();
  const markRead = useMarkRead();
  const [activeFilter, setActiveFilter] = useState<NotificationFilter>("all");
  const items = useMemo(
    () => notificationsQ.data?.pages.flatMap((page) => page.items) ?? [],
    [notificationsQ.data],
  );
  const filteredItems = useMemo(
    () => filterNotificationItems(items, activeFilter),
    [items, activeFilter],
  );
  const groupedItems = useMemo(() => groupNotificationItems(filteredItems), [filteredItems]);
  const hasRead = items.some((item) => item.read_at !== null);
  const isEmpty = items.length === 0;
  const isFilteredEmpty = !isEmpty && filteredItems.length === 0;

  const handleRowClick = (item: NotificationItem) => {
    if (item.read_at === null) markRead.mutate(item.id);
    onItemClick(item);
  };

  return (
    <div className="w-full overflow-hidden rounded-md">
      <div className="flex items-center justify-between border-b border-border px-3.5 pb-2.5 pt-3">
        <span className="text-sm font-semibold">通知{unread > 0 ? ` · ${unread} 未读` : ""}</span>
        <div className="flex items-center gap-2.5">
          {hasRead && (
            <button
              type="button"
              onClick={() => clearRead.mutate()}
              disabled={clearRead.isPending}
              className="cursor-pointer appearance-none border-0 bg-transparent p-0 text-xs text-brand disabled:cursor-not-allowed"
            >
              清空已读
            </button>
          )}
          {unread > 0 && (
            <button
              type="button"
              onClick={() => markAllRead.mutate()}
              disabled={markAllRead.isPending}
              className="cursor-pointer appearance-none border-0 bg-transparent p-0 text-xs text-brand disabled:cursor-not-allowed"
            >
              全部已读
            </button>
          )}
        </div>
      </div>

      <div
        className="grid grid-cols-[repeat(auto-fit,minmax(62px,1fr))] gap-1.5 border-b border-border px-3.5 py-2.5"
        role="tablist"
        aria-label="通知类型筛选"
      >
        {FILTERS.map((filter) => (
          <button
            key={filter.key}
            type="button"
            role="tab"
            aria-selected={activeFilter === filter.key}
            className={clsx(
              "min-h-[30px] cursor-pointer appearance-none rounded-sm border px-2 py-1.5 text-center text-xs leading-[1.2]",
              activeFilter === filter.key
                ? "border-brand bg-brand/10 text-brand"
                : "border-transparent bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
            onClick={() => setActiveFilter(filter.key)}
          >
            {filter.label}
          </button>
        ))}
      </div>

      <div className="max-h-[min(560px,62vh)] min-h-[260px] overflow-y-auto">
        {isEmpty || isFilteredEmpty ? (
          <div className="flex min-h-[260px] flex-col items-center justify-center px-3.5 py-6 text-center text-sm text-muted-foreground">
            <Icon name="bell" size={22} className="mb-1.5 opacity-25" />
            <div>{isFilteredEmpty ? "暂无此类型通知" : "暂无通知"}</div>
          </div>
        ) : (
          GROUP_ORDER.map((groupKey) => {
            const groupItems = groupedItems[groupKey];
            if (groupItems.length === 0) return null;
            return (
              <section key={groupKey} className="border-b border-border last:border-b-0">
                <div className="sticky top-0 z-local-1 border-b border-border bg-popover px-3.5 py-1.5 text-2xs font-semibold text-muted-foreground">
                  {GROUP_LABELS[groupKey]}
                </div>
                {groupItems.map((item) => (
                  <NotifRow
                    key={item.id}
                    item={item}
                    onClick={() => handleRowClick(item)}
                    onDelete={() => deleteNotification.mutate(item.id)}
                    deletePending={deleteNotification.isPending}
                  />
                ))}
              </section>
            );
          })
        )}
      </div>
      {notificationsQ.hasNextPage && (
        <div className="border-t border-border px-3.5 py-2.5">
          <button
            type="button"
            className="w-full cursor-pointer appearance-none rounded-sm border border-border bg-muted px-2.5 py-2 text-xs text-brand disabled:cursor-not-allowed disabled:text-muted-foreground"
            disabled={notificationsQ.isFetchingNextPage}
            onClick={() => notificationsQ.fetchNextPage()}
          >
            {notificationsQ.isFetchingNextPage ? "加载中…" : "加载更多"}
          </button>
        </div>
      )}
    </div>
  );
}
