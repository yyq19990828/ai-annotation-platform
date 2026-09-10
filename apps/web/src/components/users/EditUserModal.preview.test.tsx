import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { useAuthStore } from "@/stores/authStore";
import type { RoleImpactPreview, UserResponse } from "@/api/users";
import { EditUserModal } from "./EditUserModal";
const api = vi.hoisted(() => ({ previewRoleChange: vi.fn(), changeRole: vi.fn() }));
vi.mock("@/api/users", () => ({ usersApi: api }));
vi.mock("@/hooks/useGroups", () => ({ useGroups: () => ({ data: [] }) }));
const user = {
  id: "a",
  name: "A",
  email: "a@test.local",
  role: "annotator",
  group_id: null,
} as UserResponse;
const preview: RoleImpactPreview = {
  user_id: "a",
  email: user.email,
  current_role: "annotator",
  requested_role: "annotator",
  can_change: true,
  blockers: [],
  projects: [],
  other_project_count: 2,
  warnings: ["平台角色对所有项目生效"],
  assigned_batch_count: 0,
  assigned_task_count: 0,
  review_task_count: 0,
};
beforeEach(() => {
  vi.resetAllMocks();
  useAuthStore.getState().setAuth("token", {
    id: "admin",
    name: "Admin",
    email: "admin@test.local",
    role: "super_admin",
    status: "active",
    group_name: null,
    created_at: "2026-09-09",
  });
});
function wrap(userData: UserResponse) {
  return (
    <QueryClientProvider client={new QueryClient()}>
      <EditUserModal open user={userData} onClose={vi.fn()} />
    </QueryClientProvider>
  );
}
it("discards a late preview for a previous target", async () => {
  let resolve!: (value: RoleImpactPreview) => void;
  api.previewRoleChange
    .mockReturnValueOnce(
      new Promise<RoleImpactPreview>((done) => {
        resolve = done;
      }),
    )
    .mockResolvedValueOnce({
      ...preview,
      user_id: "b",
      warnings: ["B 的角色影响"],
      other_project_count: 0,
    });
  const { rerender } = render(wrap(user));
  await waitFor(() => expect(api.previewRoleChange).toHaveBeenCalledWith("a", "annotator"));
  rerender(wrap({ ...user, id: "b", name: "B" }));
  await screen.findByText("B 的角色影响");
  await act(async () => {
    resolve({ ...preview, warnings: ["过期的 A 影响"] });
  });
  expect(screen.queryByText("过期的 A 影响")).not.toBeInTheDocument();
  expect(screen.getByText("B 的角色影响")).toBeVisible();
});
it("shows anonymous cross-project impact and waits for the selected role preview before saving", async () => {
  let resolve!: (value: RoleImpactPreview) => void;
  api.previewRoleChange.mockResolvedValueOnce(preview).mockReturnValueOnce(
    new Promise<RoleImpactPreview>((done) => {
      resolve = done;
    }),
  );
  api.changeRole.mockResolvedValue({ ...user, role: "reviewer" });
  render(wrap(user));
  await screen.findByText(/另涉及 2 个管理范围外/);
  fireEvent.change(screen.getByLabelText("角色"), { target: { value: "reviewer" } });
  expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();
  await act(async () => {
    resolve({ ...preview, requested_role: "reviewer" });
  });
  fireEvent.click(screen.getByRole("button", { name: "保存" }));
  await waitFor(() => expect(api.changeRole).toHaveBeenCalledWith("a", "reviewer"));
});
