// v0.20.16-ui · SecondaryInferenceBar (下拉选能力 + 运行 悬浮面板) 组件测试:
// - 无能力 / readOnly → 不渲染
// - 有能力 → 渲染分组下拉 + 运行按钮; 运行选中能力 → 调 run + toast (几何/属性 sub)
// - attributes-型选中且缺承接字段 → 出现补全 CTA; 运行后 warning toast
// - 有可调参数 → ⚙ 显隐 + 展开参数面板
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, fireEvent, waitFor } from "@testing-library/react";
import type { MLModelCapability } from "@/api/ml-backends";
import type { AnnotationResponse } from "@/types";
import { SecondaryInferenceBar } from "./SecondaryInferenceBar";
import type { SecondaryCapability } from "../state/useSecondaryInference";

const pushToast = vi.fn();
vi.mock("@/components/ui/Toast", () => ({
  useToastStore: (sel: (s: { push: typeof pushToast }) => unknown) =>
    sel({ push: pushToast }),
}));

const mutateAsync = vi.fn();
const capabilitiesRef: { current: SecondaryCapability[] } = { current: [] };
vi.mock("../state/useSecondaryInference", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../state/useSecondaryInference")>();
  return {
    ...actual, // 保留 missingAttributeFields / hasConfigurableParams / buildSecondaryInferencePayload 真实实现
    useSecondaryCapabilities: () => ({
      capabilities: capabilitiesRef.current,
      isLoading: false,
    }),
    useRunSecondaryInference: () => ({ mutateAsync }),
  };
});

function model(over: Partial<MLModelCapability>): MLModelCapability {
  return { id: "m1", display_name: "分类器", task: "classification", ...over } as MLModelCapability;
}
function attrCap(over: Partial<MLModelCapability> = {}): SecondaryCapability {
  return {
    backendId: "be-1",
    backendName: "onnx",
    model: model(over),
    writeTarget: "attributes",
    label: (over.display_name as string) || "分类器",
  };
}
function geomCap(): SecondaryCapability {
  return {
    backendId: "be-2",
    backendName: "yolo",
    model: model({ id: "det", display_name: "车牌检测", task: "detection" }),
    writeTarget: "geometry",
    label: "车牌检测",
  };
}

const annotation = {
  id: "anno-1",
  task_id: "task-1",
  class_name: "car",
} as AnnotationResponse;

beforeEach(() => {
  pushToast.mockReset();
  mutateAsync.mockReset();
  capabilitiesRef.current = [];
});

