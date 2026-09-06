import { useQuery } from "@tanstack/react-query";

import { tasksApi } from "@/api/tasks";

export const SCENE_TIMELINE_QUERY_KEY = "scene-timeline";

export function useSceneTimeline(
  taskId: string | null | undefined,
  startFrame: number,
  endFrame: number,
  trackId?: string | null,
) {
  return useQuery({
    queryKey: [SCENE_TIMELINE_QUERY_KEY, 1, taskId, startFrame, endFrame, trackId ?? null],
    queryFn: ({ signal }) =>
      tasksApi.getSceneTimeline(taskId!, startFrame, endFrame, trackId, { signal }),
    enabled: !!taskId,
    staleTime: 30_000,
    placeholderData: (previous) =>
      previous
        ? {
            ...previous,
            window_start_frame: startFrame,
            window_end_frame: endFrame,
            frames: [],
          }
        : undefined,
  });
}
