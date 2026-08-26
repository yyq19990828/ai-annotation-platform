import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { tasksApi } from "@/api/tasks";
import type {
  CameraAnnotationMemberCreate,
  CameraAnnotationMemberDelete,
  CameraAnnotationMemberList,
  CameraAnnotationMemberUpdate,
} from "@/api/generated";

export function cameraAnnotationMembersKey(taskId: string | null, sceneTrackId: string | null) {
  return ["camera-annotation-members", taskId, sceneTrackId] as const;
}

export function useCameraAnnotationMembers(
  taskId: string | null,
  sceneTrackId: string | null,
  sourceVersion: number | null,
  projectionCameraRole: string | null,
) {
  const queryClient = useQueryClient();
  const queryKey = cameraAnnotationMembersKey(taskId, sceneTrackId);
  const invalidate = () => queryClient.invalidateQueries({ queryKey });

  const query = useQuery({
    queryKey: [...queryKey, sourceVersion, projectionCameraRole],
    queryFn: ({ signal }) =>
      tasksApi.getCameraAnnotationMembers(taskId!, sceneTrackId!, projectionCameraRole, false, {
        signal,
      }),
    enabled: !!taskId && !!sceneTrackId,
  });

  const create = useMutation({
    mutationFn: (payload: CameraAnnotationMemberCreate) =>
      tasksApi.createCameraAnnotationMember(taskId!, payload),
    onSuccess: invalidate,
  });
  const update = useMutation({
    mutationFn: ({
      memberId,
      payload,
    }: {
      memberId: string;
      payload: CameraAnnotationMemberUpdate;
    }) => tasksApi.updateCameraAnnotationMember(taskId!, memberId, payload),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: ({
      memberId,
      payload,
    }: {
      memberId: string;
      payload: CameraAnnotationMemberDelete;
    }) => tasksApi.deleteCameraAnnotationMember(taskId!, memberId, payload),
    onSuccess: invalidate,
  });

  return {
    query,
    create,
    update,
    remove,
    busy: create.isPending || update.isPending || remove.isPending,
    data: query.data as CameraAnnotationMemberList | undefined,
  };
}
