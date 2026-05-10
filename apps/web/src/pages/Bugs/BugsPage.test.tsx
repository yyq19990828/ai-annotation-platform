import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BugsPage } from "./BugsPage";

const mocks = vi.hoisted(() => ({
  pushToast: vi.fn(),
  list: vi.fn(),
  get: vi.fn(),
}));

vi.mock("@/components/ui/Toast", () => ({
  useToastStore: <T,>(selector: (s: { push: typeof mocks.pushToast }) => T) => selector({ push: mocks.pushToast }),
}));

vi.mock("@/api/bug-reports", () => ({
  bugReportsApi: {
    list: mocks.list,
    get: mocks.get,
    update: vi.fn(),
    addComment: vi.fn(),
    attachmentDownloadUrl: (_id: string, key: string) => `/download?key=${encodeURIComponent(key)}`,
  },
}));

const item = {
  id: "bug-1",
  display_id: "B-1",
  reporter_id: "u1",
  route: "/dashboard",
  user_role: "annotator",
  project_id: null,
  task_id: null,
  title: "Markdown detail",
  description: "**粗体描述**",
  severity: "medium",
  status: "new",
  duplicate_of_id: null,
  browser_ua: null,
  viewport: "1440x900",
  recent_api_calls: null,
  recent_console_errors: null,
  screenshot_url: null,
  attachments: [
    {
      storageKey: "bug-report-attachments/u1/a.png",
      fileName: "a.png",
      mimeType: "image/png",
      size: 2048,
    },
  ],
  resolution: null,
  fixed_in_version: null,
  assigned_to_id: null,
  created_at: "2026-05-10T00:00:00Z",
  triaged_at: null,
  fixed_at: null,
  reopen_count: 0,
  last_reopened_at: null,
};

describe("BugsPage", () => {
  beforeEach(() => {
    mocks.pushToast.mockReset();
    mocks.list.mockResolvedValue({ items: [item], total: 1 });
    mocks.get.mockResolvedValue({
      ...item,
      comments: [
        {
          id: "c1",
          bug_report_id: "bug-1",
          author_id: "u2",
          author_name: "Admin",
          author_role: "super_admin",
          body: "- 已复现",
          created_at: "2026-05-10T01:00:00Z",
        },
      ],
    });
  });

  it("renders markdown descriptions, markdown comments, and attachment links", async () => {
    render(<BugsPage />);

    fireEvent.click(await screen.findByText("Markdown detail"));

    await waitFor(() => expect(mocks.get).toHaveBeenCalledWith("bug-1"));
    expect(screen.getByText("粗体描述").tagName).toBe("STRONG");
    expect(screen.getByText("已复现")).toBeInTheDocument();
    expect(screen.getByText("a.png").closest("a")).toHaveAttribute(
      "href",
      "/download?key=bug-report-attachments%2Fu1%2Fa.png",
    );
  });
});
