import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { ApiError } from "@/api/client";
import type { BatchResponse } from "@/api/batches";
import { useAuthStore } from "@/stores/authStore";
import { BatchAssignmentModal } from "./BatchAssignmentModal";
const api = vi.hoisted(() => ({ previewAssignment: vi.fn(), applyAssignment: vi.fn() }));
vi.mock("@/api/batches", () => ({ batchesApi: api }));
vi.mock("@/hooks/useProjects", () => ({
  useProjectMembers: () => ({
    data: [
      {
        id: "m1",
        user_id: "u1",
        user_name: "Worker",
        user_email: "worker@test.local",
        role: "annotator",
      },
    ],
    isLoading: false,
  }),
}));
const plan = {
  project_id: "p1",
  preview_version: "v1",
  total_batches: 1,
  candidate_batches: 1,
  changed_batches: 1,
  skipped_batches: 0,
  only_unassigned: false,
  recipient_summary: [
    { user_id: "u1", role: "annotator", new_task_count: 3, existing_backlog_count: 5 },
  ],
  items: [
    {
      batch_id: "b1",
      display_id: "B1",
      name: "Batch",
      status: "draft",
      task_count: 3,
      before_annotator_id: null,
      after_annotator_id: "u1",
      before_reviewer_id: null,
      after_reviewer_id: null,
      will_change: true,
    },
  ],
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
it("requires preview, shows workload, and discards a stale plan before retrying", async () => {
  api.previewAssignment
    .mockResolvedValueOnce(plan)
    .mockResolvedValueOnce({ ...plan, preview_version: "v2" });
  api.applyAssignment
    .mockRejectedValueOnce(new ApiError(409, "请重新预览"))
    .mockResolvedValueOnce({});
  const close = vi.fn();
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}
    >
      <BatchAssignmentModal
        projectId="p1"
        batch={{ id: "b1", name: "Batch", annotator_id: null, reviewer_id: null } as BatchResponse}
        onClose={close}
      />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: /Worker/ }));
  fireEvent.click(screen.getByRole("button", { name: "预览分派" }));
  await screen.findByText("新增待办 3 · 已有待办 5");
  expect(api.applyAssignment).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "确认分派" }));
  await screen.findByRole("button", { name: "预览分派" });
  expect(close).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "预览分派" }));
  fireEvent.click(await screen.findByRole("button", { name: "确认分派" }));
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
  expect(api.applyAssignment.mock.calls[1]).toEqual([
    "p1",
    "b1",
    { annotator_id: "u1", reviewer_id: null, preview_version: "v2" },
  ]);
});
