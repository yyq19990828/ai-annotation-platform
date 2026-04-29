import { useCallback, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiClient } from "@/api/client";
import { useReconnectingWebSocket, type ReconnectState } from "@/hooks/useReconnectingWebSocket";

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
    ? `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}/ws/projects/${projectId}/preannotate`
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

export function useTriggerPreannotation(projectId: string | undefined) {
  return useMutation({
    mutationFn: (payload: { ml_backend_id: string; task_ids?: string[] }) => {
      if (!projectId) throw new Error("No project selected");
      return apiClient.post<{ job_id: string; status: string }>(
        `/projects/${projectId}/preannotate`,
        payload,
      );
    },
  });
}
