// v0.12.0 · P2 · 浏览未归类任务池（batch_id IS NULL）。
// cursor 无限滚动 + @tanstack/react-virtual，显示 display_id / file_name / 缩略图。
import { useEffect, useMemo, useRef } from "react";
import type { CSSProperties, ReactNode } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Modal } from "@/components/ui/Modal";
import { Thumbnail } from "@/components/Thumbnail";
import { useElementStyle } from "@/components/ui/useElementStyle";
import { useTaskList } from "@/hooks/useTasks";

function VirtualInner({ height, children }: { height: number; children: ReactNode }) {
  const ref = useElementStyle<HTMLDivElement>({ "--virtual-height": `${height}px` } as CSSProperties);
  return (
    <div ref={ref} className="relative w-full h-[var(--virtual-height)]">
      {children}
    </div>
  );
}

function VirtualRow({
  start,
  children,
}: {
  start: number;
  children: ReactNode;
}) {
  const ref = useElementStyle<HTMLDivElement>({ "--virtual-start": `${start}px` } as CSSProperties);
  return (
    <div
      ref={ref}
      className="absolute left-0 top-0 flex h-14 w-full translate-y-[var(--virtual-start)] items-center gap-2.5 border-b border-border px-1"
    >
      {children}
    </div>
  );
}

export function UnbatchedTasksModal({
  projectId,
  count,
  onClose,
}: {
  projectId: string;
  count: number;
  onClose: () => void;
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  const {
    data,
    isLoading,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
  } = useTaskList(projectId, { unbatched: true });

  const tasks = useMemo(
    () => data?.pages.flatMap((p) => p.items) ?? [],
    [data],
  );

  const virtualizer = useVirtualizer({
    count: tasks.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 56,
    overscan: 6,
  });

  // 滚到接近末尾时拉下一页
  useEffect(() => {
    const items = virtualizer.getVirtualItems();
    if (!items.length) return;
    const last = items[items.length - 1];
    if (last.index >= tasks.length - 10 && hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [virtualizer.getVirtualItems(), hasNextPage, isFetchingNextPage]);

  return (
    <Modal open onClose={onClose} title={`未归类任务（${count}）`} width={560}>
      <div className="flex min-h-[120px] flex-col">
        {isLoading && (
          <div className="py-8 text-center text-sm text-muted-foreground">加载中…</div>
        )}
        {!isLoading && tasks.length === 0 && (
          <div className="py-8 text-center text-sm text-muted-foreground">没有未归类任务。</div>
        )}
        {!isLoading && tasks.length > 0 && (
          <div ref={parentRef} className="relative max-h-[60vh] overflow-y-auto">
            <VirtualInner height={virtualizer.getTotalSize()}>
              {virtualizer.getVirtualItems().map((vItem) => {
                const task = tasks[vItem.index];
                return (
                  <VirtualRow key={task.id} start={vItem.start}>
                    <Thumbnail
                      src={task.thumbnail_url}
                      blurhash={task.blurhash}
                      alt={task.file_name}
                      width={40}
                      height={40}
                    />
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <div
                        className="overflow-hidden text-ellipsis whitespace-nowrap text-sm text-foreground"
                        title={task.file_name}
                      >
                        {task.file_name}
                      </div>
                      <div className="text-xs tabular-nums text-muted-foreground">
                        {task.display_id}
                      </div>
                    </div>
                  </VirtualRow>
                );
              })}
            </VirtualInner>
            {isFetchingNextPage && (
              <div className="py-2.5 text-center text-xs text-muted-foreground">加载更多…</div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
