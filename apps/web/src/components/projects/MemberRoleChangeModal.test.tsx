import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ApiError } from "@/api/client";
import type { ProjectMemberResponse } from "@/api/projects";

const previewState = vi.hoisted(() => ({
  data: null as unknown,
  isPending: false,
  isError: false,
  error: null as unknown,
  mutate: vi.fn(),
}));
const changeState = vi.hoisted(() => ({
  isPending: false,
  isError: false,
  error: null as unknown,
  mutate: vi.fn(),
}));
vi.mock("@/hooks/useProjects", () => ({
  usePreviewProjectMemberRole: () => previewState,
  useChangeProjectMemberRole: () => changeState,
}));

import { MemberRoleChangeModal } from "./MemberRoleChangeModal";

const member: ProjectMemberResponse = {
  id: "m1",
  user_id: "u1",
  user_name: "Alice",
  user_email: "alice@example.com",
  role: "annotator",
  platform_role: "employee",
  version: 2,
  assigned_at: "2026-01-01T00:00:00Z",
};

const basePreview = {
  member_id: "m1",
  user_id: "u1",
  current_role: "annotator" as const,
  current_version: 3,
  target_role: "reviewer" as const,
  requires_handoff: false,
  blockers: [] as string[],
  blocker_details: [],
  resource_snapshot: {},
  preview_token: "token-1",
};

function renderModal() {
  return render(
    <MemberRoleChangeModal
      open
      projectId="p1"
      member={member}
      members={[member]}
      onClose={vi.fn()}
    />,
  );
}

describe("MemberRoleChangeModal", () => {
  beforeEach(() => {
    previewState.data = basePreview;
    previewState.isPending = false;
    previewState.isError = false;
    previewState.error = null;
    previewState.mutate.mockReset();
    changeState.isPending = false;
    changeState.isError = false;
    changeState.error = null;
    changeState.mutate.mockReset();
  });

  it("保存时回传预览版本与 token", () => {
    renderModal();
    fireEvent.change(screen.getByLabelText("目标项目职责"), { target: { value: "reviewer" } });
    fireEvent.change(screen.getByLabelText("变更原因"), { target: { value: "分工调整" } });
    fireEvent.click(screen.getByRole("button", { name: "保存职责" }));
    expect(changeState.mutate).toHaveBeenCalledWith(
      {
        memberId: "m1",
        payload: {
          project_role: "reviewer",
          expected_version: 3,
          preview_token: "token-1",
          reason: "分工调整",
        },
      },
      expect.any(Object),
    );
  });

  it("存在阻塞项时禁止保存", () => {
    previewState.data = { ...basePreview, blockers: ["仍有未完成审核"] };
    renderModal();
    fireEvent.change(screen.getByLabelText("变更原因"), { target: { value: "调整" } });
    expect(screen.getByRole("button", { name: "保存职责" })).toBeDisabled();
    expect(screen.getByText(/存在阻塞项/)).toBeInTheDocument();
  });

  it("过期预览冲突提示重新预览且不静默成功", () => {
    changeState.mutate.mockImplementation((_vars, opts) => {
      opts?.onError?.(new ApiError(409, "stale"));
    });
    renderModal();
    fireEvent.change(screen.getByLabelText("变更原因"), { target: { value: "调整" } });
    fireEvent.click(screen.getByRole("button", { name: "保存职责" }));
    expect(screen.getByRole("alert")).toHaveTextContent("预览已过期");
    expect(screen.getByRole("button", { name: "保存职责" })).toBeDisabled();
  });
});
