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

/** v0.11.24 · 预标幂等模式 */
export type PredictMode = "skip_predicted" | "overwrite" | "append";

export interface TriggerPreannotationPayload {
  ml_backend_id: string;
  task_ids?: string[];
  /** v0.9.5 · 文本批量预标可选项 */
  prompt?: string;
  output_mode?: TextOutputMode;
  batch_id?: string;
  /** v0.10.38 · 按后端参数面板 (epic 阶段 2): 选中 backend 的 /setup.params 值, 覆盖项目级阈值兜底. */
  params?: Record<string, unknown>;
  /** v0.11.24 · 跳过已预标 (默认) / 覆盖历史预标 / 追加 */
  predict_mode?: PredictMode;
  /** v0.14.9 · 能力声明协议 v2: 多模型 backend 时指定目标 model 条目 id. */
  model_id?: string;
  /** v0.14.9 · 任务类型便捷别名 ("ocr" / "doc_layout" / "text"); OCR / 版面预标透传. */
  task_type?: string;
  /** v0.14.17 · 协议 v2 结构化路径 (YOLO 等多 task 几何 backend): 选中 variant 组合 (dict[axis,value]).
   *  非空时后端构造 v2 context (model_variants dict + nested params), 修通 YOLO 批量预标. */
  model_variants?: Record<string, string>;
  /** v0.14.17 · 类别白名单 (模型原生类别 index 子集); 空/缺=全部类别. 仅几何 backend (YOLO) 用. */
  class_filter?: number[];
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
