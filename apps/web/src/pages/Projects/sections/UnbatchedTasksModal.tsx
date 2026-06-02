// v0.12.0 · P2 · 浏览未归类任务池（batch_id IS NULL）。
// cursor 无限滚动 + @tanstack/react-virtual，显示 display_id / file_name / 缩略图。
import { useCallback, useEffect, useMemo, useRef } from "react";
import type { ReactNode } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Modal } from "@/components/ui/Modal";
import { Thumbnail } from "@/components/Thumbnail";
import { useTaskList } from "@/hooks/useTasks";
import styles from "./UnbatchedTasksModal.module.css";

function VirtualInner({ height, children }: { height: number; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.style.setProperty("height", `${height}px`);
  }, [height]);
  return (
    <div ref={ref} className={styles.virtualInner}>
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
  const ref = useCallback(
    (node: HTMLDivElement | null) => {
      if (node) node.style.setProperty("transform", `translateY(${start}px)`);
    },
    [start],
  );
  return (
    <div ref={ref} className={styles.virtualRow}>
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
      <div className={styles.body}>
        {isLoading && <div className={styles.placeholder}>加载中…</div>}
        {!isLoading && tasks.length === 0 && (
          <div className={styles.placeholder}>没有未归类任务。</div>
        )}
        {!isLoading && tasks.length > 0 && (
          <div ref={parentRef} className={styles.scrollArea}>
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
                    <div className={styles.rowText}>
                      <div className={styles.fileName} title={task.file_name}>
                        {task.file_name}
                      </div>
                      <div className={styles.displayId}>{task.display_id}</div>
                    </div>
                  </VirtualRow>
                );
              })}
            </VirtualInner>
            {isFetchingNextPage && (
              <div className={styles.loadingMore}>加载更多…</div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
