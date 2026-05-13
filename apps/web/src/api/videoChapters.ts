import { apiClient } from "./client";

export interface VideoChapter {
  id: string;
  dataset_item_id: string;
  start_frame: number;
  end_frame: number;
  title: string;
  color: string | null;
  metadata: Record<string, unknown>;
  created_by: string | null;
  created_at: string;
  updated_at: string | null;
}

export interface VideoChapterCreatePayload {
  start_frame: number;
  end_frame: number;
  title: string;
  color?: string | null;
  metadata?: Record<string, unknown>;
}

export interface VideoChapterUpdatePayload {
  start_frame?: number;
  end_frame?: number;
  title?: string;
  color?: string | null;
  metadata?: Record<string, unknown>;
}

interface VideoChapterListResponse {
  chapters: VideoChapter[];
}

export const videoChaptersApi = {
  list: (datasetItemId: string) =>
    apiClient
      .get<VideoChapterListResponse>(`/videos/${datasetItemId}/chapters`)
      .then((res) => res.chapters ?? []),
  create: (datasetItemId: string, payload: VideoChapterCreatePayload) =>
    apiClient.post<VideoChapter>(`/videos/${datasetItemId}/chapters`, payload),
  update: (
    datasetItemId: string,
    chapterId: string,
    payload: VideoChapterUpdatePayload,
  ) =>
    apiClient.patch<VideoChapter>(
      `/videos/${datasetItemId}/chapters/${chapterId}`,
      payload,
    ),
  delete: (datasetItemId: string, chapterId: string) =>
    apiClient.delete<void>(`/videos/${datasetItemId}/chapters/${chapterId}`),
};
