/**
 * v0.9.13 · 项目级 batch 状态变更 WS 订阅.
 *
 * 后端在 BatchService.transition / check_auto_transitions 转态成功后,
 * `publish_batch_status_change()` 推 `batch.status_changed` 到频道
 * `project:{project_id}:batch`. 本 hook 解析后 invalidate ["batches", projectId]
 * + ["projects"] (后者因为 project 卡片 / 总览也聚合 batch 计数).
 *
 * 在以下 3 个 useBatches 消费方挂载:
 *   - AIPreAnnotate/ProjectDetailPanel
 *   - Projects/sections/BatchesSection (项目设置)
 *   - Workbench/shell/WorkbenchShell
 *
 * 修复 B-15 第二症状: 标注员触发 task in_progress 后 batch 自动从 active/pre_annotated
 * → annotating, 但前端原本无 invalidate 路径 (useBatches 无 refetchInterval, 只
 * 依赖 useNotificationSocket 的 ["notifications"] 通知触发, 而 batch.auto_transition
 * 不写 notification 表). 本 hook 闭环此感知.
 */

import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { useReconnectingWebSocket } from "@/hooks/useReconnectingWebSocket";
import { buildWsUrl } from "@/lib/wsHost";

export function useBatchEventsSocket(projectId: string | undefined): void {
  const qc = useQueryClient();
  const url = projectId ? buildWsUrl(`/ws/batches/project/${projectId}`) : null;

  const onMessage = useCallback(
    (e: MessageEvent) => {
      let parsed: { type?: string } | null = null;
      try {
        parsed = JSON.parse(e.data);
      } catch {
        return;
      }
      if (!parsed) return;
      // 心跳 ping 帧不触发 invalidate
      if (parsed.type === "ping") return;
      if (parsed.type !== "batch.status_changed") return;
      qc.invalidateQueries({ queryKey: ["batches", projectId] });
      qc.invalidateQueries({ queryKey: ["projects"] });
    },
    [qc, projectId],
  );

  useReconnectingWebSocket(url, { onMessage, enabled: !!projectId });
}
