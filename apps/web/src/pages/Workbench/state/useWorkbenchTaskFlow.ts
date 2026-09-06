/**
 * v0.6.6 · WorkbenchShell 第三刀。
 *
 * 从 WorkbenchShell.tsx 抽出切题 + 提交流程：
 *   - navigateTask(direction)        切上/下一题，距末页 10 条预加载
 *   - smartNext(mode)                N=未标注 / U=不确定，无目标自动加载下一页 + toast
 *   - hasMissingRequired             所有 annotation 必填属性巡检
 *   - handleSubmitTask()             提交质检（必填巡检拦截 + 成功后自动切下一题）
 *
 * 之前 v0.6.4 拆 hotkeys + actions、v0.6.5 拆 canvas 草稿持久化；本 hook 让
 * shell 文件再瘦 ~80 行，并把 task flow 与 ImageStage 渲染逻辑解耦，便于单测。
 */
import { useCallback, useEffect, useMemo, useRef } from "react";
import type { TaskResponse, AnnotationResponse } from "@/types";
import type { AttributeSchema } from "@/api/projects";
import { getMissingRequired } from "../shell/AttributeForm";

interface ToastFn {
  (toast: { msg: string; sub?: string; kind?: "success" | "warning" | "error" | "" }): void;
}

export interface UseWorkbenchTaskFlowParams {
  taskId: string | undefined;
  task: TaskResponse | undefined;
  tasks: TaskResponse[];
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage: () => void;
  annotationsRef: React.MutableRefObject<AnnotationResponse[]>;
  /** 当 annotations 列表变化时触发 hasMissingRequired 重算（外部传入 query data 即可） */
  annotationsData: unknown;
  /** Project 对象（仅读 attribute_schema），保持松类型以兼容 generated client */
  currentProject: { attribute_schema?: unknown } | undefined;
  userBoxesCount: number;
  setCurrentTaskId: (id: string) => void | Promise<boolean>;
  setSelectedId: (id: string | null) => void;
  pushToast: ToastFn;
  submitTaskMut: {
    mutate: (id: string, opts?: { onSuccess?: () => void; onError?: (e: unknown) => void }) => void;
  };
}

export interface UseWorkbenchTaskFlowResult {
  navigateTask: (direction: "next" | "prev") => void;
  smartNext: (mode: "open" | "uncertain") => void;
  hasMissingRequired: boolean;
  handleSubmitTask: () => void;
}

export function relativeTaskTargetId(
  taskIds: readonly string[],
  committedTaskId: string | undefined,
  pendingTaskId: string | null,
  direction: "next" | "prev",
): string | null {
  const baseTaskId = pendingTaskId ?? committedTaskId;
  const index = taskIds.indexOf(baseTaskId ?? "");
  if (index < 0) return null;
  const targetIndex =
    direction === "next" ? Math.min(index + 1, taskIds.length - 1) : Math.max(0, index - 1);
  return taskIds[targetIndex] === baseTaskId ? null : taskIds[targetIndex];
}

export function useWorkbenchTaskFlow(p: UseWorkbenchTaskFlowParams): UseWorkbenchTaskFlowResult {
  const {
    taskId,
    task,
    tasks,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
    annotationsRef,
    annotationsData,
    currentProject,
    userBoxesCount,
    setCurrentTaskId,
    setSelectedId,
    pushToast,
    submitTaskMut,
  } = p;
  const pendingRelativeTaskIdRef = useRef<string | null>(null);

  useEffect(() => {
    const pendingTaskId = pendingRelativeTaskIdRef.current;
    if (
      !pendingTaskId ||
      pendingTaskId === taskId ||
      !tasks.some((item) => item.id === pendingTaskId)
    ) {
      pendingRelativeTaskIdRef.current = null;
    }
  }, [taskId, tasks]);

  const navigateTask = useCallback(
    (direction: "next" | "prev") => {
      if (tasks.length === 0) return;
      const targetTaskId = relativeTaskTargetId(
        tasks.map((item) => item.id),
        taskId,
        pendingRelativeTaskIdRef.current,
        direction,
      );
      if (!targetTaskId) return;
      const newIdx = tasks.findIndex((item) => item.id === targetTaskId);
      // 距末页 10 条时预加载下一页
      if (
        direction === "next" &&
        newIdx >= tasks.length - 10 &&
        hasNextPage &&
        !isFetchingNextPage
      ) {
        fetchNextPage();
      }
      pendingRelativeTaskIdRef.current = targetTaskId;
      void Promise.resolve(setCurrentTaskId(targetTaskId)).then((allowed) => {
        if (allowed === false && pendingRelativeTaskIdRef.current === targetTaskId) {
          pendingRelativeTaskIdRef.current = null;
        }
      });
      setSelectedId(null);
    },
    [
      tasks,
      taskId,
      hasNextPage,
      isFetchingNextPage,
      fetchNextPage,
      setCurrentTaskId,
      setSelectedId,
    ],
  );

  /** N（下一未标注）/ U（下一最不确定，total_predictions desc）。 */
  const smartNext = useCallback(
    (mode: "open" | "uncertain") => {
      if (tasks.length === 0) return;
      const idx = tasks.findIndex((t) => t.id === taskId);
      const after = tasks.slice(idx + 1);
      const target =
        mode === "open"
          ? after.find((t) => t.status !== "completed" && t.total_annotations === 0)
          : [...after]
              .filter((t) => t.total_predictions > 0 && t.total_annotations === 0)
              .sort((a, b) => b.total_predictions - a.total_predictions)[0];
      if (!target) {
        if (hasNextPage && !isFetchingNextPage) {
          fetchNextPage();
          pushToast({ msg: "正在加载下一页任务…", kind: "warning" });
        } else {
          pushToast({
            msg: mode === "open" ? "前方已无未标注题目" : "前方已无不确定题目",
            kind: "warning",
          });
        }
        return;
      }
      setCurrentTaskId(target.id);
      setSelectedId(null);
    },
    [
      tasks,
      taskId,
      hasNextPage,
      isFetchingNextPage,
      fetchNextPage,
      setCurrentTaskId,
      setSelectedId,
      pushToast,
    ],
  );

  /** 计算所有 annotation 中是否有 required 属性未填（驱动提交按钮 disabled）。 */
  const hasMissingRequired = useMemo(() => {
    const schema = currentProject?.attribute_schema as AttributeSchema | null | undefined;
    if (!schema || !schema.fields || schema.fields.length === 0) return false;
    for (const a of annotationsRef.current) {
      if (getMissingRequired(schema, a.class_name, a.attributes ?? {}).length > 0) return true;
    }
    return false;
    // 当 annotations 列表变化时重算
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [annotationsData, currentProject?.attribute_schema]);

  const handleSubmitTask = useCallback(() => {
    if (!taskId) return;
    if (hasMissingRequired) {
      pushToast({
        msg: "存在必填属性未填，无法提交",
        sub: "请检查右侧标注属性表单",
        kind: "error",
      });
      return;
    }
    submitTaskMut.mutate(taskId, {
      onSuccess: () => {
        pushToast({
          msg: `已提交 ${task?.display_id} 至质检`,
          sub: `共 ${userBoxesCount} 个标注`,
          kind: "success",
        });
        navigateTask("next");
      },
    });
  }, [
    taskId,
    submitTaskMut,
    pushToast,
    task?.display_id,
    userBoxesCount,
    navigateTask,
    hasMissingRequired,
  ]);

  return { navigateTask, smartNext, hasMissingRequired, handleSubmitTask };
}
