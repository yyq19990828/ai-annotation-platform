import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ToolDock } from "./ToolDock";

describe("ToolDock · video tools", () => {
  it("renders video select and creation tools without the retired pan tool", () => {
    render(
      <ToolDock
        tool="select"
        onSetTool={vi.fn()}
        videoMode
        videoTool="select"
        onSetVideoTool={vi.fn()}
      />,
    );

    expect(screen.getByTestId("video-tool-btn-select")).toBeInTheDocument();
    expect(screen.getByTestId("video-tool-btn-box")).toBeInTheDocument();
    expect(screen.getByTestId("video-tool-btn-track")).toBeInTheDocument();
    expect(screen.queryByTestId("video-tool-btn-hand")).toBeNull();
    expect(screen.queryByRole("button", { name: "平移" })).toBeNull();
  });

  it("keeps video select when creation modes are disabled without falling back to hand", () => {
    render(
      <ToolDock
        tool="select"
        onSetTool={vi.fn()}
        videoMode
        videoTool="select"
        onSetVideoTool={vi.fn()}
        isVideoToolEnabled={() => false}
      />,
    );

    expect(screen.getByTestId("video-tool-btn-select")).toBeInTheDocument();
    expect(screen.queryByTestId("video-tool-btn-box")).toBeNull();
    expect(screen.queryByTestId("video-tool-btn-track")).toBeNull();
    expect(screen.queryByTestId("video-tool-btn-polygon")).toBeNull();
    expect(screen.queryByTestId("video-tool-btn-polyline")).toBeNull();
    expect(screen.queryByTestId("video-tool-btn-hand")).toBeNull();
  });
});

// AI 工具三层门控 (ai_interactive 伪单位退役后):
//   1. project.ai_interactive_enabled 关 → 整组隐藏
//   2. 后端不支持该 prompt → 置灰
//   3. 产出几何所属单位未启用 → 隐藏 (smart-* → region, magic-box → bbox)
describe("ToolDock · AI 工具三层门控", () => {
  const AI_TOOL_IDS = ["smart-point", "smart-box", "exemplar", "magic-box"];

  it("默认 (总开关未加载 + 无 tool_bindings) → AI 工具全部显示", () => {
    render(<ToolDock tool="select" onSetTool={vi.fn()} />);
    for (const id of AI_TOOL_IDS) {
      expect(screen.getByTestId(`tool-btn-${id}`)).toBeInTheDocument();
    }
  });

  it("层 1 · 项目总开关关闭 → AI 工具整组隐藏, 绘制工具不受影响", () => {
    render(
      <ToolDock tool="select" onSetTool={vi.fn()} aiInteractiveEnabled={false} />,
    );
    for (const id of AI_TOOL_IDS) {
      expect(screen.queryByTestId(`tool-btn-${id}`)).toBeNull();
    }
    expect(screen.getByTestId("tool-btn-box")).toBeInTheDocument();
    expect(screen.getByTestId("tool-btn-select")).toBeInTheDocument();
  });

  it("层 1 · 总开关开启 → AI 工具恢复显示", () => {
    render(
      <ToolDock tool="select" onSetTool={vi.fn()} aiInteractiveEnabled={true} />,
    );
    for (const id of AI_TOOL_IDS) {
      expect(screen.getByTestId(`tool-btn-${id}`)).toBeInTheDocument();
    }
  });

  it("层 2 · 后端不支持该 prompt → 置灰而非隐藏", () => {
    render(
      <ToolDock
        tool="select"
        onSetTool={vi.fn()}
        isPromptSupported={(p) => p !== "point"}
      />,
    );
    // smart-point 要求 point prompt → 置灰但仍在栏内
    const smartPoint = screen.getByTestId("tool-btn-smart-point");
    expect(smartPoint).toBeInTheDocument();
    expect(smartPoint).toBeDisabled();
    // smart-box 要求 interactive_box → 正常可用
    expect(screen.getByTestId("tool-btn-smart-box")).not.toBeDisabled();
  });

  it("层 3 · 只启用 bbox 单位 → smart-*(产 polygon) 隐藏, magic-box(产 bbox) 仍在", () => {
    render(
      <ToolDock
        tool="select"
        onSetTool={vi.fn()}
        enabledToolUnits={new Set(["bbox"])}
      />,
    );
    expect(screen.queryByTestId("tool-btn-smart-point")).toBeNull();
    expect(screen.queryByTestId("tool-btn-smart-box")).toBeNull();
    expect(screen.queryByTestId("tool-btn-exemplar")).toBeNull();
    // magic-box 把 SAM 多边形收紧成外接矩形 → 归 bbox 单位, 故仍显示
    expect(screen.getByTestId("tool-btn-magic-box")).toBeInTheDocument();
    expect(screen.getByTestId("tool-btn-box")).toBeInTheDocument();
    // region 未启用 → 手画 polygon / mask 一并隐藏 (与 smart-* 同待遇)
    expect(screen.queryByTestId("tool-btn-polygon")).toBeNull();
  });

  it("层 3 · 启用 region 单位 → smart-* 恢复显示", () => {
    render(
      <ToolDock
        tool="select"
        onSetTool={vi.fn()}
        enabledToolUnits={new Set(["bbox", "region"])}
      />,
    );
    expect(screen.getByTestId("tool-btn-smart-point")).toBeInTheDocument();
    expect(screen.getByTestId("tool-btn-exemplar")).toBeInTheDocument();
    expect(screen.getByTestId("tool-btn-magic-box")).toBeInTheDocument();
  });

  it("层 1 优先于层 3 · 总开关关闭时, 即使单位已启用 AI 工具仍隐藏", () => {
    render(
      <ToolDock
        tool="select"
        onSetTool={vi.fn()}
        aiInteractiveEnabled={false}
        enabledToolUnits={new Set(["bbox", "region"])}
      />,
    );
    for (const id of AI_TOOL_IDS) {
      expect(screen.queryByTestId(`tool-btn-${id}`)).toBeNull();
    }
    expect(screen.getByTestId("tool-btn-polygon")).toBeInTheDocument();
  });
});

