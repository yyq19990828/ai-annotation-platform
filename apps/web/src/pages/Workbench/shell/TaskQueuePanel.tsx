import { useEffect, useMemo, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Thumbnail } from "@/components/Thumbnail";
import type { TaskResponse } from "@/types";
import type { ClassesConfig } from "@/api/projects";
import type { BatchResponse } from "@/api/batches";
import { ClassPalette } from "./ClassPalette";
import { ResizeHandle } from "./ResizeHandle";

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

const stripStyle: React.CSSProperties = {
  display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
  height: "100%", gap: 8, cursor: "pointer", userSelect: "none",
  background: "var(--color-bg-elev)", border: "none", width: "100%", padding: 0,
  color: "var(--color-fg-muted)",
};

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
  const statusColor =
    task.status === "completed" ? "var(--color-success)"
    : task.status === "review" ? "var(--color-warning)"
    : task.status === "rejected" ? "var(--color-danger)"
    : task.total_annotations > 0 ? "var(--color-accent)"
    : task.total_predictions > 0 ? "var(--color-ai)"
    : "var(--color-fg-subtle)";

  return (
    <div
      onClick={onSelect}
      style={{
        position: "relative",
        display: "flex", alignItems: "center", gap: 10,
        padding: "9px 10px 9px 12px", margin: "3px 0",
        borderRadius: "var(--radius-md)",
        background: isActive ? "var(--color-accent-soft)" : isRejected ? "color-mix(in oklab, var(--color-danger) 6%, transparent)" : "transparent",
        border: "1px solid " + (isActive ? "color-mix(in oklab, var(--color-accent) 30%, transparent)" : isRejected ? "color-mix(in oklab, var(--color-danger) 25%, transparent)" : "transparent"),
        cursor: "pointer",
        transition: "background 0.12s, border-color 0.12s",
      }}
      onMouseEnter={(e) => {
        if (!isActive) e.currentTarget.style.background = "var(--color-bg-hover)";
      }}
      onMouseLeave={(e) => {
        if (!isActive) e.currentTarget.style.background = "transparent";
      }}
    >
      {isActive && (
        <span
          aria-hidden
          style={{
            position: "absolute", left: 2, top: 8, bottom: 8, width: 3,
            background: "var(--color-accent)", borderRadius: 2,
          }}
        />
      )}
      {!isActive && isRejected && (
        <span
          aria-hidden
          style={{
            position: "absolute", left: 2, top: 8, bottom: 8, width: 3,
            background: "var(--color-danger)", borderRadius: 2,
          }}
        />
      )}
      <Thumbnail src={task.thumbnail_url} blurhash={task.blurhash} width={40} height={40} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 4 }}>
          <span
            className="mono"
            style={{
              fontSize: 12, fontWeight: 600,
              color: isActive ? "var(--color-accent-fg)" : "var(--color-fg)",
            }}
          >{task.display_id}</span>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            {isLocked && (
              <span
                title={task.status === "review" ? "已提交质检 · 已锁定" : "已通过审核 · 已锁定"}
                style={{ display: "inline-flex", color: "var(--color-fg-subtle)" }}
              >
                <Icon name="lock" size={11} />
              </span>
            )}
            {task.total_annotations > 0 && (
              <Badge variant="accent" style={{ fontSize: 10, padding: "1px 6px" }}>{task.total_annotations}</Badge>
            )}
          </div>
        </div>
        <div style={{ fontSize: 11, color: "var(--color-fg-muted)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {task.file_name}
        </div>
        <div
          style={{
            fontSize: 10.5, marginTop: 3,
            display: "inline-flex", alignItems: "center", gap: 4,
            color: statusColor, fontWeight: 500,
          }}
        >
          <span style={{ width: 5, height: 5, borderRadius: "50%", background: statusColor }} />
          {statusLabel}
        </div>
      </div>
    </div>
  );
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
      <div style={{ borderRight: "1px solid var(--color-border)", overflow: "hidden" }}>
        <button onClick={onToggle} title="展开任务列表" style={stripStyle}>
          <Icon name="panelLeft" size={16} />
          <span style={{ fontSize: 10, writingMode: "vertical-rl", letterSpacing: 1, opacity: 0.6 }}>任务列表</span>
        </button>
      </div>
    );
  }

  return (
    <div
      style={{
        position: "relative",
        background: "var(--color-bg-elev)", borderRight: "1px solid var(--color-border)",
        display: "flex", flexDirection: "column", overflow: "hidden",
      }}
    >
      <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--color-border)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
          <Button variant="ghost" size="sm" onClick={onBack} style={{ padding: "2px 6px" }}>
            <Icon name="chevLeft" size={11} />返回
          </Button>
          <Button variant="ghost" size="sm" onClick={onToggle} title="收起任务列表" style={{ padding: "2px 6px" }}>
            <Icon name="panelLeft" size={14} />
          </Button>
        </div>
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>{projectName}</div>
        <div style={{ fontSize: 11, color: "var(--color-fg-muted)" }}>
          <span className="mono">{projectDisplayId}</span> · {classes.length} 个类别
        </div>
      </div>

      {batches && batches.length > 0 && onSelectBatch && (
        <div style={{ padding: "6px 14px 0" }}>
          <select
            value={selectedBatchId ?? ""}
            onChange={(e) => onSelectBatch(e.target.value || null)}
            style={{
              width: "100%",
              padding: "4px 8px",
              fontSize: 12,
              border: "1px solid var(--color-border)",
              borderRadius: "var(--radius-sm)",
              background: "var(--color-bg)",
              color: "var(--color-fg)",
              fontFamily: "inherit",
            }}
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
        <div
          style={{
            margin: "6px 14px 0",
            padding: "8px 10px",
            border: "1px dashed var(--color-border)",
            borderRadius: "var(--radius-sm)",
            background: "var(--color-bg)",
            fontSize: 11,
            color: "var(--color-fg-muted)",
            display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
          }}
        >
          <span>未分批次 · 任务统一在「未归类」</span>
          <Button variant="ghost" size="sm" onClick={onGoToBatchSettings} style={{ padding: "2px 6px", fontSize: 11 }}>
            前往分批
          </Button>
        </div>
      )}

      {/* v0.7.1 B-15：非 owner 视角且未分到批次 → 显式提示，避免误以为「列表无尽，但只看见 100」 */}
      {!isOwner && (!batches || batches.length === 0) && (
        <div
          style={{
            margin: "6px 14px 0",
            padding: "8px 10px",
            border: "1px dashed var(--color-border)",
            borderRadius: "var(--radius-sm)",
            background: "var(--color-bg)",
            fontSize: 11,
            color: "var(--color-fg-muted)",
          }}
        >
          暂未被分派到批次 · 联系项目管理员分配
        </div>
      )}

      <div style={{ padding: "10px 14px 6px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ fontSize: 12, fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
          任务队列
          {selectedBatchId && batches && (
            <span style={{ fontSize: 11, fontWeight: 400, color: "var(--color-fg-subtle)" }}>
              · 当前批次
            </span>
          )}
          {rejectedCount > 0 && (
            <span
              title={`${rejectedCount} 个任务被退回，需重做`}
              style={{
                display: "inline-flex", alignItems: "center", gap: 3,
                fontSize: 10, fontWeight: 600, color: "var(--color-danger)",
                background: "color-mix(in oklab, var(--color-danger) 12%, transparent)",
                border: "1px solid color-mix(in oklab, var(--color-danger) 30%, transparent)",
                borderRadius: "var(--radius-full)",
                padding: "1px 6px",
              }}
            >
              <Icon name="warning" size={10} />
              {rejectedCount} 待重做
            </span>
          )}
        </div>
        <span
          className="mono"
          style={{ fontSize: 11, color: "var(--color-fg-subtle)" }}
          title={
            hasNextPage
              ? `已加载 ${tasks.length} / 共 ${totalCount ?? tasks.length}（滚动加载更多）`
              : `共 ${totalCount ?? tasks.length}`
          }
        >
          {taskIdx + 1} / {tasks.length}
          {totalCount != null && totalCount > tasks.length && (
            <span style={{ opacity: 0.7 }}> · 共 {totalCount}</span>
          )}
        </span>
      </div>

      <div ref={parentRef} style={{ flex: 1, overflowY: "auto", padding: "0 8px 10px" }}>
        <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
          {virtualizer.getVirtualItems().map((vItem) => {
            const t = sortedTasks[vItem.index];
            if (!t) return null;
            return (
              <div
                key={vItem.key}
                data-index={vItem.index}
                ref={virtualizer.measureElement}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  transform: `translateY(${vItem.start}px)`,
                }}
              >
                <TaskItem
                  task={t}
                  isActive={t.id === taskId}
                  onSelect={() => onSelectTask(t.id)}
                />
              </div>
            );
          })}
          {isFetchingNextPage && (
            <div
              style={{
                position: "absolute",
                top: virtualizer.getTotalSize(),
                left: 0,
                width: "100%",
                padding: "8px 10px",
                fontSize: 11,
                color: "var(--color-fg-subtle)",
                textAlign: "center",
              }}
            >
              加载更多...
            </div>
          )}
        </div>
      </div>

      <div style={{ borderTop: "1px solid var(--color-border)", padding: "10px 14px", maxHeight: 320, overflowY: "auto" }}>
        <div style={{ fontSize: 11, color: "var(--color-fg-muted)", marginBottom: 6 }}>
          类别图例 <span style={{ color: "var(--color-fg-subtle)" }}>(数字/字母键直接落框时使用)</span>
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
