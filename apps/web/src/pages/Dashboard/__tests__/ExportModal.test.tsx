/**
 * ExportModal 关键交互单测（前身 ExportSection.test.tsx）。
 * v0.10.43 · 多目标导出：targets 数组入参 + 多选切换。
 * B-47 后导出入口收进 ⋮ 菜单，独立包装器 ExportSection 已删除；
 * 表单逻辑（目标多选 / 属性开关 / 视频帧模式）改为直接渲染 ExportModal 验证。
 *
 * 覆盖：includeAttributes 默认 true / 勾掉为 false；目标多选；视频帧模式透传。
 * 用 vi.mock 拦截 api 模块，断言入参。
 */
import { useState } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ExportModal } from "../ExportModal";

vi.mock("@/api/projects", () => ({
  projectsApi: {
    exportProject: vi.fn(async () => ({ job_id: "j1" })),
  },
}));

import { projectsApi } from "@/api/projects";

// 受控 harness：导出完成回调把 open 置 false，便于断言弹窗关闭。
function ExportModalHarness({
  projectId,
  projectTypeKey,
}: {
  projectId: string;
  projectTypeKey?: string;
}) {
  const [open, setOpen] = useState(true);
  return (
    <ExportModal
      open={open}
      onClose={() => setOpen(false)}
      projectId={projectId}
      projectTypeKey={projectTypeKey}
    />
  );
}

function submitExport() {
  fireEvent.click(screen.getByRole("button", { name: "开始导出" }));
}

describe("ExportModal", () => {
  beforeEach(() => {
    vi.mocked(projectsApi.exportProject).mockClear();
  });

  it("默认 coco + 勾选 → targets=[coco], includeAttributes=true", async () => {
    render(<ExportModalHarness projectId="p1" />);
    submitExport();
    await waitFor(() => expect(projectsApi.exportProject).toHaveBeenCalled());
    expect(projectsApi.exportProject).toHaveBeenCalledWith("p1", ["coco"], {
      includeAttributes: true,
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("勾掉 includeAttributes → 入参 false", async () => {
    render(<ExportModalHarness projectId="p1" />);
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
    render(<ExportModalHarness projectId="p2" />);
    fireEvent.click(screen.getByText("YOLO")); // 展开分组
    fireEvent.click(screen.getByText("分割"));
    submitExport();
    await waitFor(() => expect(projectsApi.exportProject).toHaveBeenCalled());
    expect(projectsApi.exportProject).toHaveBeenCalledWith("p2", ["coco", "yolo-seg"], {
      includeAttributes: true,
    });
  });

  it("取消默认 coco 改选 YOLO 旋转框 → targets=[yolo-obb]", async () => {
    render(<ExportModalHarness projectId="p2b" />);
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
    render(<ExportModalHarness projectId="p3" projectTypeKey="video-track" />);

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
    render(<ExportModalHarness projectId="p4" projectTypeKey="video-track" />);

    fireEvent.click(screen.getByText("Video JSON"));
    fireEvent.click(screen.getByText("YOLO 逐帧"));
    submitExport();
    await waitFor(() => expect(projectsApi.exportProject).toHaveBeenCalled());
    expect(projectsApi.exportProject).toHaveBeenCalledWith("p4", ["yolo-frames-det"], {
      includeAttributes: true,
    });
  });

  it("视频项目可单独导出 YOLO 逐帧分割集", async () => {
    render(<ExportModalHarness projectId="p4b" projectTypeKey="video-track" />);

    expect(screen.getByText("YOLO 逐帧分割")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Video JSON")); // 取消默认 video_json
    fireEvent.click(screen.getByText("YOLO 逐帧分割"));
    submitExport();
    await waitFor(() => expect(projectsApi.exportProject).toHaveBeenCalled());
    expect(projectsApi.exportProject).toHaveBeenCalledWith("p4b", ["yolo-frames-seg"], {
      includeAttributes: true,
    });
  });

  it("视频项目可同选 YOLO 逐帧检测 + 分割，互不覆盖", async () => {
    render(<ExportModalHarness projectId="p4c" projectTypeKey="video-track" />);

    fireEvent.click(screen.getByText("Video JSON")); // 取消默认 video_json
    fireEvent.click(screen.getByText("YOLO 逐帧"));
    fireEvent.click(screen.getByText("YOLO 逐帧分割"));
    submitExport();
    await waitFor(() => expect(projectsApi.exportProject).toHaveBeenCalled());
    expect(projectsApi.exportProject).toHaveBeenCalledWith(
      "p4c",
      ["yolo-frames-det", "yolo-frames-seg"],
      { includeAttributes: true },
    );
  });

  it("视频项目可单独导出 COCO 逐帧分割集", async () => {
    render(<ExportModalHarness projectId="p6" projectTypeKey="video-track" />);

    expect(screen.getByText("COCO 逐帧分割")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Video JSON")); // 取消默认 video_json
    fireEvent.click(screen.getByText("COCO 逐帧分割"));
    submitExport();
    await waitFor(() => expect(projectsApi.exportProject).toHaveBeenCalled());
    expect(projectsApi.exportProject).toHaveBeenCalledWith("p6", ["coco-frames-seg"], {
      includeAttributes: true,
    });
  });

  it("视频项目可同选 YOLO 逐帧分割 + COCO 逐帧分割，互不覆盖", async () => {
    render(<ExportModalHarness projectId="p7" projectTypeKey="video-track" />);

    fireEvent.click(screen.getByText("Video JSON")); // 取消默认 video_json
    fireEvent.click(screen.getByText("YOLO 逐帧分割"));
    fireEvent.click(screen.getByText("COCO 逐帧分割"));
    submitExport();
    await waitFor(() => expect(projectsApi.exportProject).toHaveBeenCalled());
    expect(projectsApi.exportProject).toHaveBeenCalledWith(
      "p7",
      ["yolo-frames-seg", "coco-frames-seg"],
      { includeAttributes: true },
    );
  });

  it("点云项目展示标准 3D 目标并默认导出 AAP JSON", async () => {
    render(<ExportModalHarness projectId="p5" projectTypeKey="lidar" />);

    expect(screen.getByText("KITTI 3D")).toBeInTheDocument();
    expect(screen.getByText("nuScenes JSON")).toBeInTheDocument();
    expect(screen.getByText("Point Mask")).toBeInTheDocument();
    expect(screen.queryByText("COCO")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("KITTI 3D"));
    fireEvent.click(screen.getByText("nuScenes JSON"));
    fireEvent.click(screen.getByText("Point Mask"));
    submitExport();
    await waitFor(() => expect(projectsApi.exportProject).toHaveBeenCalled());
    expect(projectsApi.exportProject).toHaveBeenCalledWith(
      "p5",
      ["aap_json", "kitti", "nuscenes", "pointmask"],
      { includeAttributes: true },
    );
  });
});
