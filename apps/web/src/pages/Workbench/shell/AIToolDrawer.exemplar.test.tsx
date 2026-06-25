// v0.18.23 · AIToolDrawer exemplar 能力驱动渲染: 后端无负框/无 text 叠加时隐藏对应控件。
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AIToolDrawer } from "./AIToolDrawer";
import type { MLModelCapability } from "@/api/ml-backends";

function exemplarModel(
  caps: MLModelCapability["exemplar_capabilities"],
): MLModelCapability {
  return {
    id: "exemplar-yoloe",
    task: "interactive_seg",
    is_interactive: true,
    supported_prompts: ["exemplar"],
    supported_geometric_outputs: ["bbox", "polygon"],
    exemplar_capabilities: caps,
  };
}

function renderDrawer(model: MLModelCapability) {
  return render(
    <AIToolDrawer
      tool="exemplar"
      backendName="yolo-backend"
      capability={undefined}
      samPolarity="positive"
      onSetSamPolarity={vi.fn()}
      isLoading={false}
      isError={false}
      exemplarOutputMode="mask"
      onSetExemplarOutputMode={vi.fn()}
      exemplarText=""
      onSetExemplarText={vi.fn()}
      exemplarThreshold={null}
      onSetExemplarThreshold={vi.fn()}
      models={[model]}
      activeModelId="exemplar-yoloe"
    />,
  );
}

describe("AIToolDrawer · exemplar 能力门控", () => {
  it("negative_box=false 隐藏负极性按钮", () => {
    renderDrawer(exemplarModel({ negative_box: false, text_combination: false }));
    expect(screen.queryByTestId("ai-tool-polarity")).toBeNull();
  });

  it("text_combination=false 隐藏叠加文本输入", () => {
    renderDrawer(exemplarModel({ negative_box: false, text_combination: false }));
    expect(screen.queryByTestId("exemplar-text")).toBeNull();
  });

  it("全支持 (sam3 风格) 显示负极性按钮与文本输入", () => {
    renderDrawer(exemplarModel({ negative_box: true, text_combination: true }));
    expect(screen.queryByTestId("ai-tool-polarity")).not.toBeNull();
    expect(screen.queryByTestId("exemplar-text")).not.toBeNull();
  });

  it("缺 exemplar_capabilities 向后兼容: 控件全显示", () => {
    renderDrawer(exemplarModel(undefined));
    expect(screen.queryByTestId("ai-tool-polarity")).not.toBeNull();
    expect(screen.queryByTestId("exemplar-text")).not.toBeNull();
  });

  it("输出形态三选恒显示 (与能力无关)", () => {
    renderDrawer(exemplarModel({ negative_box: false }));
    expect(screen.queryByTestId("exemplar-output-mode")).not.toBeNull();
  });
});
