import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BugReportDrawer } from "./BugReportDrawer";

const mocks = vi.hoisted(() => ({
  pushToast: vi.fn(),
  listMine: vi.fn(),
  get: vi.fn(),
  create: vi.fn(),
}));

vi.mock("@/components/ui/Toast", () => ({
  useToastStore: <T,>(selector: (s: { push: typeof mocks.pushToast }) => T) => selector({ push: mocks.pushToast }),
}));

vi.mock("@/utils/bugReportCapture", () => ({
  getRecentApiCalls: () => [],
  getRecentConsoleErrors: () => [],
  sanitizeApiCalls: (calls: unknown[]) => calls,
  captureScreenshot: vi.fn(),
}));

vi.mock("@/api/bug-reports", () => ({
  bugReportsApi: {
    listMine: mocks.listMine,
    get: mocks.get,
    create: mocks.create,
    update: vi.fn(),
    delete: vi.fn(),
    addComment: vi.fn(),
    attachmentDownloadUrl: (_id: string, key: string) => `/download?key=${encodeURIComponent(key)}`,
  },
  uploadBugAttachment: vi.fn(),
}));

describe("BugReportDrawer", () => {
  beforeEach(() => {
    mocks.pushToast.mockClear();
    mocks.listMine.mockResolvedValue({ items: [], total: 0 });
    mocks.get.mockReset();
    mocks.create.mockReset();
    mocks.create.mockResolvedValue({});
    delete (window as unknown as { __videoWorkbenchDiagnostics?: unknown }).__videoWorkbenchDiagnostics;
    delete (window as unknown as { __videoFrameClockDiagnostics?: unknown }).__videoFrameClockDiagnostics;
  });

  it("adds pasted clipboard screenshots and allows removing them", async () => {
    render(<BugReportDrawer open onClose={() => {}} />);

    await screen.findByText("暂无反馈");
    fireEvent.click(screen.getByText("提交新反馈"));
    const textarea = screen.getByPlaceholderText("详细描述问题...");
    const file = new File(["image"], "clip.png", { type: "image/png" });

    fireEvent.paste(textarea, {
      clipboardData: {
        files: [file],
      },
    });

    expect(await screen.findByText(/图 1/)).toBeInTheDocument();
    expect(screen.getByText(/clip\.png/)).toBeInTheDocument();

    fireEvent.click(screen.getByText("移除"));

    expect(screen.queryByText(/clip\.png/)).not.toBeInTheDocument();
  });

  it("rejects oversized pasted screenshots", async () => {
    render(<BugReportDrawer open onClose={() => {}} />);

    await screen.findByText("暂无反馈");
    fireEvent.click(screen.getByText("提交新反馈"));
    const textarea = screen.getByPlaceholderText("详细描述问题...");
    const largeFile = new File(["x"], "large.png", { type: "image/png" });
    Object.defineProperty(largeFile, "size", { value: 10 * 1024 * 1024 + 1 });

    fireEvent.paste(textarea, {
      clipboardData: {
        files: [largeFile],
      },
    });

    expect(mocks.pushToast).toHaveBeenCalledWith({ msg: "截图超过 10MB", kind: "error" });
  });

  it("attaches active video workbench diagnostics to new reports", async () => {
    (window as unknown as { __videoWorkbenchDiagnostics?: unknown }).__videoWorkbenchDiagnostics = {
      activeTaskId: "11111111-1111-4111-8111-111111111111",
      byTask: {
        "11111111-1111-4111-8111-111111111111": {
          taskId: "11111111-1111-4111-8111-111111111111",
          frameIndex: 42,
          timelineMode: "selected-track",
          frameClock: { recentSeeks: [{ frameIndex: 42, ms: 18, source: "rvfc" }] },
          framePreview: { cacheHits: 2, cacheMisses: 1 },
        },
      },
    };

    render(<BugReportDrawer open onClose={() => {}} />);

    await screen.findByText("暂无反馈");
    fireEvent.click(screen.getByText("提交新反馈"));
    fireEvent.change(screen.getByPlaceholderText("发生了什么问题？"), { target: { value: "视频 seek 卡顿" } });
    fireEvent.change(screen.getByPlaceholderText("详细描述问题..."), { target: { value: "拖动时间轴后首帧很慢" } });
    fireEvent.click(screen.getByRole("button", { name: "提交反馈" }));

    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1));
    const payload = mocks.create.mock.calls[0][0];
    expect(payload.task_id).toBe("11111111-1111-4111-8111-111111111111");
    expect(payload.description).toContain("Video Workbench Diagnostics");
    expect(payload.description).toContain('"frameIndex": 42');
    expect(payload.recent_console_errors[0].msg).toBe("[video-workbench-diagnostics]");
    expect(payload.recent_console_errors[0].stack).toContain('"timelineMode": "selected-track"');
  });
});
