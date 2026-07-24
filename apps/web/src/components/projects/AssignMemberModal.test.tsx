import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AssignMemberModal } from "./AssignMemberModal";
import type { ProjectMemberResponse } from "@/api/projects";

const mockMutateAsync = vi.fn();
const mockUsersList = vi.fn();
const mockPushToast = vi.fn();

vi.mock("@/hooks/useProjects", () => ({
  useAddProjectMember: () => ({
    mutateAsync: mockMutateAsync,
    isPending: false,
  }),
}));

vi.mock("@/api/users", () => ({
  usersApi: {
    list: (...args: unknown[]) => mockUsersList(...args),
  },
}));

vi.mock("@/components/ui/Toast", async () => {
  const actual =
    await vi.importActual<typeof import("@/components/ui/Toast")>("@/components/ui/Toast");
  return {
    ...actual,
    useToastStore: <T,>(sel: (s: { push: typeof mockPushToast }) => T) =>
      sel({ push: mockPushToast }),
  };
});

const USERS = {
  annotator: [
    { id: "u1", name: "Alice", email: "alice@example.com", role: "annotator" },
    { id: "u2", name: "Bob", email: "bob@example.com", role: "annotator" },
    { id: "u3", name: "Existing", email: "existing@example.com", role: "annotator" },
  ],
  reviewer: [{ id: "u4", name: "Rita", email: "rita@example.com", role: "reviewer" }],
};

const EXISTING = [
  {
    id: "m1",
    user_id: "u3",
    user_name: "Existing",
    user_email: "existing@example.com",
    role: "annotator",
    assigned_at: "2026-05-01T00:00:00Z",
  },
] as ProjectMemberResponse[];

function renderModal() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AssignMemberModal open projectId="p1" existing={EXISTING} onClose={vi.fn()} />
    </QueryClientProvider>,
  );
}

describe("AssignMemberModal", () => {
  beforeEach(() => {
    mockMutateAsync.mockReset();
    mockMutateAsync.mockResolvedValue({});
    mockUsersList.mockReset();
    mockUsersList.mockImplementation(({ role }: { role: "annotator" | "reviewer" }) =>
      Promise.resolve(USERS[role]),
    );
    mockPushToast.mockReset();
  });

  it("adds multiple annotators from the unified entry", async () => {
    renderModal();

    expect(await screen.findByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
    expect(screen.queryByText("Existing")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("Alice"));
    fireEvent.click(screen.getByText("Bob"));
    fireEvent.click(screen.getByRole("button", { name: /确认指派 2 人/ }));

    await waitFor(() => expect(mockMutateAsync).toHaveBeenCalledTimes(2));
    expect(mockMutateAsync).toHaveBeenNthCalledWith(1, {
      user_id: "u1",
      role: "annotator",
    });
    expect(mockMutateAsync).toHaveBeenNthCalledWith(2, {
      user_id: "u2",
      role: "annotator",
    });
  });

  it("switches role and assigns selected reviewers", async () => {
    renderModal();

    fireEvent.click(screen.getByRole("button", { name: "审核员" }));

    expect(await screen.findByText("Rita")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Rita"));
    fireEvent.click(screen.getByRole("button", { name: /确认指派 1 人/ }));

    await waitFor(() => expect(mockMutateAsync).toHaveBeenCalledTimes(1));
    expect(mockMutateAsync).toHaveBeenCalledWith({
      user_id: "u4",
      role: "reviewer",
    });
  });
});
