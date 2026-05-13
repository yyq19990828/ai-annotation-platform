import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  videoChaptersApi,
  type VideoChapter,
  type VideoChapterCreatePayload,
  type VideoChapterUpdatePayload,
} from "@/api/videoChapters";

const chapterKey = (datasetItemId: string | null | undefined) =>
  ["video-chapters", datasetItemId ?? ""] as const;

export function useVideoChapters(datasetItemId: string | null | undefined) {
  return useQuery<VideoChapter[]>({
    queryKey: chapterKey(datasetItemId),
    queryFn: () =>
      datasetItemId
        ? videoChaptersApi.list(datasetItemId)
        : Promise.resolve([]),
    enabled: Boolean(datasetItemId),
    staleTime: 30_000,
  });
}

export function useCreateVideoChapter(datasetItemId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: VideoChapterCreatePayload) => {
      if (!datasetItemId) {
        return Promise.reject(new Error("dataset item id missing"));
      }
      return videoChaptersApi.create(datasetItemId, payload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: chapterKey(datasetItemId) });
    },
  });
}

export function useUpdateVideoChapter(datasetItemId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      chapterId,
      payload,
    }: {
      chapterId: string;
      payload: VideoChapterUpdatePayload;
    }) => {
      if (!datasetItemId) {
        return Promise.reject(new Error("dataset item id missing"));
      }
      return videoChaptersApi.update(datasetItemId, chapterId, payload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: chapterKey(datasetItemId) });
    },
  });
}

export function useDeleteVideoChapter(datasetItemId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (chapterId: string) => {
      if (!datasetItemId) {
        return Promise.reject(new Error("dataset item id missing"));
      }
      return videoChaptersApi.delete(datasetItemId, chapterId);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: chapterKey(datasetItemId) });
    },
  });
}
