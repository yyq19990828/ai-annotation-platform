import { useEffect, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Thumbnail } from "@/components/Thumbnail";
import type { TaskResponse } from "@/types";
import type { ClassesConfig } from "@/api/projects";
import type { BatchResponse } from "@/api/batches";
import { ClassPalette } from "./ClassPalette";

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
  const statusLabel =
    task.status === "completed" ? "已完成"
    : task.status === "review" ? "待审核"
    : task.total_annotations > 0 ? "进行中"
    : task.total_predictions > 0 ? "AI 已预标"
    : "未开始";

  return (
    <div
      onClick={onSelect}
      style={{
        display: "flex", alignItems: "center", gap: 8,
        padding: "8px 10px", margin: "2px 0",
        borderRadius: "var(--radius-md)",
        background: isActive ? "var(--color-accent-soft)" : "transparent",
        border: "1px solid " + (isActive ? "oklch(0.85 0.06 252)" : "transparent"),
        cursor: "pointer",
      }}
    >
      <Thumbnail src={task.thumbnail_url} blurhash={task.blurhash} width={40} height={40} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 4 }}>
          <span className="mono" style={{ fontSize: 11.5, fontWeight: 500 }}>{task.display_id}</span>
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
        <div style={{ fontSize: 10.5, color: isActive ? "var(--color-accent-fg)" : "var(--color-fg-subtle)", marginTop: 2 }}>
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
}: TaskQueuePanelProps) {
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: tasks.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 84,
    overscan: 5,
  });

  // 滚到接近末尾时触发加载下一页
  useEffect(() => {
    const virtualItems = virtualizer.getVirtualItems();
    if (!virtualItems.length) return;
    const last = virtualItems[virtualItems.length - 1];
    if (last.index >= tasks.length - 10 && hasNextPage && !isFetchingNextPage) {
      onFetchNextPage();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [virtualizer.getVirtualItems(), hasNextPage, isFetchingNextPage]);

  if (!open) {
    return (
      <div style={{ borderRight: "1px solid var(--color-border)", overflow: "hidden" }}>
        <button onClick={onToggle} title="展开任务列表" style={stripStyle}>
          <Icon name="chevRight" size={13} />
          <span style={{ fontSize: 10, writingMode: "vertical-rl", letterSpacing: 1, opacity: 0.6 }}>任务列表</span>
        </button>
      </div>
    );
  }

  return (
    <div
      style={{
        background: "var(--color-bg-elev)", borderRight: "1px solid var(--color-border)",
        display: "flex", flexDirection: "column", overflow: "hidden",
      }}
    >
      <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--color-border)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
          <Button variant="ghost" size="sm" onClick={onBack} style={{ padding: "2px 6px" }}>
            <Icon name="chevLeft" size={11} />返回总览
          </Button>
          <Button variant="ghost" size="sm" onClick={onToggle} title="收起任务列表" style={{ padding: "2px 6px" }}>
            <Icon name="chevLeft" size={11} />
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
            <option value="">全部批次</option>
            {batches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name} ({b.completed_tasks}/{b.total_tasks})
              </option>
            ))}
          </select>
        </div>
      )}

      <div style={{ padding: "10px 14px 6px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ fontSize: 12, fontWeight: 600 }}>任务队列</div>
        <span className="mono" style={{ fontSize: 11, color: "var(--color-fg-subtle)" }}>
          {taskIdx + 1} / {tasks.length}{hasNextPage ? "+" : ""}
        </span>
      </div>

      <div ref={parentRef} style={{ flex: 1, overflowY: "auto", padding: "0 8px 10px" }}>
        <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
          {virtualizer.getVirtualItems().map((vItem) => {
            const t = tasks[vItem.index];
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
    </div>
  );
}