// v0.21.23 · 视频侧交互式 SAM 工具（此前视频分支完全没有 ML 能力门控）
describe("ToolDock · 视频 AI 工具三层门控", () => {
  const VIDEO_AI = ["smart-point", "smart-box"];

  it("默认全开 → 视频 AI 工具显示", () => {
    render(
      <ToolDock tool="select" onSetTool={vi.fn()} videoMode videoTool="select" onSetVideoTool={vi.fn()} />,
    );
    for (const id of VIDEO_AI) {
      expect(screen.getByTestId(`video-tool-btn-${id}`)).toBeInTheDocument();
    }
  });

  it("层 1 · 项目总开关关闭 → 视频 AI 工具隐藏, 几何工具不受影响", () => {
    render(
      <ToolDock
        tool="select"
        onSetTool={vi.fn()}
        videoMode
        videoTool="select"
        onSetVideoTool={vi.fn()}
        aiInteractiveEnabled={false}
      />,
    );
    for (const id of VIDEO_AI) {
      expect(screen.queryByTestId(`video-tool-btn-${id}`)).toBeNull();
    }
    expect(screen.getByTestId("video-tool-btn-box")).toBeInTheDocument();
    expect(screen.getByTestId("video-tool-btn-polygon")).toBeInTheDocument();
  });

  it("层 2 · 后端不支持 point → smart-point 置灰, smart-box 仍可用", () => {
    render(
      <ToolDock
        tool="select"
        onSetTool={vi.fn()}
        videoMode
        videoTool="select"
        onSetVideoTool={vi.fn()}
        isPromptSupported={(p) => p !== "point"}
      />,
    );
    expect(screen.getByTestId("video-tool-btn-smart-point")).toBeDisabled();
    expect(screen.getByTestId("video-tool-btn-smart-box")).not.toBeDisabled();
  });

  it("层 2 · 置灰的工具点击不切换工具", () => {
    const onSetVideoTool = vi.fn();
    render(
      <ToolDock
        tool="select"
        onSetTool={vi.fn()}
        videoMode
        videoTool="select"
        onSetVideoTool={onSetVideoTool}
        isPromptSupported={() => false}
      />,
    );
    screen.getByTestId("video-tool-btn-smart-point").click();
    expect(onSetVideoTool).not.toHaveBeenCalled();
  });

  it("层 3 · region 单位未启用 → smart-* 随多边形一起隐藏（产出几何归属）", () => {
    // 模拟只启用 bbox 单位: polygon / smart-* 都归 region → 全隐藏。
    render(
      <ToolDock
        tool="select"
        onSetTool={vi.fn()}
        videoMode
        videoTool="select"
        onSetVideoTool={vi.fn()}
        isVideoToolEnabled={(t) => t === "box" || t === "track"}
      />,
    );
    expect(screen.queryByTestId("video-tool-btn-smart-point")).toBeNull();
    expect(screen.queryByTestId("video-tool-btn-smart-box")).toBeNull();
    expect(screen.queryByTestId("video-tool-btn-polygon")).toBeNull();
    expect(screen.getByTestId("video-tool-btn-box")).toBeInTheDocument();
  });
});
