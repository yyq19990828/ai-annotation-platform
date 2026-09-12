import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { useAuthStore } from "@/stores/authStore";
import { InvitationListPanel } from "./InvitationListPanel";
const api = vi.hoisted(() => ({ page: vi.fn(), stats: vi.fn(), exportInvitations: vi.fn() }));
vi.mock("@/api/invitations", () => ({ invitationsApi: api }));
vi.mock("@/hooks/useProjects", () => ({
  useProjects: () => ({ data: [{ id: "p1", name: "Project" }] }),
}));
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
  api.page.mockImplementation(async (params) => ({
    items: [],
    total: 1000,
    pages: 40,
    page: params.page,
    page_size: 25,
  }));
  api.stats.mockResolvedValue({ total: 1000, pending: 1000, accepted: 0, revoked: 0, expired: 0 });
});
it("paginates 1000 invitations and shares selected filters with stats and export", async () => {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter>
        <InvitationListPanel />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  fireEvent.click(await screen.findByRole("button", { name: "下一页" }));
  await screen.findByText("第 2 / 40 页 · 共 1000 条");
  expect(api.page).toHaveBeenLastCalledWith(
    expect.objectContaining({ page: 2, page_size: 25 }),
    expect.any(AbortSignal),
  );
  fireEvent.change(screen.getByLabelText("邀请项目筛选"), { target: { value: "p1" } });
  fireEvent.change(screen.getByLabelText("邀请角色筛选"), { target: { value: "reviewer" } });
  fireEvent.click(screen.getByRole("button", { name: "待接受" }));
  fireEvent.change(screen.getByLabelText("搜索邀请"), { target: { value: "test" } });
  const filters = {
    scope: "me",
    status: "pending",
    project_id: "p1",
    role: "reviewer",
    search: "test",
  };
  await waitFor(() =>
    expect(api.page).toHaveBeenLastCalledWith(
      { ...filters, page: 1, page_size: 25 },
      expect.any(AbortSignal),
    ),
  );
  expect(api.stats).toHaveBeenLastCalledWith(filters, expect.any(AbortSignal));
  fireEvent.click(screen.getByRole("button", { name: "导出筛选结果" }));
  expect(api.exportInvitations).toHaveBeenCalledWith(filters);
  await waitFor(() => expect(screen.getByRole("button", { name: "导出筛选结果" })).toBeEnabled());
});
