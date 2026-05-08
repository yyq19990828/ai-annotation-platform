import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  projectsApi,
  type ProjectCreatePayload,
  type ProjectUpdatePayload,
  type ProjectListParams,
} from "../api/projects";

export function useProjects(params?: ProjectListParams) {
  return useQuery({
    queryKey: ["projects", params],
    queryFn: () => projectsApi.list(params),
  });
}

export function useProjectStats() {
  return useQuery({
    queryKey: ["project-stats"],
    queryFn: projectsApi.stats,
  });
}

export function useProject(id: string) {
  return useQuery({
    queryKey: ["project", id],
    queryFn: () => projectsApi.get(id),
    enabled: !!id,
  });
}

export function useCreateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: ProjectCreatePayload) => projectsApi.create(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      qc.invalidateQueries({ queryKey: ["project-stats"] });
    },
  });
}

export function useUpdateProject(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: ProjectUpdatePayload) => projectsApi.update(id, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      qc.invalidateQueries({ queryKey: ["project", id] });
      qc.invalidateQueries({ queryKey: ["project-stats"] });
    },
  });
}

export function useDeleteProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => projectsApi.remove(id),
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      qc.invalidateQueries({ queryKey: ["project", id] });
      qc.invalidateQueries({ queryKey: ["project-stats"] });
    },
  });
}

export function useTransferProject(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (new_owner_id: string) => projectsApi.transfer(id, new_owner_id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      qc.invalidateQueries({ queryKey: ["project", id] });
    },
  });
}

// B-13 · 重命名项目类别 (后端原子改 classes_config + annotations.class_name)
export function useRenameClass(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { old_name: string; new_name: string }) =>
      projectsApi.renameClass(id, vars.old_name, vars.new_name),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["project", id] });
      qc.invalidateQueries({ queryKey: ["projects"] });
      // 重命名会迁移 annotations.class_name → 让工作台 / dashboard 数据失效重拉
      qc.invalidateQueries({ queryKey: ["annotations"] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
    },
  });
}

export function useProjectMembers(id: string) {
  return useQuery({
    queryKey: ["project-members", id],
    queryFn: () => projectsApi.listMembers(id),
    enabled: !!id,
  });
}

export function useAddProjectMember(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: { user_id: string; role: "annotator" | "reviewer" }) =>
      projectsApi.addMember(id, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["project-members", id] });
      qc.invalidateQueries({ queryKey: ["project", id] });
      qc.invalidateQueries({ queryKey: ["projects"] });
    },
  });
}

export function useRemoveProjectMember(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (memberId: string) => projectsApi.removeMember(id, memberId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["project-members", id] });
      qc.invalidateQueries({ queryKey: ["project", id] });
      qc.invalidateQueries({ queryKey: ["projects"] });
    },
  });
}
