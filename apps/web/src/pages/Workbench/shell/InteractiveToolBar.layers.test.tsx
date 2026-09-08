import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import type { AttributeField } from "@/api/projects";
import { InteractiveToolBar, type InteractiveToolBarProps } from "./InteractiveToolBar";

function props(overrides: Partial<InteractiveToolBarProps> = {}): InteractiveToolBarProps {
  return {
    tool: "smart-point",
    backendName: "SAM",
    capability: { name: "SAM", supported_prompts: ["point", "box", "exemplar"] },
    samPolarity: "positive",
    onSetSamPolarity: vi.fn(),
    isLoading: false,
    isError: false,
    ...overrides,
  };
}

function configuredProps(): InteractiveToolBarProps {
  return props({
    tool: "exemplar",
    interactiveBackends: [
      { id: "backend-a", name: "Backend A" },
      { id: "backend-b", name: "Backend B" },
    ],
    selectedInteractiveId: "backend-a",
    onSelectInteractive: vi.fn(),
    models: [
      {
        id: "model-a",
        display_name: "Model A",
        task: "interactive_seg",
        is_interactive: true,
        supported_prompts: ["exemplar"],
      },
      {
        id: "model-b",
        display_name: "Model B",
        task: "interactive_seg",
        is_interactive: true,
        supported_prompts: ["exemplar"],
      },
    ],
    activeModelId: "model-a",
    onSetActiveModelId: vi.fn(),
    variantGroups: [
      {
        key: "size",
        title: "权重",
        variants: [
          { value: "small", label: "Small" },
          { value: "large", label: "Large" },
        ],
      },
    ],
    variantValue: { size: "small" },
    onVariantChange: vi.fn(),
    exemplarText: "car",
    onSetExemplarText: vi.fn(),
    exemplarOutputMode: "both",
    onSetExemplarOutputMode: vi.fn(),
    singleFrameOutputGeometry: "mask",
    onSetSingleFrameOutputGeometry: vi.fn(),
    exemplarThreshold: 0.6,
    onSetExemplarThreshold: vi.fn(),
  });
}

