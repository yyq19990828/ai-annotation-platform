import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { ToolDock } from "./ToolDock";
import { dispatchKey, type DispatchCtx } from "../state/hotkeys";

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

  it("按单帧、SAM 与轨迹语义排列工具，AI 追踪不再占用左侧工具栏", () => {
    render(
      <ToolDock
        tool="select"
        onSetTool={vi.fn()}
        videoMode
        videoTool="select"
        onSetVideoTool={vi.fn()}
      />,
    );

    const frameGroup = screen.getByRole("group", { name: "单帧工具" });
    const samGroup = within(frameGroup).getByRole("group", { name: "SAM 工具" });
    const trackGroup = screen.getByRole("group", { name: "轨迹工具" });
    const toolIds = (root: HTMLElement) =>
      [...root.querySelectorAll<HTMLElement>("[data-testid^='video-tool-btn-']")].map((button) =>
        button.dataset.testid?.replace("video-tool-btn-", ""),
      );

    expect(toolIds(frameGroup)).toEqual([
      "box",
      "polygon",
      "polyline",
      "smart-point",
      "smart-box",
      "exemplar",
      "magic-box",
    ]);
    expect(toolIds(samGroup)).toEqual(["smart-point", "smart-box", "exemplar", "magic-box"]);
    expect(toolIds(trackGroup)).toEqual(["track", "polygon-track", "polyline-track", "mask"]);
    expect(screen.queryByTestId("video-tool-btn-ai-track")).toBeNull();
    expect(frameGroup).not.toContainElement(screen.getByTestId("video-tool-btn-select"));
  });

  it("矩形框轨迹使用独立的叠帧图标", () => {
    render(
      <ToolDock
        tool="select"
        onSetTool={vi.fn()}
        videoMode
        videoTool="select"
        onSetVideoTool={vi.fn()}
      />,
    );

    const track = screen.getByTestId("video-tool-btn-track");
    const smartPoint = screen.getByTestId("video-tool-btn-smart-point");
    expect(track).toHaveAccessibleName("矩形框轨迹");
    expect(track.querySelector(".lucide-gallery-horizontal-end")).toBeInTheDocument();
    expect(smartPoint.querySelector(".lucide-target")).toBeInTheDocument();
  });

  it("项目开关隐藏全部创建工具时不渲染空分组", () => {
    render(
      <ToolDock
        tool="select"
        onSetTool={vi.fn()}
        videoMode
        videoTool="select"
        onSetVideoTool={vi.fn()}
        aiInteractiveEnabled={false}
        isVideoToolEnabled={() => false}
      />,
    );

    expect(screen.queryByRole("group", { name: "单帧工具" })).toBeNull();
    expect(screen.queryByRole("group", { name: "SAM 工具" })).toBeNull();
    expect(screen.queryByRole("group", { name: "轨迹工具" })).toBeNull();
  });
});

