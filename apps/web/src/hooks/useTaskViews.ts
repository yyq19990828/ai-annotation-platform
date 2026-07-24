import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  taskViewsApi,
  type DataManagerEntityQueryPayload,
  type DataManagerEntityScope,
  type ProjectTaskQueryPayload,
  type ProjectTaskViewPayload,
  type ProjectTaskViewUpdatePayload,
} from "@/api/taskViews";

export function useTaskViews(
  projectId: string | undefined,
  entityScope: DataManagerEntityScope = "tasks",
) {
  return useQuery({
    queryKey: ["task-views", projectId, entityScope],
    queryFn: () => taskViewsApi.list(projectId!, entityScope),
    enabled: !!projectId,
  });
}

export function useProjectTaskQuery(
  projectId: string | undefined,
  payload: ProjectTaskQueryPayload,
  enabled = true,
) {
  return useQuery({
    queryKey: ["project-task-query", projectId, payload],
    queryFn: () => taskViewsApi.query(projectId!, payload),
    enabled: !!projectId && enabled,
    placeholderData: keepPreviousData,
  });
}

export function useDataManagerSchema(
  projectId: string | undefined,
  entityScope: DataManagerEntityScope = "tasks",
) {
  return useQuery({
    queryKey: ["data-manager-schema", projectId, entityScope],
    queryFn: () => taskViewsApi.schema(projectId!, entityScope),
    enabled: !!projectId,
    staleTime: 60_000,
  });
}

export function useDataManagerObjects(
  projectId: string | undefined,
  payload: Omit<DataManagerEntityQueryPayload, "cursor">,
  enabled = true,
) {
  return useInfiniteQuery({
    queryKey: ["data-manager-objects", projectId, payload],
    queryFn: ({ pageParam }) =>
      taskViewsApi.queryObjects(projectId!, { ...payload, cursor: pageParam }),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
    enabled: !!projectId && enabled,
  });
}

export function useDataManagerTracks(
  projectId: string | undefined,
  payload: Omit<DataManagerEntityQueryPayload, "cursor">,
  enabled = true,
) {
  return useInfiniteQuery({
    queryKey: ["data-manager-tracks", projectId, payload],
    queryFn: ({ pageParam }) =>
      taskViewsApi.queryTracks(projectId!, { ...payload, cursor: pageParam }),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
    enabled: !!projectId && enabled,
  });
}

export function useDataManagerObjectDetail(
  projectId: string | undefined,
  annotationId: string | null,
) {
  return useQuery({
    queryKey: ["data-manager-object-detail", projectId, annotationId],
    queryFn: () => taskViewsApi.objectDetail(projectId!, annotationId!),
    enabled: !!projectId && !!annotationId,
  });
}

export function useDataManagerTrackDetail(projectId: string | undefined, trackRef: string | null) {
  return useQuery({
    queryKey: ["data-manager-track-detail", projectId, trackRef],
    queryFn: () => taskViewsApi.trackDetail(projectId!, trackRef!),
    enabled: !!projectId && !!trackRef,
  });
}

export function useDataManagerSummary(
  projectId: string | undefined,
  filterJson: Record<string, unknown>,
  enabled = true,
) {
  return useQuery({
    queryKey: ["data-manager-summary", projectId, filterJson],
    queryFn: () => taskViewsApi.summary(projectId!, filterJson),
    enabled: !!projectId && enabled,
    placeholderData: keepPreviousData,
  });
}

export function useDataManagerMatches(
  projectId: string | undefined,
  taskId: string | null,
  filterJson: Record<string, unknown>,
  enabled = true,
) {
  return useQuery({
    queryKey: ["data-manager-matches", projectId, taskId, filterJson],
    queryFn: () => taskViewsApi.matches(projectId!, taskId!, filterJson),
    enabled: !!projectId && !!taskId && enabled,
  });
}

export function useCreateTaskView(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: ProjectTaskViewPayload) => taskViewsApi.create(projectId, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["task-views", projectId] });
    },
  });
}

export function useUpdateTaskView(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ viewId, payload }: { viewId: string; payload: ProjectTaskViewUpdatePayload }) =>
      taskViewsApi.update(projectId, viewId, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["task-views", projectId] });
      qc.invalidateQueries({ queryKey: ["project-task-query", projectId] });
    },
  });
}

export function useDeleteTaskView(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (viewId: string) => taskViewsApi.remove(projectId, viewId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["task-views", projectId] });
    },
  });
}

export function useCopyTaskView(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ viewId, name }: { viewId: string; name?: string }) =>
      taskViewsApi.copy(projectId, viewId, { name }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["task-views", projectId] });
    },
  });
}