describe("InteractiveToolBar layers", () => {
  it("keeps prompt inputs visible while configuration starts folded", () => {
    render(<InteractiveToolBar {...configuredProps()} />);

    expect(screen.getByTestId("interactive-toolbar")).toHaveAttribute("data-workbench-ai-toolbar");
    expect(screen.getByTestId("interactive-toolbar-advanced-toggle")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(screen.getByRole("textbox", { name: "示例叠加文本" })).toHaveValue("car");
    expect(screen.getByTestId("ai-tool-polarity")).toBeVisible();
    expect(screen.getByRole("combobox", { name: "示例召回形态" })).toBeVisible();
    expect(screen.getByRole("combobox", { name: "单帧提交几何" })).toBeVisible();
    expect(screen.getByTestId("ai-tool-backend-select")).not.toBeVisible();
    expect(screen.getByTestId("ai-tool-model-select")).not.toBeVisible();
    expect(screen.getByTestId("ai-variant-size")).not.toBeVisible();
    expect(screen.getByTestId("exemplar-threshold")).not.toBeVisible();
  });

  it("folds without remounting configuration, changing values, or calling owners", () => {
    const base = configuredProps();
    function ControlledToolbar() {
      const [backendId, setBackendId] = useState("backend-a");
      const [modelId, setModelId] = useState("model-a");
      const [variant, setVariant] = useState<Record<string, string>>({ size: "small" });
      const [threshold, setThreshold] = useState<number | null>(0.6);
      return (
        <InteractiveToolBar
          {...base}
          selectedInteractiveId={backendId}
          onSelectInteractive={(id) => {
            base.onSelectInteractive?.(id);
            setBackendId(id);
          }}
          activeModelId={modelId}
          onSetActiveModelId={(id) => {
            base.onSetActiveModelId?.(id);
            setModelId(id);
          }}
          variantValue={variant}
          onVariantChange={(next) => {
            base.onVariantChange?.(next);
            setVariant(next as Record<string, string>);
          }}
          exemplarThreshold={threshold}
          onSetExemplarThreshold={(next) => {
            base.onSetExemplarThreshold?.(next);
            setThreshold(next);
          }}
        />
      );
    }
    render(<ControlledToolbar />);
    const advanced = screen.getByTestId("interactive-toolbar-advanced");
    const toggle = screen.getByTestId("interactive-toolbar-advanced-toggle");
    expect(toggle).toHaveAttribute("aria-controls", advanced.id);
    fireEvent.click(toggle);
    const backend = screen.getByRole("combobox", { name: "交互后端" });
    const model = screen.getByRole("combobox", { name: "模型" });
    const variant = screen.getByTestId("ai-variant-size");
    const threshold = screen.getByRole("slider", { name: "示例召回阈值" });
    fireEvent.change(backend, { target: { value: "backend-b" } });
    fireEvent.change(model, { target: { value: "model-b" } });
    fireEvent.change(variant, { target: { value: "large" } });
    fireEvent.change(threshold, { target: { value: "0.8" } });

    fireEvent.click(toggle);
    expect(advanced).not.toBeVisible();
    fireEvent.click(toggle);
    expect(advanced).toBeVisible();
    expect(screen.getByTestId("ai-tool-backend-select")).toBe(backend);
    expect(screen.getByTestId("ai-tool-model-select")).toBe(model);
    expect(screen.getByTestId("ai-variant-size")).toBe(variant);
    expect(backend).toHaveValue("backend-b");
    expect(model).toHaveValue("model-b");
    expect(variant).toHaveValue("large");
    expect(threshold).toHaveValue("0.8");
    expect(base.onSelectInteractive).toHaveBeenCalledTimes(1);
    expect(base.onSelectInteractive).toHaveBeenCalledWith("backend-b");
    expect(base.onSetActiveModelId).toHaveBeenCalledTimes(1);
    expect(base.onSetActiveModelId).toHaveBeenCalledWith("model-b");
    expect(base.onVariantChange).toHaveBeenCalledTimes(1);
    expect(base.onVariantChange).toHaveBeenCalledWith({ size: "large" });
    expect(base.onSetExemplarThreshold).toHaveBeenCalledTimes(1);
    expect(base.onSetExemplarThreshold).toHaveBeenCalledWith(0.8);
    expect(base.onSetSamPolarity).not.toHaveBeenCalled();
    expect(base.onSetExemplarText).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "重置为后端默认阈值" }));
    expect(base.onSetExemplarThreshold).toHaveBeenLastCalledWith(null);
    expect(screen.queryByTestId("exemplar-threshold-reset")).toBeNull();
  });

  it("routes visible candidate decisions to their existing owner", () => {
    const base = props({
      candidateCount: 3,
      activeCandidateIndex: 1,
      canAcceptCandidates: true,
      onCycleCandidate: vi.fn(),
      onAcceptCandidate: vi.fn(),
      onCancelCandidates: vi.fn(),
    });
    const { rerender } = render(<InteractiveToolBar {...base} />);
    expect(screen.getByTestId("interactive-candidate-count")).toHaveTextContent("候选 2 / 3");
    fireEvent.click(screen.getByRole("button", { name: "上一个候选" }));
    fireEvent.click(screen.getByRole("button", { name: "下一个候选" }));
    fireEvent.click(screen.getByRole("button", { name: "接受" }));
    fireEvent.click(screen.getByRole("button", { name: "取消本轮" }));
    expect(base.onCycleCandidate).toHaveBeenNthCalledWith(1, -1);
    expect(base.onCycleCandidate).toHaveBeenNthCalledWith(2, 1);
    expect(base.onAcceptCandidate).toHaveBeenCalledTimes(1);
    expect(base.onCancelCandidates).toHaveBeenCalledTimes(1);

    rerender(<InteractiveToolBar {...base} activeCandidateIndex={2} candidateCount={4} />);
    expect(screen.getByTestId("interactive-candidate-count")).toHaveTextContent("候选 3 / 4");
  });

  it("disables candidate writes while the owner is processing", () => {
    const base = props({
      candidateCount: 2,
      canAcceptCandidates: true,
      candidateActionPending: true,
      onCycleCandidate: vi.fn(),
      onAcceptCandidate: vi.fn(),
      onCancelCandidates: vi.fn(),
    });
    render(<InteractiveToolBar {...base} />);
    for (const name of ["上一个候选", "下一个候选", "接受", "取消本轮"]) {
      const button = screen.getByRole("button", { name });
      expect(button).toBeDisabled();
      fireEvent.click(button);
    }
    expect(base.onCycleCandidate).not.toHaveBeenCalled();
    expect(base.onAcceptCandidate).not.toHaveBeenCalled();
    expect(base.onCancelCandidates).not.toHaveBeenCalled();
    expect(screen.getByTestId("interactive-inference-status")).toHaveTextContent("候选处理中");
  });

  it("handles empty, single and non-writable candidate sessions", () => {
    const base = props({
      onCycleCandidate: vi.fn(),
      onAcceptCandidate: vi.fn(),
      onCancelCandidates: vi.fn(),
      canAcceptCandidates: true,
    });
    const { rerender } = render(<InteractiveToolBar {...base} />);
    expect(screen.getByTestId("interactive-candidate-count")).toHaveTextContent("候选 0 / 0");
    expect(screen.getByRole("button", { name: "接受" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "下一个候选" })).toBeDisabled();

    rerender(<InteractiveToolBar {...base} candidateCount={1} />);
    expect(screen.getByRole("button", { name: "接受" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "上一个候选" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "下一个候选" })).toBeDisabled();

    rerender(<InteractiveToolBar {...base} candidateCount={1} canAcceptCandidates={false} />);
    expect(screen.getByRole("button", { name: "接受" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "取消本轮" })).toBeEnabled();
  });

  it("keeps capability loading separate from the current inference", () => {
    const base = props();
    const { rerender } = render(<InteractiveToolBar {...base} isLoading />);
    expect(screen.getByTestId("interactive-capability-status")).toHaveTextContent("正在加载能力");
    expect(screen.getByTestId("interactive-inference-status")).toHaveTextContent("等待提示");

    rerender(<InteractiveToolBar {...base} isRunning />);
    expect(screen.getByTestId("interactive-capability-status")).toHaveTextContent("能力就绪");
    expect(screen.getByTestId("interactive-inference-status")).toHaveTextContent("本轮推理中");
  });

  it("keeps both recoverable errors visible and retries their respective owners", () => {
    const base = props({
      isError: true,
      capabilityError: "后端连接失败",
      onRetryCapabilities: vi.fn(),
      inferenceError: "本轮请求超时",
      canRetry: true,
      onRetry: vi.fn(),
    });
    const { rerender } = render(<InteractiveToolBar {...base} />);
    expect(screen.getByTestId("interactive-capability-error")).toHaveTextContent(
      "能力协商：后端连接失败",
    );
    expect(screen.getByTestId("interactive-inference-error")).toHaveTextContent(
      "本轮推理：本轮请求超时",
    );
    expect(screen.getByTestId("interactive-capability-error")).toBeVisible();
    expect(screen.getByTestId("interactive-inference-error")).toBeVisible();
    expect(screen.getByTestId("interactive-toolbar-advanced")).not.toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "重试能力协商" }));
    expect(base.onRetryCapabilities).toHaveBeenCalledTimes(1);
    expect(base.onRetry).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "重试本轮" }));
    expect(base.onRetry).toHaveBeenCalledTimes(1);

    rerender(<InteractiveToolBar {...base} isCapabilityRetrying />);
    expect(screen.getByTestId("interactive-capability-retry")).toBeDisabled();
    expect(screen.getByTestId("interactive-capability-status")).toHaveTextContent("正在加载能力");
    expect(screen.getByTestId("interactive-inference-status")).toHaveTextContent("本轮推理失败");
  });

  it("blocks stale candidate decisions and another retry while inference can be cancelled", () => {
    const base = props({
      isRunning: true,
      canRetry: true,
      onRetry: vi.fn(),
      candidateCount: 2,
      canAcceptCandidates: true,
      onCycleCandidate: vi.fn(),
      onAcceptCandidate: vi.fn(),
      onCancelCandidates: vi.fn(),
    });
    render(<InteractiveToolBar {...base} />);
    const retry = screen.getByRole("button", { name: "重试本轮" });
    expect(retry).toBeVisible();
    expect(retry).toBeDisabled();
    fireEvent.click(retry);
    expect(base.onRetry).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "上一个候选" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "下一个候选" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "接受" })).toBeDisabled();
    const cancel = screen.getByRole("button", { name: "取消本轮" });
    expect(cancel).toBeEnabled();
    fireEvent.click(cancel);
    expect(base.onCancelCandidates).toHaveBeenCalledTimes(1);
  });

  it("supports capability recovery without showing or mutating an active tool session", () => {
    const base = configuredProps();
    base.models = [
      {
        id: "model-a",
        task: "interactive_seg",
        is_interactive: true,
        supported_prompts: ["exemplar"],
        exemplar_capabilities: { negative_box: false },
      },
    ];
    render(
      <InteractiveToolBar
        {...base}
        samPolarity="negative"
        capabilityRecoveryOnly
        isError
        capabilityError="能力服务不可用"
        onRetryCapabilities={vi.fn()}
        isRunning
        inferenceError="旧会话错误"
        candidateCount={2}
        canAcceptCandidates
        onAcceptCandidate={vi.fn()}
        canRetry
        onRetry={vi.fn()}
      />,
    );
    expect(
      within(screen.getByTestId("interactive-toolbar-primary")).getByText("AI 能力"),
    ).toBeVisible();
    expect(screen.queryByTestId("ai-tool-polarity")).toBeNull();
    expect(screen.queryByTestId("exemplar-text")).toBeNull();
    expect(screen.queryByTestId("exemplar-output-mode")).toBeNull();
    expect(screen.queryByTestId("single-frame-output-geometry")).toBeNull();
    expect(screen.queryByTestId("interactive-candidate-count")).toBeNull();
    expect(screen.queryByTestId("interactive-inference-status")).toBeNull();
    expect(screen.queryByTestId("interactive-inference-error")).toBeNull();
    expect(screen.queryByTestId("interactive-prompt-retry")).toBeNull();
    expect(screen.getByRole("button", { name: "重试能力协商" })).toBeVisible();
    fireEvent.click(screen.getByTestId("interactive-toolbar-advanced-toggle"));
    expect(screen.getByRole("combobox", { name: "交互后端" })).toBeVisible();
    expect(screen.getByTestId("interactive-capability-diagnostics")).toBeVisible();
    expect(screen.queryByTestId("exemplar-threshold")).toBeNull();
    expect(base.onSetSamPolarity).not.toHaveBeenCalled();
  });

  it("keeps warning details and attribute repair reachable in advanced settings", () => {
    const field: AttributeField = { key: "language", label: "语言", type: "text" };
    const onFillAttribute = vi.fn();
    render(
      <InteractiveToolBar
        {...props()}
        capabilityWarnings={[{ key: "language", message: "缺少语言属性", fillable: field }]}
        onFillAttribute={onFillAttribute}
      />,
    );
    const toggle = screen.getByTestId("interactive-toolbar-advanced-toggle");
    expect(toggle).toHaveTextContent("高级配置 · 1");
    expect(screen.getByTestId("ai-tool-capability-warnings")).not.toBeVisible();
    fireEvent.click(toggle);
    expect(screen.getByTestId("ai-tool-capability-warnings")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "一键补全" }));
    expect(onFillAttribute).toHaveBeenCalledWith(field);
    expect(onFillAttribute).toHaveBeenCalledTimes(1);
  });
});
