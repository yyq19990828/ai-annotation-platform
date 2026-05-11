/**
 * v0.6.6 · ExportSection 关键交互单测。
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

describe("ExportSection", () => {
  beforeEach(() => {
    (projectsApi.exportProject as any).mockClear();
  });

  it("默认勾选 → 调用时 includeAttributes=true", async () => {
    render(<ExportSection projectId="p1" />);
    fireEvent.click(screen.getByText("导出 ▾"));
    fireEvent.click(screen.getByText("导出"));
    await waitFor(() => expect(projectsApi.exportProject).toHaveBeenCalled());
    expect(projectsApi.exportProject).toHaveBeenCalledWith("p1", "coco", {
      includeAttributes: true,
    });
  });

  it("勾掉 includeAttributes → 入参 false", async () => {
    render(<ExportSection projectId="p1" />);
    fireEvent.click(screen.getByText("导出 ▾"));
    const cb = screen.getByLabelText("包含属性数据") as HTMLInputElement;
    expect(cb.checked).toBe(true);
    fireEvent.click(cb);
    expect(cb.checked).toBe(false);
    fireEvent.click(screen.getByText("导出"));
    await waitFor(() => expect(projectsApi.exportProject).toHaveBeenCalled());
    expect(projectsApi.exportProject).toHaveBeenCalledWith("p1", "coco", {
      includeAttributes: false,
    });
  });

  it("切换格式 → 入参跟随", async () => {
    render(<ExportSection projectId="p2" />);
    fireEvent.click(screen.getByText("导出 ▾"));
    fireEvent.click(screen.getByText("YOLO"));
    fireEvent.click(screen.getByText("导出"));
    await waitFor(() => expect(projectsApi.exportProject).toHaveBeenCalled());
    expect(projectsApi.exportProject).toHaveBeenCalledWith("p2", "yolo", {
      includeAttributes: true,
    });
  });

  it("视频项目只展示 Video JSON 并传递 frame mode", async () => {
    render(<ExportSection projectId="p3" projectTypeKey="video-track" />);
    fireEvent.click(screen.getByText("导出 ▾"));

    expect(screen.getByText("Video JSON")).toBeInTheDocument();
    expect(screen.queryByText("YOLO")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("所有帧"));
    fireEvent.click(screen.getByText("导出"));
    await waitFor(() => expect(projectsApi.exportProject).toHaveBeenCalled());
    expect(projectsApi.exportProject).toHaveBeenCalledWith("p3", "coco", {
      includeAttributes: true,
      videoFrameMode: "all_frames",
    });
  });
});
