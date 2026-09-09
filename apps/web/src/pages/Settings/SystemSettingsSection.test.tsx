import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SystemSettingsResponse } from "@/api/settings";
import { ApiError } from "@/api/client";
import { bytesToGib, gibToBytes, SystemSettingsSection } from "./SystemSettingsSection";

const pushToast = vi.fn();
const mockUseSystemSettings = vi.fn();
const mockUpdate = { mutate: vi.fn(), isPending: false };
const mockReset = { mutate: vi.fn(), isPending: false };
const mockTest = { mutate: vi.fn(), isPending: false };

vi.mock("@/hooks/useSystemSettings", () => ({
  useSystemSettings: () => mockUseSystemSettings(),
  useUpdateSystemSettings: () => mockUpdate,
  useResetSystemSettings: () => mockReset,
  useTestSmtp: () => mockTest,
}));

vi.mock("@/components/ui/Toast", () => ({
  useToastStore: <T,>(selector: (state: { push: typeof pushToast }) => T) =>
    selector({ push: pushToast }),
}));

const metadata = {
  source: "deployment" as const,
  deployment_default: 0,
  updated_at: null,
  updated_by: null,
  value_type: "int",
  unit: "个",
  effect: "下一次请求读取",
  min_value: 0,
  max_value: 2000,
  in_range: true,
};

function response(overrides: Partial<SystemSettingsResponse> = {}): SystemSettingsResponse {
  return {
    version: "v1",
    environment: "development",
    allow_open_registration: false,
    invitation_ttl_days: 7,
    max_invitations_per_day: 30,
    offline_threshold_minutes: 5,
    frontend_base_url: "http://localhost:5173",
    dataset_import_max_files: 50000,
    dataset_import_max_total_bytes: 1610612737,
    task_create_sync_threshold: 0,
    video_chunk_warmup_lookahead: 1,
    smtp: {
      host: "smtp.example.com",
      port: 587,
      user: "mailer",
      from_address: "noreply@example.com",
      password_set: true,
      configured: true,
    },
    metadata: {
      task_create_sync_threshold: metadata,
      dataset_import_max_total_bytes: {
        ...metadata,
        deployment_default: 1610612737,
        value_type: "bytes",
        unit: "bytes",
        min_value: 1,
        max_value: 1099511627776,
      },
    },
    ...overrides,
  };
}

function renderSettings(data = response(), refetch = vi.fn().mockResolvedValue({ data })) {
  mockUseSystemSettings.mockReturnValue({ data, isLoading: false, error: null, refetch });
  return render(<SystemSettingsSection />);
}

describe("SystemSettingsSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdate.isPending = false;
    mockReset.isPending = false;
    mockTest.isPending = false;
  });

  it("GiB conversion round-trips arbitrary byte counts exactly", () => {
    const bytes = 1610612737;
    const gib = bytesToGib(bytes);
    expect(gib).toBe("1.500000000931322574615478515625");
    expect(gibToBytes(gib)).toBe(bytes);
    expect(gibToBytes("0")).toBe(0);
  });

  it("submits a legitimate zero instead of treating it as missing", () => {
    renderSettings();
    const input = screen.getByLabelText("视频向后预热块数");
    fireEvent.change(input, { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "保存视频体验" }));

    expect(mockUpdate.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ video_chunk_warmup_lookahead: 0, expected_version: "v1" }),
      expect.any(Object),
    );
  });

  it("keeps a dirty draft when refreshed data arrives", async () => {
    const first = response();
    const second = response({ version: "v2", video_chunk_warmup_lookahead: 4 });
    const refetch = vi.fn().mockResolvedValue({ data: second });
    const view = renderSettings(first, refetch);
    const input = screen.getByLabelText("视频向后预热块数");
    fireEvent.change(input, { target: { value: "3" } });

    mockUseSystemSettings.mockReturnValue({ data: second, isLoading: false, error: null, refetch });
    view.rerender(<SystemSettingsSection />);

    await waitFor(() => expect(screen.getByLabelText("视频向后预热块数")).toHaveValue(3));
    expect(screen.getByText("4 个块")).toBeInTheDocument();
  });

  it("retains a draft and shows the latest readback after a 409", async () => {
    const latest = response({ version: "v2", video_chunk_warmup_lookahead: 5 });
    const refetch = vi.fn().mockResolvedValue({ data: latest });
    renderSettings(response(), refetch);
    const input = screen.getByLabelText("视频向后预热块数");
    fireEvent.change(input, { target: { value: "0" } });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "保存视频体验" })).not.toBeDisabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "保存视频体验" }));

    const options = mockUpdate.mutate.mock.calls[0][1] as {
      onError: (error: unknown) => Promise<void>;
    };
    await act(async () => {
      await options.onError(new ApiError(409, "配置版本冲突", { latest }));
    });

    expect(screen.getByLabelText("视频向后预热块数")).toHaveValue(0);
    expect(screen.getByText(/最新服务器值已显示/)).toBeInTheDocument();
    expect(refetch).toHaveBeenCalled();
  });

  it("does not test dirty SMTP drafts and sends an explicit clear command", () => {
    renderSettings();
    const host = screen.getByLabelText("主机");
    fireEvent.change(host, { target: { value: "smtp.changed.example.com" } });
    expect(screen.getByRole("button", { name: "先保存后测试邮件" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "清除密码" }));
    fireEvent.click(screen.getByRole("button", { name: "保存邮件与访问地址" }));
    expect(mockUpdate.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ smtp_host: "smtp.changed.example.com", smtp_password: "" }),
      expect.any(Object),
    );
  });

  it("restores one key through reset with the current optimistic version", () => {
    renderSettings();
    fireEvent.click(screen.getAllByRole("button", { name: "恢复部署默认" })[0]);
    expect(mockReset.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ keys: ["allow_open_registration"], expected_version: "v1" }),
      expect.any(Object),
    );
  });
});
