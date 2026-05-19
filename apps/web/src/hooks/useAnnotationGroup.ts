/**
 * I12 · Object Group + 批量编辑 React Query mutation hooks.
 *
 * group / ungroup / bulkUpdate 都 invalidate `["annotations", taskId]`
 * 让 useAnnotations 重新拉一次, 反映 group_id 与字段变更.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  annotationGroupApi,
  type AnnotationBulkPatch,
  type BulkUpdateResponse,
  type GroupResponse,
  type UngroupResponse,
} from "@/api/annotationGroup";

function invalidateTaskAnnotations(
  qc: ReturnType<typeof useQueryClient>,
  taskId: string,
) {
  qc.invalidateQueries({ queryKey: ["annotations", taskId] });
  // useAnnotationCommentsInfinite / useAnnotationAuditHistory 不受影响, 不动.
}

export function useAnnotationGroup(taskId: string) {
  const qc = useQueryClient();
  return useMutation<GroupResponse, Error, string[]>({
    mutationFn: (ids) =>
      annotationGroupApi.group({ ids, task_id: taskId }),
    onSuccess: () => invalidateTaskAnnotations(qc, taskId),
  });
}

export function useAnnotationUngroup(taskId: string) {
  const qc = useQueryClient();
  return useMutation<UngroupResponse, Error, string[]>({
    mutationFn: (ids) => annotationGroupApi.ungroup({ ids }),
    onSuccess: () => invalidateTaskAnnotations(qc, taskId),
  });
}

export function useAnnotationBulkUpdate(taskId: string) {
  const qc = useQueryClient();
  return useMutation<
    BulkUpdateResponse,
    Error,
    { ids: string[]; patch: AnnotationBulkPatch }
  >({
    mutationFn: ({ ids, patch }) =>
      annotationGroupApi.bulkUpdate({ ids, patch }),
    onSuccess: () => invalidateTaskAnnotations(qc, taskId),
  });
}
