import { useCallback, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiClient } from "@/api/client";
import { useReconnectingWebSocket, type ReconnectState } from "@/hooks/useReconnectingWebSocket";
import { buildWsUrl } from "@/lib/wsHost";

interface PreannotationProgress {
  current: number;
  total: number;
  status: "running" | "completed" | "error";
  error: string | null;
}

export function usePreannotationProgress(projectId: string | undefined): {
  progress: PreannotationProgress | null;
  connection: ReconnectState;
  retries: number;
} {
  const [progress, setProgress] = useState<PreannotationProgress | null>(null);

  const url = projectId
    ? buildWsUrl(`/ws/projects/${projectId}/preannotate`)
    : null;

  const onMessage = useCallback((e: MessageEvent) => {
    try {
      setProgress(JSON.parse(e.data));
    } catch {
      // ignore parse errors
    }
  }, []);

  const { state, retries } = useReconnectingWebSocket(url, { onMessage, enabled: !!projectId });

  return { progress, connection: state, retries };
}

export type TextOutputMode = "box" | "mask" | "both";

export interface TriggerPreannotationPayload {
  ml_backend_id: string;
  task_ids?: string[];
  /** v0.9.5 · 文本批量预标可选项 */
  prompt?: string;
  output_mode?: TextOutputMode;
  batch_id?: string;
  /** v0.10.38 · 按后端参数面板 (epic 阶段 2): 选中 backend 的 /setup.params 值, 覆盖项目级阈值兜底. */
  params?: Record<string, unknown>;
}

export interface TriggerPreannotationResponse {
  job_id: string;
  status: string;
  total_tasks?: number | null;
  channel?: string;
}

export function useTriggerPreannotation(projectId: string | undefined) {
  return useMutation({
    mutationFn: (payload: TriggerPreannotationPayload) => {
      if (!projectId) throw new Error("No project selected");
      return apiClient.post<TriggerPreannotationResponse>(
        `/projects/${projectId}/preannotate`,
        payload,
      );
    },
  });
}
