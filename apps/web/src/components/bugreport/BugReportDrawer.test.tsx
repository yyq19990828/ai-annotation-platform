import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BugReportDrawer } from "./BugReportDrawer";

const mocks = vi.hoisted(() => ({
  pushToast: vi.fn(),
  listMine: vi.fn(),
  get: vi.fn(),
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
    create: vi.fn(),
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
});