// AI 工具三层门控 (ai_interactive 伪单位退役后):
//   1. project.ai_interactive_enabled 关 → 整组隐藏
//   2. 后端不支持该 prompt → 置灰
//   3. 产出几何所属单位未启用 → 隐藏 (smart-* → region, magic-box → bbox)
describe("ToolDock · AI 工具三层门控", () => {
  const AI_TOOL_IDS = ["smart-point", "smart-box", "smart-scribble", "exemplar", "magic-box"];

  it("默认 (总开关未加载 + 无 tool_bindings) → AI 工具全部显示", () => {
    render(<ToolDock tool="select" onSetTool={vi.fn()} />);
    for (const id of AI_TOOL_IDS) {
      expect(screen.getByTestId(`tool-btn-${id}`)).toBeInTheDocument();
    }
  });

  it("层 1 · 项目总开关关闭 → AI 工具整组隐藏, 绘制工具不受影响", () => {
    render(<ToolDock tool="select" onSetTool={vi.fn()} aiInteractiveEnabled={false} />);
    for (const id of AI_TOOL_IDS) {
      expect(screen.queryByTestId(`tool-btn-${id}`)).toBeNull();
    }
    expect(screen.getByTestId("tool-btn-box")).toBeInTheDocument();
    expect(screen.getByTestId("tool-btn-select")).toBeInTheDocument();
  });

  it("层 1 · 总开关开启 → AI 工具恢复显示", () => {
    render(<ToolDock tool="select" onSetTool={vi.fn()} aiInteractiveEnabled={true} />);
    for (const id of AI_TOOL_IDS) {
      expect(screen.getByTestId(`tool-btn-${id}`)).toBeInTheDocument();
    }
  });

  it("层 2 · 后端不支持该 prompt → 置灰而非隐藏", () => {
    render(<ToolDock tool="select" onSetTool={vi.fn()} isPromptSupported={(p) => p !== "point"} />);
    // smart-point 要求 point prompt → 置灰但仍在栏内
    const smartPoint = screen.getByTestId("tool-btn-smart-point");
    expect(smartPoint).toBeInTheDocument();
    expect(smartPoint).toBeDisabled();
    // smart-box 要求 interactive_box → 正常可用
    expect(screen.getByTestId("tool-btn-smart-box")).not.toBeDisabled();
  });

  it("层 3 · 只启用 bbox 单位 → smart-*(产 polygon) 隐藏, magic-box(产 bbox) 仍在", () => {
    render(<ToolDock tool="select" onSetTool={vi.fn()} enabledToolUnits={new Set(["bbox"])} />);
    expect(screen.queryByTestId("tool-btn-smart-point")).toBeNull();
    expect(screen.queryByTestId("tool-btn-smart-box")).toBeNull();
    expect(screen.queryByTestId("tool-btn-smart-scribble")).toBeNull();
    expect(screen.queryByTestId("tool-btn-exemplar")).toBeNull();
    // magic-box 把 SAM 多边形收紧成外接矩形 → 归 bbox 单位, 故仍显示
    expect(screen.getByTestId("tool-btn-magic-box")).toBeInTheDocument();
    expect(screen.getByTestId("tool-btn-box")).toBeInTheDocument();
    // region 未启用 → 手画 polygon / mask 一并隐藏 (与 smart-* 同待遇)
    expect(screen.queryByTestId("tool-btn-polygon")).toBeNull();
  });

  it("层 3 · 启用 region 单位 → smart-* 恢复显示", () => {
    render(
      <ToolDock tool="select" onSetTool={vi.fn()} enabledToolUnits={new Set(["bbox", "region"])} />,
    );
    expect(screen.getByTestId("tool-btn-smart-point")).toBeInTheDocument();
    expect(screen.getByTestId("tool-btn-smart-scribble")).toBeInTheDocument();
    expect(screen.getByTestId("tool-btn-exemplar")).toBeInTheDocument();
    expect(screen.getByTestId("tool-btn-magic-box")).toBeInTheDocument();
  });

  it("笔迹后端能力已就绪但未选 Mask 时按上下文置灰", () => {
    render(
      <ToolDock
        tool="select"
        onSetTool={vi.fn()}
        isPromptSupported={() => true}
        toolDisabledReasons={{ "smart-scribble": "请先选中原生 Mask" }}
      />,
    );
    expect(screen.getByTestId("tool-btn-smart-scribble")).toBeDisabled();
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
  const VIDEO_AI = ["smart-point", "smart-box", "exemplar", "magic-box"];

  it("默认全开 → 视频 AI 工具显示", () => {
    render(
      <ToolDock
        tool="select"
        onSetTool={vi.fn()}
        videoMode
        videoTool="select"
        onSetVideoTool={vi.fn()}
      />,
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
    // exemplar 各按自己的 requiredPrompt 判定, 不受 point 不支持牵连。
    expect(screen.getByTestId("video-tool-btn-exemplar")).not.toBeDisabled();
  });

  it("层 2 · 后端只支持 point → 仅 smart-point 可用, smart-box / exemplar 置灰", () => {
    render(
      <ToolDock
        tool="select"
        onSetTool={vi.fn()}
        videoMode
        videoTool="select"
        onSetVideoTool={vi.fn()}
        isPromptSupported={(p) => p === "point"}
      />,
    );
    expect(screen.getByTestId("video-tool-btn-smart-point")).not.toBeDisabled();
    expect(screen.getByTestId("video-tool-btn-smart-box")).toBeDisabled();
    expect(screen.getByTestId("video-tool-btn-exemplar")).toBeDisabled();
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
    // 模拟只启用 bbox 单位: box / track / magic-box 归 bbox, 其余归 region / polyline。
    render(
      <ToolDock
        tool="select"
        onSetTool={vi.fn()}
        videoMode
        videoTool="select"
        onSetVideoTool={vi.fn()}
        isVideoToolEnabled={(t) => t === "box" || t === "track" || t === "magic-box"}
      />,
    );
    expect(screen.queryByTestId("video-tool-btn-smart-point")).toBeNull();
    expect(screen.queryByTestId("video-tool-btn-smart-box")).toBeNull();
    expect(screen.queryByTestId("video-tool-btn-exemplar")).toBeNull();
    expect(screen.queryByTestId("video-tool-btn-polygon")).toBeNull();
    expect(screen.getByTestId("video-tool-btn-box")).toBeInTheDocument();
    // magic-box 产矩形框 → 归 bbox 单位, 只启用 bbox 时它**仍在**（与 smart-* 分家）。
    expect(screen.getByTestId("video-tool-btn-magic-box")).toBeInTheDocument();
  });
});

describe("ToolDock · 视频工具角标不撒谎", () => {
  // 角标是给用户看的承诺: 按这个键就切到这个工具。历史上 polygon 标 G、polyline 标 L 都没绑定,
  // 而视频 L 是播放 jog —— 按下去会快进。这条测试把角标与 hotkeys.ts 的真实绑定钉在一起。
  it("每个渲染出的角标都真能 dispatch 到它标注的工具", () => {
    render(
      <ToolDock
        tool="select"
        onSetTool={vi.fn()}
        videoMode
        videoTool="select"
        onSetVideoTool={vi.fn()}
        isPromptSupported={() => true}
      />,
    );
    const base: DispatchCtx = {
      isInputFocused: false,
      hasSelection: false,
      pendingActive: false,
      videoMode: true,
    };
    const buttons = [...document.querySelectorAll<HTMLElement>("[data-testid^='video-tool-btn-']")];
    expect(buttons.length).toBeGreaterThan(0);

    let checked = 0;
    for (const btn of buttons) {
      const id = btn.dataset.testid!.replace("video-tool-btn-", "");
      const badge = btn.querySelector("span[aria-hidden]")?.textContent?.trim();
      if (!badge) continue; // 无角标 = 未承诺快捷键 (polyline / *-track), 合法
      const action = dispatchKey(
        {
          key: badge.toLowerCase(),
          ctrlKey: false,
          metaKey: false,
          shiftKey: false,
          altKey: false,
        } as KeyboardEvent,
        base,
      );
      expect(action, `角标 ${badge} 标在 ${id} 上，但按下去不是切到它`).toEqual({
        type: "setVideoTool",
        tool: id,
      });
      checked += 1;
    }
    expect(checked).toBeGreaterThanOrEqual(7); // V B T P S D E G
  });
});
