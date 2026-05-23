/**
 * ExportSection 关键交互单测。
 * v0.10.43 · 多目标导出：targets 数组入参 + 多选切换。
 *
 * 覆盖：includeAttributes 默认 true / 勾掉为 false；目标多选；视频帧模式透传。
 * 用 vi.mock 拦截 api 模块，断言入参。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ExportSection } from "../ExportSection";

vi.mock("@/api/projects", () => ({
  projectsApi: {
    exportProject: vi.fn(async () => ({ job_id: "j1" })),
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

  it("默认 coco + 勾选 → targets=[coco], includeAttributes=true", async () => {
    render(<ExportSection projectId="p1" />);
    openExportModal();
    submitExport();
    await waitFor(() => expect(projectsApi.exportProject).toHaveBeenCalled());
    expect(projectsApi.exportProject).toHaveBeenCalledWith("p1", ["coco"], {
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
    expect(projectsApi.exportProject).toHaveBeenCalledWith("p1", ["coco"], {
      includeAttributes: false,
    });
  });

  it("多选 coco + 展开 YOLO 选分割 → targets 含两者", async () => {
    render(<ExportSection projectId="p2" />);
    openExportModal();
    fireEvent.click(screen.getByText("YOLO")); // 展开分组
    fireEvent.click(screen.getByText("分割"));
    submitExport();
    await waitFor(() => expect(projectsApi.exportProject).toHaveBeenCalled());
    expect(projectsApi.exportProject).toHaveBeenCalledWith("p2", ["coco", "yolo-seg"], {
      includeAttributes: true,
    });
  });

  it("取消默认 coco 改选 YOLO 旋转框 → targets=[yolo-obb]", async () => {
    render(<ExportSection projectId="p2b" />);
    openExportModal();
    fireEvent.click(screen.getByText("COCO")); // 取消默认 coco
    fireEvent.click(screen.getByText("YOLO")); // 展开分组
    fireEvent.click(screen.getByText("旋转框"));
    submitExport();
    await waitFor(() => expect(projectsApi.exportProject).toHaveBeenCalled());
    expect(projectsApi.exportProject).toHaveBeenCalledWith("p2b", ["yolo-obb"], {
      includeAttributes: true,
    });
  });

  it("视频项目展示视频目标并传递 Video JSON frame mode", async () => {
    render(<ExportSection projectId="p3" projectTypeKey="video-track" />);
    openExportModal();

    expect(screen.getByText("Video JSON")).toBeInTheDocument();
    expect(screen.getByText("YOLO 逐帧")).toBeInTheDocument();
    expect(screen.getByText("MOT")).toBeInTheDocument();
    expect(screen.getByText("KITTI")).toBeInTheDocument();
    expect(screen.queryByText("YOLO")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("所有帧"));
    submitExport();
    await waitFor(() => expect(projectsApi.exportProject).toHaveBeenCalled());
    expect(projectsApi.exportProject).toHaveBeenCalledWith("p3", ["video_json"], {
      includeAttributes: true,
      videoFrameMode: "all_frames",
    });
  });

  it("视频项目可单独导出 YOLO 逐帧检测集", async () => {
    render(<ExportSection projectId="p4" projectTypeKey="video-track" />);
    openExportModal();

    fireEvent.click(screen.getByText("Video JSON"));
    fireEvent.click(screen.getByText("YOLO 逐帧"));
    submitExport();
    await waitFor(() => expect(projectsApi.exportProject).toHaveBeenCalled());
    expect(projectsApi.exportProject).toHaveBeenCalledWith("p4", ["yolo-frames-det"], {
      includeAttributes: true,
    });
  });
});
