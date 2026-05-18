import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, type ReactNode } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Thumbnail } from "@/components/Thumbnail";
import type { TaskResponse } from "@/types";
import type { ClassesConfig } from "@/api/projects";
import type { BatchResponse } from "@/api/batches";
import { ClassPalette } from "./ClassPalette";
import { ResizeHandle } from "./ResizeHandle";
import styles from "./TaskQueuePanel.module.css";

interface TaskQueuePanelProps {
  open: boolean;
  projectName: string;
  projectDisplayId: string;
  classes: string[];
  classesConfig?: ClassesConfig;
  activeClass: string;
  recentClasses?: string[];
  tasks: TaskResponse[];
  taskId: string | undefined;
  taskIdx: number;
  hasNextPage: boolean | undefined;
  isFetchingNextPage: boolean;
  onFetchNextPage: () => void;
  onBack: () => void;
  onToggle: () => void;
  onSelectTask: (id: string) => void;
  batches?: BatchResponse[];
  selectedBatchId: string | null;
  onSelectBatch?: (batchId: string | null) => void;
  totalCount?: number;
  isOwner?: boolean;
  onGoToBatchSettings?: () => void;
  /** 受控宽度（仅 open=true 生效）。 */
  width: number;
  onResize: (w: number) => void;
}

function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

function statusClassName(task: TaskResponse): string {
  if (task.status === "completed") return styles.statusCompleted;
  if (task.status === "review") return styles.statusReview;
  if (task.status === "rejected") return styles.statusRejected;
  if (task.total_annotations > 0) return styles.statusAnnotated;
  if (task.total_predictions > 0) return styles.statusPredicted;
  return styles.statusEmpty;
}

function TaskItem({
  task,
  isActive,
  onSelect,
}: {
  task: TaskResponse;
  isActive: boolean;
  onSelect: () => void;
}) {
  const isLocked = task.status === "review" || task.status === "completed";
  const isRejected = task.status === "rejected";
  const statusLabel =
    task.status === "completed" ? "已完成"
    : task.status === "review" ? "待审核"
    : task.status === "rejected" ? "待重做"
    : task.total_annotations > 0 ? "进行中"
    : task.total_predictions > 0 ? "AI 已预标"
    : "未开始";
  const markerClassName = cn(
    styles.taskMarker,
    isActive ? styles.taskMarkerActive : isRejected && styles.taskMarkerRejected,
  );

  return (
    <div
      onClick={onSelect}
      className={cn(
        styles.taskItem,
        isActive && styles.taskItemActive,
        isRejected && styles.taskItemRejected,
      )}
    >
      {(isActive || isRejected) && <span aria-hidden className={markerClassName} />}
      <Thumbnail src={task.thumbnail_url} blurhash={task.blurhash} width={40} height={40} />
      <div className={styles.taskBody}>
        <div className={styles.taskMainRow}>
          <span
            className={cn("mono", styles.taskDisplayId, isActive && styles.taskDisplayIdActive)}
          >{task.display_id}</span>
          <div className={styles.taskMetaActions}>
            {isLocked && (
              <span
                title={task.status === "review" ? "已提交质检 · 已锁定" : "已通过审核 · 已锁定"}
                className={styles.lockIcon}
              >
                <Icon name="lock" size={11} />
              </span>
            )}
            {task.total_annotations > 0 && (
              <span className={styles.annotationCountBadge}>{task.total_annotations}</span>
            )}
          </div>
        </div>
        <div className={styles.fileName}>
          {task.file_name}
        </div>
        <div
          className={cn(styles.statusMeta, statusClassName(task))}
        >
          <span className={styles.statusDot} />
          {statusLabel}
        </div>
      </div>
    </div>
  );
}

function VirtualInner({
  height,
  children,
}: {
  height: number;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    ref.current?.style.setProperty("height", `${height}px`);
  }, [height]);

  return <div ref={ref} className={styles.virtualInner}>{children}</div>;
}

function VirtualRow({
  start,
  dataIndex,
  measureElement,
  children,
}: {
  start: number;
  dataIndex?: number;
  measureElement?: (node: HTMLDivElement | null) => void;
  children: ReactNode;
}) {
  const ref = useCallback((node: HTMLDivElement | null) => {
    if (node) {
      node.style.setProperty("transform", `translateY(${start}px)`);
    }
    measureElement?.(node);
  }, [measureElement, start]);

  return <div ref={ref} data-index={dataIndex} className={styles.virtualRow}>{children}</div>;
}

