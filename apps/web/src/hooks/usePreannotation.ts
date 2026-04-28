import { useState, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiClient } from "@/api/client";

interface PreannotationProgress {
  current: number;
  total: number;
  status: "running" | "completed" | "error";
  error: string | null;
}

export function usePreannotationProgress(projectId: string | undefined) {
  const [progress, setProgress] = useState<PreannotationProgress | null>(null);

  useEffect(() => {
    if (!projectId) return;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws/projects/${projectId}/preannotate`);

    ws.onmessage = (e) => {
      try {
        setProgress(JSON.parse(e.data));
      } catch {
        // ignore parse errors
      }
    };

    ws.onclose = () => setProgress(null);
    ws.onerror = () => setProgress(null);

    return () => {
      ws.close();
    };
  }, [projectId]);

  return progress;
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
