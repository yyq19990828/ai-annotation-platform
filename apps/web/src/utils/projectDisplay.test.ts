import { describe, expect, it } from "vitest";
import type { ProjectResponse } from "@/api/projects";
import { projectDisplayType } from "./projectDisplay";

function project(overrides: Partial<ProjectResponse>): ProjectResponse {
  return {
    id: "p1",
    display_id: "P-1",
    name: "Demo",
    type_key: "image-det",
    type_label: "图像 · 目标检测",
    data_type: "image",
    owner_id: "u1",
    owner_name: "Alice",
    member_count: 1,
    status: "in_progress",
    total_tasks: 1,
    completed_tasks: 0,
    review_tasks: 0,
    ai_enabled: false,
    ...overrides,
  } as ProjectResponse;
}

describe("projectDisplayType", () => {
  it("uses media and tool bindings instead of legacy type_label", () => {
    expect(
      projectDisplayType(project({
        tool_bindings: {
          bbox: { enabled: true },
          region: { enabled: true },
        },
      })),
    ).toBe("图片 · 矩形框 / 区域");
  });

  it("falls back from legacy type_key when tool_bindings are absent", () => {
    expect(projectDisplayType(project({}))).toBe("图片 · 矩形框");
  });

  it("describes video bbox subtools with video_modes", () => {
    expect(
      projectDisplayType(project({
        data_type: "video",
        type_key: "video-track",
        type_label: "视频 · 时序追踪",
        tool_bindings: {
          bbox: { enabled: true, video_modes: { box: false, track: true } },
        },
      })),
    ).toBe("视频 · 轨迹框");
  });
});