export function TaskQueuePanel({
  open, projectName, projectDisplayId, classes, classesConfig, activeClass, recentClasses,
  tasks, taskId, taskIdx,
  hasNextPage, isFetchingNextPage, onFetchNextPage,
  onBack, onToggle, onSelectTask,
  batches, selectedBatchId, onSelectBatch,
  totalCount, isOwner, onGoToBatchSettings,
  width, onResize,
}: TaskQueuePanelProps) {
  const parentRef = useRef<HTMLDivElement>(null);

  // rejected 任务置顶，其余保持原序
  const sortedTasks = useMemo(() => {
    const rejected = tasks.filter((t) => t.status === "rejected");
    const rest = tasks.filter((t) => t.status !== "rejected");
    return [...rejected, ...rest];
  }, [tasks]);

  const rejectedCount = useMemo(() => tasks.filter((t) => t.status === "rejected").length, [tasks]);
  const activeTaskIndex = useMemo(
    () => sortedTasks.findIndex((t) => t.id === taskId),
    [sortedTasks, taskId],
  );

  const virtualizer = useVirtualizer({
    count: sortedTasks.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 88,
    overscan: 5,
  });

  // 滚到接近末尾时触发加载下一页
  useEffect(() => {
    const virtualItems = virtualizer.getVirtualItems();
    if (!virtualItems.length) return;
    const last = virtualItems[virtualItems.length - 1];
    if (last.index >= sortedTasks.length - 10 && hasNextPage && !isFetchingNextPage) {
      onFetchNextPage();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [virtualizer.getVirtualItems(), hasNextPage, isFetchingNextPage]);

  useEffect(() => {
    if (!open || activeTaskIndex < 0) return;
    const frame = window.requestAnimationFrame(() => {
      virtualizer.scrollToIndex(activeTaskIndex, { align: "center" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [open, activeTaskIndex, virtualizer]);

  if (!open) {
    return (
      <div className={styles.collapsed}>
        <button onClick={onToggle} title="展开任务列表" className={styles.collapsedToggle}>
          <Icon name="panelLeft" size={16} />
          <span className={styles.collapsedLabel}>任务列表</span>
        </button>
      </div>
    );
  }

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <div className={styles.headerActions}>
          <Button variant="ghost" size="sm" onClick={onBack} className={styles.compactButton}>
            <Icon name="chevLeft" size={11} />返回
          </Button>
          <Button variant="ghost" size="sm" onClick={onToggle} title="收起任务列表" className={styles.compactButton}>
            <Icon name="panelLeft" size={14} />
          </Button>
        </div>
        <div className={styles.projectName}>{projectName}</div>
        <div className={styles.projectMeta}>
          <span className="mono">{projectDisplayId}</span> · {classes.length} 个类别
        </div>
      </div>

      {batches && batches.length > 0 && onSelectBatch && (
        <div className={styles.batchFilter}>
          <select
            value={selectedBatchId ?? ""}
            onChange={(e) => onSelectBatch(e.target.value || null)}
            className={styles.batchSelect}
          >
            <option value="">全部批次（{batches.length}）</option>
            {batches.map((b) => {
              const statusTag =
                b.status === "annotating" ? "标注中"
                : b.status === "active" ? "未开始"
                : b.status === "rejected" ? "已驳回"
                : b.status === "draft" ? "草稿"
                : b.status;
              return (
                <option key={b.id} value={b.id}>
                  {b.name} · {statusTag} ({b.completed_tasks}/{b.total_tasks})
                </option>
              );
            })}
          </select>
        </div>
      )}

      {/* v0.6.8 B-15：owner 视角且无任何批次时给出明确入口，避免误以为「100 条就是全部」 */}
      {isOwner && (!batches || batches.length === 0) && onGoToBatchSettings && (
        <div className={cn(styles.batchHint, styles.ownerBatchHint)}>
          <span>未分批次 · 任务统一在「未归类」</span>
          <Button variant="ghost" size="sm" onClick={onGoToBatchSettings} className={styles.batchSettingsButton}>
            前往分批
          </Button>
        </div>
      )}

      {/* v0.7.1 B-15：非 owner 视角且未分到批次 → 显式提示，避免误以为「列表无尽，但只看见 100」 */}
      {!isOwner && (!batches || batches.length === 0) && (
        <div className={styles.batchHint}>
          暂未被分派到批次 · 联系项目管理员分配
        </div>
      )}

      <div className={styles.queueHeader}>
        <div className={styles.queueTitle}>
          任务队列
          {selectedBatchId && batches && (
            <span className={styles.queueSubtitle}>
              · 当前批次
            </span>
          )}
          {rejectedCount > 0 && (
            <span
              title={`${rejectedCount} 个任务被退回，需重做`}
              className={styles.rejectedBadge}
            >
              <Icon name="warning" size={10} />
              {rejectedCount} 待重做
            </span>
          )}
        </div>
        <span
          className={cn("mono", styles.queueCount)}
          title={
            hasNextPage
              ? `已加载 ${tasks.length} / 共 ${totalCount ?? tasks.length}（滚动加载更多）`
              : `共 ${totalCount ?? tasks.length}`
          }
        >
          {taskIdx + 1} / {tasks.length}
          {totalCount != null && totalCount > tasks.length && (
            <span className={styles.totalCount}> · 共 {totalCount}</span>
          )}
        </span>
      </div>

      <div ref={parentRef} className={styles.scrollArea}>
        <VirtualInner height={virtualizer.getTotalSize()}>
          {virtualizer.getVirtualItems().map((vItem) => {
            const t = sortedTasks[vItem.index];
            if (!t) return null;
            return (
              <VirtualRow
                key={vItem.key}
                start={vItem.start}
                dataIndex={vItem.index}
                measureElement={virtualizer.measureElement}
              >
                <TaskItem
                  task={t}
                  isActive={t.id === taskId}
                  onSelect={() => onSelectTask(t.id)}
                />
              </VirtualRow>
            );
          })}
          {isFetchingNextPage && (
            <VirtualRow start={virtualizer.getTotalSize()}>
              <div className={styles.loadingMore}>加载更多...</div>
            </VirtualRow>
          )}
        </VirtualInner>
      </div>

      <div className={styles.palettePanel}>
        <div className={styles.paletteTitle}>
          类别图例 <span className={styles.paletteHint}>(数字/字母键直接落框时使用)</span>
        </div>
        <ClassPalette
          classes={classes}
          classesConfig={classesConfig}
          recent={recentClasses}
          activeClass={activeClass}
          enableSearch={classes.length > 9}
          readOnly
        />
      </div>

      <ResizeHandle side="right" width={width} onResize={onResize} min={200} max={560} />
    </div>
  );
}