describe("SecondaryInferenceBar", () => {
  it("无能力 → 不渲染", () => {
    const { container } = render(
      <SecondaryInferenceBar projectId="p" taskId="task-1" annotation={annotation} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("readOnly → 不渲染 (即便有能力)", () => {
    capabilitiesRef.current = [attrCap()];
    const { container } = render(
      <SecondaryInferenceBar
        projectId="p"
        taskId="task-1"
        annotation={annotation}
        readOnly
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("有能力 → 渲染能力下拉 + 运行按钮", () => {
    capabilitiesRef.current = [attrCap(), geomCap()];
    const { getByTestId } = render(
      <SecondaryInferenceBar projectId="p" taskId="task-1" annotation={annotation} />,
    );
    const select = getByTestId("secondary-cap-select") as HTMLSelectElement;
    expect(select.querySelectorAll("option")).toHaveLength(2);
    expect(getByTestId("secondary-run")).toBeTruthy();
  });

  it("几何能力有变体轴 → 渲染档位下拉; 属性能力 → 无", () => {
    capabilitiesRef.current = [
      attrCap(),
      {
        backendId: "be-2",
        backendName: "yolo",
        model: model({
          id: "det",
          display_name: "车牌检测",
          task: "detection",
          supported_variants: [
            {
              key: "size",
              variants: [{ value: "s" }, { value: "l" }],
            },
          ] as MLModelCapability["supported_variants"],
        }),
        writeTarget: "geometry",
        label: "车牌检测",
      },
    ];
    const { getByTestId, queryByTestId } = render(
      <SecondaryInferenceBar projectId="p" taskId="task-1" annotation={annotation} />,
    );
    // 默认选中首个 (属性能力) → 无档位下拉。
    expect(queryByTestId("ai-variant-size")).toBeNull();
    // 切到几何能力 → 出现档位下拉。
    fireEvent.change(getByTestId("secondary-cap-select"), {
      target: { value: "be-2:det" },
    });
    expect(getByTestId("ai-variant-size")).toBeTruthy();
  });

  it("选几何能力后运行 → 调 run + 新增子框 toast", async () => {
    capabilitiesRef.current = [attrCap(), geomCap()];
    mutateAsync.mockResolvedValue({
      annotation: { ...annotation, attributes_meta: {} },
      created_children: [{ id: "c1" }, { id: "c2" }],
    });
    const { getByTestId } = render(
      <SecondaryInferenceBar projectId="p" taskId="task-1" annotation={annotation} />,
    );
    fireEvent.change(getByTestId("secondary-cap-select"), {
      target: { value: "be-2:det" },
    });
    fireEvent.click(getByTestId("secondary-run"));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(pushToast).toHaveBeenCalledWith(
        expect.objectContaining({ sub: "新增 2 个子框", kind: "success" }),
      ),
    );
  });

  it("attributes 缺承接字段 → 渲染补全 CTA, 点击回调带缺失字段", () => {
    capabilitiesRef.current = [
      attrCap({
        output_attribute_schema: [
          { key: "color", label: "颜色", type: "select", options: [] },
        ] as MLModelCapability["output_attribute_schema"],
      }),
    ];
    const onEnsure = vi.fn();
    const { getByTestId } = render(
      <SecondaryInferenceBar
        projectId="p"
        taskId="task-1"
        annotation={annotation}
        existingAttributeKeys={new Set()}
        onEnsureAttributeFields={onEnsure}
      />,
    );
    fireEvent.click(getByTestId("secondary-fill"));
    expect(onEnsure).toHaveBeenCalledWith([
      expect.objectContaining({ key: "color", label: "颜色" }),
    ]);
  });

  it("attributes 已有承接字段 → 无补全 CTA", () => {
    capabilitiesRef.current = [
      attrCap({
        output_attribute_schema: [
          { key: "color", label: "颜色", type: "select", options: [] },
        ] as MLModelCapability["output_attribute_schema"],
      }),
    ];
    const { queryByTestId } = render(
      <SecondaryInferenceBar
        projectId="p"
        taskId="task-1"
        annotation={annotation}
        existingAttributeKeys={new Set(["color"])}
        onEnsureAttributeFields={vi.fn()}
      />,
    );
    expect(queryByTestId("secondary-fill")).toBeNull();
  });

  it("选中能力有可调参数 → 显示 ⚙, 点击展开参数面板; 无参数 → 无 ⚙", () => {
    capabilitiesRef.current = [
      attrCap({
        id: "withp",
        params: {
          type: "object",
          properties: { score_threshold: { type: "number", default: 0.5 } },
        },
      }),
    ];
    const { getByTestId, queryByTestId } = render(
      <SecondaryInferenceBar projectId="p" taskId="task-1" annotation={annotation} />,
    );
    const toggle = getByTestId("secondary-params-toggle");
    expect(queryByTestId("secondary-params-panel")).toBeNull();
    fireEvent.click(toggle);
    expect(getByTestId("secondary-params-panel")).toBeTruthy();
  });

  it("选中能力无可调参数 → 无 ⚙", () => {
    capabilitiesRef.current = [attrCap({ id: "nop" })];
    const { queryByTestId } = render(
      <SecondaryInferenceBar projectId="p" taskId="task-1" annotation={annotation} />,
    );
    expect(queryByTestId("secondary-params-toggle")).toBeNull();
  });

  it("运行属性能力写了缺字段的键 → warning toast 提示不显示", async () => {
    capabilitiesRef.current = [attrCap()];
    mutateAsync.mockResolvedValue({
      annotation: { ...annotation, attributes_meta: { color: { origin: "ai" } } },
      created_children: [],
    });
    const { getByTestId } = render(
      <SecondaryInferenceBar
        projectId="p"
        taskId="task-1"
        annotation={annotation}
        existingAttributeKeys={new Set()}
      />,
    );
    fireEvent.click(getByTestId("secondary-run"));
    await waitFor(() =>
      expect(pushToast).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: "warning",
          sub: expect.stringContaining("缺字段"),
        }),
      ),
    );
  });
});
