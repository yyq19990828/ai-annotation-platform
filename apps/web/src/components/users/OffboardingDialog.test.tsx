import { describe, expect, it, beforeEach, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import type { OffboardingPreview, OffboardingResult, UserResponse } from "@/api/users";

const mockRefetch = vi.fn();
const mockMutateAsync = vi.fn();
const mockMutationReset = vi.fn();
const mockReactivateMutateAsync = vi.fn();
const mockReactivateReset = vi.fn();
const mockPushToast = vi.fn();

let previewQuery: {
  data: OffboardingPreview | undefined;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  isFetching: boolean;
  refetch: typeof mockRefetch;
};

vi.mock("@/hooks/useUsers", () => ({
  useOffboardingPreview: () => previewQuery,
  useOffboardUser: () => ({
    mutateAsync: mockMutateAsync,
    isPending: false,
    reset: mockMutationReset,
  }),
  useReactivateUser: () => ({
    mutateAsync: mockReactivateMutateAsync,
    isPending: false,
    reset: mockReactivateReset,
  }),
}));

vi.mock("@/components/ui/Toast", () => ({
  useToastStore: <T,>(selector: (state: { push: typeof mockPushToast }) => T) =>
    selector({ push: mockPushToast }),
}));

import { OffboardingDialog, ReactivateDialog } from "./OffboardingDialog";

const USER = {
  id: "user-1",
  name: "离职成员",
  email: "leaver@example.com",
  role: "annotator",
  group_name: null,
  group_id: null,
  status: "online",
  is_active: true,
  created_at: "2026-01-01T00:00:00Z",
} as UserResponse;

const PREVIEW: OffboardingPreview = {
  user: USER,
  preview_version: "version-1",
  generated_at: "2026-09-09T01:00:00Z",
  can_commit: true,
  blockers: [],
  projects: [
    {
      project_id: "project-1",
      project_name: "城市道路项目",
      blockers: [],
      roles: {
        owner: {
          present: true,
          batches: [],
          receiver_options: [
            {
              id: "receiver-owner",
              name: "项目负责人",
              email: "owner@example.com",
              role: "project_admin",
              project_member_role: "owner",
            },
          ],
        },
        annotator: {
          present: true,
          batches: [{ batch_id: "batch-1", batch_name: "第一批" }],
          receiver_options: [
            {
              id: "receiver-annotator",
              name: "接收标注",
              email: "annotator@example.com",
              role: "annotator",
              project_member_role: "annotator",
            },
          ],
        },
        reviewer: { present: false, batches: [], receiver_options: [] },
      },
      tasks: {
        annotator: { pending: 2, in_progress: 1, review: 1, rejected: 0, locked: 1 },
      },
    },
  ],
  api_keys: [
    {
      id: "key-1",
      name: "自动导入",
      key_prefix: "ak_live_abc",
      last_used_at: "2026-09-08T10:00:00Z",
      revoked_at: null,
    },
  ],
};

function renderDialog(preview = PREVIEW) {
  previewQuery.data = preview;
  return render(<OffboardingDialog open user={USER} onClose={vi.fn()} />);
}

describe("OffboardingDialog", () => {
  beforeEach(() => {
    mockRefetch.mockReset();
    mockMutateAsync.mockReset();
    mockMutationReset.mockReset();
    mockReactivateMutateAsync.mockReset();
    mockReactivateReset.mockReset();
    mockPushToast.mockReset();
    previewQuery = {
      data: PREVIEW,
      isLoading: false,
      isError: false,
      error: null,
      isFetching: false,
      refetch: mockRefetch,
    };
  });

  it("展示项目批次、任务锁和 API Key，并只允许选择预览中的接收人", () => {
    renderDialog();

    expect(screen.getByText("城市道路项目")).toBeInTheDocument();
    expect(screen.getByText("第一批")).toBeInTheDocument();
    expect(screen.getByText("锁定")).toBeInTheDocument();
    expect(screen.getByText("自动导入")).toBeInTheDocument();
    expect(screen.getByText("ak_live_abc")).toBeInTheDocument();

    const ownerSelect = screen.getByLabelText("城市道路项目 项目负责人接收人");
    expect(ownerSelect).toHaveValue("");
    expect(screen.getByRole("button", { name: "确认交接并停用" })).toBeDisabled();

    fireEvent.change(ownerSelect, { target: { value: "receiver-owner" } });
    fireEvent.change(screen.getByLabelText("城市道路项目 标注员接收人"), {
      target: { value: "receiver-annotator" },
    });
    expect(screen.getByRole("button", { name: "确认交接并停用" })).toBeEnabled();
  });

  it("紧急停用不要求接收人，并保留服务器返回的未交接清单", async () => {
    const blockedPreview = {
      ...PREVIEW,
      can_commit: false,
      blockers: [{ code: "no_receiver", message: "没有合格接收人" }],
      projects: PREVIEW.projects.map((project) => ({
        ...project,
        roles: {
          ...project.roles,
          owner: { ...project.roles.owner, receiver_options: [] },
          annotator: { ...project.roles.annotator, receiver_options: [] },
        },
      })),
    };
    const result: OffboardingResult = {
      user: { ...USER, is_active: false, disabled_kind: "emergency_suspended" },
      status: "suspended",
      mode: "emergency_suspend",
      transfers: [],
      unresolved: [
        {
          project_id: "project-1",
          role: "annotator",
          reason: "emergency_suspension_requires_later_handoff",
          batch_ids: ["batch-1"],
          task_count: 2,
          lock_count: 1,
        },
      ],
      revoked_api_key_ids: ["key-1"],
      audit_id: 42,
    };
    mockMutateAsync.mockResolvedValue(result);
    renderDialog(blockedPreview);

    fireEvent.click(screen.getByRole("button", { name: /紧急停用/ }));
    const submit = screen.getByRole("button", { name: "确认紧急停用" });
    expect(submit).toBeEnabled();
    fireEvent.click(submit);

    await waitFor(() => expect(mockMutateAsync).toHaveBeenCalledTimes(1));
    expect(mockMutateAsync.mock.calls[0][0].payload).toMatchObject({
      mode: "emergency_suspend",
      preview_version: "version-1",
      projects: [{ project_id: "project-1" }],
    });
    expect(await screen.findByText("账号已紧急停用")).toBeInTheDocument();
    expect(screen.getByText("待后续交接的责任")).toBeInTheDocument();
    expect(screen.getByText(/2 个任务 · 1 个锁/)).toBeInTheDocument();
  });

  it("提交遇到 409 会刷新预览并清空旧接收人选择", async () => {
    mockMutateAsync.mockRejectedValue({
      status: 409,
      detailRaw: { code: "offboarding_preview_stale" },
      message: "预览已过期",
    });
    renderDialog();
    fireEvent.change(screen.getByLabelText("城市道路项目 项目负责人接收人"), {
      target: { value: "receiver-owner" },
    });
    fireEvent.change(screen.getByLabelText("城市道路项目 标注员接收人"), {
      target: { value: "receiver-annotator" },
    });
    fireEvent.click(screen.getByRole("button", { name: "确认交接并停用" }));

    await waitFor(() => expect(mockRefetch).toHaveBeenCalledTimes(1));
    expect(screen.getByText(/旧接收人选择已清空/)).toBeInTheDocument();
    expect(screen.getByLabelText("城市道路项目 项目负责人接收人")).toHaveValue("");
  });
});

describe("ReactivateDialog", () => {
  beforeEach(() => {
    mockReactivateMutateAsync.mockReset();
    mockReactivateReset.mockReset();
    mockPushToast.mockReset();
  });

  it("只允许恢复 suspended/emergency_suspended，并明确工作与密钥不会恢复", () => {
    const deleted = { ...USER, is_active: false, disabled_kind: "deleted" } as UserResponse;
    const { rerender } = render(<ReactivateDialog open user={deleted} onClose={vi.fn()} />);
    expect(screen.getByText(/已删除或历史未知状态不能恢复/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "确认恢复账号" })).toBeDisabled();

    const suspended = {
      ...USER,
      is_active: false,
      disabled_kind: "emergency_suspended",
      disabled_reason: "账号疑似泄露",
      disabled_at: "2026-09-08T10:00:00Z",
    } as UserResponse;
    rerender(<ReactivateDialog open user={suspended} onClose={vi.fn()} />);
    expect(screen.getByText(/已转交的项目、批次和任务不会转回/)).toBeInTheDocument();
    expect(screen.getByText(/吊销的 API Key 也不会恢复/)).toBeInTheDocument();
  });
});
