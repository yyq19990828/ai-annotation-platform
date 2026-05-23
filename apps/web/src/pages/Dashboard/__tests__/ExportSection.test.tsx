/**
 * ExportSection 关键交互单测。
 *
 * 覆盖 ROADMAP 列出的：勾掉 includeAttributes → 调用 projectsApi.exportProject 时
 * 第三参数 includeAttributes=false。用 vi.mock 拦截 api 模块，断言入参。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ExportSection } from "../ExportSection";

vi.mock("@/api/projects", () => ({
  projectsApi: {
    exportProject: vi.fn(async () => undefined),
  },
}));

import { projectsApi } from "@/api/projects";

function openExportModal() {
  fireEvent.click(screen.getByRole("button", { name: "导出" }));
}

function submitExport() {
  fireEvent.click(screen.getByRole("button", { name: "开始导出" }));
}

describe("ExportSection", () => {
  beforeEach(() => {
    vi.mocked(projectsApi.exportProject).mockClear();
  });

  it("默认勾选 → 调用时 includeAttributes=true", async () => {
    render(<ExportSection projectId="p1" />);
    openExportModal();
    submitExport();
    await waitFor(() => expect(projectsApi.exportProject).toHaveBeenCalled());
    expect(projectsApi.exportProject).toHaveBeenCalledWith("p1", "coco", {
      includeAttributes: true,
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("勾掉 includeAttributes → 入参 false", async () => {
    render(<ExportSection projectId="p1" />);
    openExportModal();
    const cb = screen.getByLabelText("包含属性数据") as HTMLInputElement;
    expect(cb.checked).toBe(true);
    fireEvent.click(cb);
    expect(cb.checked).toBe(false);
    submitExport();
    await waitFor(() => expect(projectsApi.exportProject).toHaveBeenCalled());
    expect(projectsApi.exportProject).toHaveBeenCalledWith("p1", "coco", {
      includeAttributes: false,
    });
  });

  it("切换格式 → 入参跟随", async () => {
    render(<ExportSection projectId="p2" />);
    openExportModal();
    fireEvent.click(screen.getByRole("button", { name: /YOLO/ }));
    submitExport();
    await waitFor(() => expect(projectsApi.exportProject).toHaveBeenCalled());
    expect(projectsApi.exportProject).toHaveBeenCalledWith("p2", "yolo", {
      includeAttributes: true,
    });
  });

  it("视频项目展示视频导出格式并传递 Video JSON frame mode", async () => {
    render(<ExportSection projectId="p3" projectTypeKey="video-track" />);
    openExportModal();

    expect(screen.getByText("Video JSON")).toBeInTheDocument();
    expect(screen.getByText("AAP JSON")).toBeInTheDocument();
    expect(screen.getByText("MOT")).toBeInTheDocument();
    expect(screen.getByText("KITTI")).toBeInTheDocument();
    expect(screen.queryByText("YOLO")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^所有帧/ }));
    submitExport();
    await waitFor(() => expect(projectsApi.exportProject).toHaveBeenCalled());
    expect(projectsApi.exportProject).toHaveBeenCalledWith("p3", "video_json", {
      includeAttributes: true,
      videoFrameMode: "all_frames",
    });
  });
});
