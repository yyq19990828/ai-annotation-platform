/**
 * AIInspectorPanel 单测
 * 覆盖: open=false 不渲染 / 渲染 AI 待审分组 / 渲染人工分组 / 采纳/驳回/精修按钮回调
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ComponentProps } from "react";

// jsdom 没有 ResizeObserver — react-virtual 需要它
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

// jsdom 下滚动容器高度为 0, react-virtual 默认渲染 0 行 → 列表内容(分组头/box行)都不渲染。
// mock useVirtualizer 让其返回全部行, 使列表内容可断言。
vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getVirtualItems: () =>
      Array.from({ length: count }, (_, i) => ({
        index: i,
        start: i * 68,
        size: 68,
        key: i,
      })),
    getTotalSize: () => count * 68,
    measureElement: () => {},
  }),
}));

// ── mock ResizeHandle (纯布局，不影响逻辑) ───────────────────────────────────
vi.mock("./ResizeHandle", () => ({
  ResizeHandle: () => <div data-testid="resize-handle" />,
}));

// ── mock AttributeForm ────────────────────────────────────────────────────────
vi.mock("./AttributeForm", () => ({
  AttributeForm: ({ onChange }: { onChange: (v: Record<string, unknown>) => void }) => (
    <div data-testid="attribute-form">
      <button onClick={() => onChange({ key: "val" })}>change-attr</button>
    </div>
  ),
}));

// ── mock BoxListItem (重量级画布依赖) ────────────────────────────────────────
vi.mock("../stage/BoxListItem", () => ({
  BoxListItem: ({
    b,
    isAi,
    onAccept,
    onReject,
    onRefine,
    onDelete,
  }: {
    b: { id: string; cls: string };
    isAi?: boolean;
    onAccept?: () => void;
    onReject?: () => void;
    onRefine?: () => void;
    onDelete?: () => void;
  }) => (
    <div data-testid={`box-item-${b.id}`}>
      <span>{b.cls}</span>
      {isAi && onAccept && (
        <button data-testid={`accept-${b.id}`} onClick={onAccept}>
          采纳
        </button>
      )}
      {isAi && onReject && (
        <button data-testid={`reject-${b.id}`} onClick={onReject}>
          驳回
        </button>
      )}
      {onRefine && (
        <button data-testid={`refine-${b.id}`} onClick={onRefine}>
          精修
        </button>
      )}
      {!isAi && onDelete && (
        <button data-testid={`delete-${b.id}`} onClick={onDelete}>
          删除
        </button>
      )}
    </div>
  ),
}));

// ── mock stage helpers ────────────────────────────────────────────────────────
vi.mock("../stage/ImageStageShapes", () => ({
  groupOutlineColor: () => "#ff0000",
}));
vi.mock("../stage/videoStageGeometry", () => ({
  resolveTrackAtFrame: () => null,
}));
vi.mock("../stage/videoTrackOutside", () => ({
  isFrameOutside: () => false,
}));

// ── mock SchemaForm / VariantSelector ─────────────────────────────────────────
vi.mock("../components/SchemaForm", () => ({
  SchemaForm: () => <div data-testid="schema-form" />,
  VARIANT_FIELD_KEYS: [],
}));
vi.mock("@/components/ml/VariantSelector", () => ({
  VariantSelector: () => <div data-testid="variant-selector" />,
}));

import { AIInspectorPanel } from "./AIInspectorPanel";
import type { AiBox } from "../state/transforms";
import type { Annotation } from "@/types";

// ── fixtures ──────────────────────────────────────────────────────────────────
function makeAiBox(id: string, cls = "car"): AiBox {
  return {
    id,
    predictionId: `pred-${id}`,
    shapeIndex: 0,
    annotation_type: "bbox",
    geometry: { type: "bbox", x: 0.1, y: 0.1, w: 0.2, h: 0.2 },
    x: 0.1,
    y: 0.1,
    w: 0.2,
    h: 0.2,
    cls,
    conf: 0.9,
    source: "prediction_based",
    predictionSource: "ml_backend",
  };
}

function makeUserBox(id: string, cls = "person"): Annotation {
  return {
    id,
    annotation_type: "bbox",
    geometry: { type: "bbox", x: 0.3, y: 0.3, w: 0.1, h: 0.1 },
    x: 0.3,
    y: 0.3,
    w: 0.1,
    h: 0.1,
    cls,
    conf: 1,
    source: "manual",
  };
}

const baseProps: ComponentProps<typeof AIInspectorPanel> = {
  open: true,
  width: 300,
  onResize: vi.fn(),
  aiBoxes: [] as AiBox[],
  userBoxes: [] as Annotation[],
  selectedId: null as string | null,
  selectedIds: [] as string[],
  imageWidth: 800,
  imageHeight: 600,
  onSelect: vi.fn(),
  onAcceptPrediction: vi.fn(),
  onRejectPrediction: vi.fn(),
  onRefinePrediction: vi.fn(),
  onClearSelection: vi.fn(),
  onDeleteUserBox: vi.fn(),
};

function renderUI(props: Partial<ComponentProps<typeof AIInspectorPanel>> = {}) {
  const merged = { ...baseProps, ...props };
  return render(
    <MemoryRouter>
      <AIInspectorPanel {...merged} />
    </MemoryRouter>,
  );
}

describe("AIInspectorPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("open=false → 不渲染任何内容", () => {
    renderUI({ open: false });
    expect(screen.queryByText("标注详情")).toBeNull();
  });

  it("open=true → 渲染面板标题", () => {
    renderUI();
    expect(screen.getByText("标注详情")).toBeInTheDocument();
  });

  it("点击分离按钮 → 调用 onDetach", () => {
    const onDetach = vi.fn();
    renderUI({ onDetach });
    fireEvent.click(screen.getByTitle("分离为浮窗"));
    expect(onDetach).toHaveBeenCalled();
  });

  it("有 AI 框 → 渲染「AI 待审」分组头 + box item", () => {
    const aiBoxes = [makeAiBox("ai-1", "car")];
    renderUI({ aiBoxes });
    expect(screen.getByText("AI 待审")).toBeInTheDocument();
    expect(screen.getByTestId("box-item-ai-1")).toBeInTheDocument();
  });

  it("来源筛选开关触发 onToggle", () => {
    const onToggle = vi.fn();
    renderUI({
      aiBoxes: [],
      predictionSourceFilter: {
        visibility: { ml_backend: true, external_import: true },
        counts: { ml_backend: 2, external_import: 1 },
        totalCount: 3,
        onToggle,
      },
    });

    expect(screen.getByText("AI 待审")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: /导入/ }));
    expect(onToggle).toHaveBeenCalledWith("external_import", false);
  });

  it("有 user 框 → 渲染「人工」分组头 + box item", () => {
    const userBoxes = [makeUserBox("u-1", "person")];
    renderUI({ userBoxes });
    expect(screen.getByText("人工")).toBeInTheDocument();
    expect(screen.getByTestId("box-item-u-1")).toBeInTheDocument();
  });

  it("点击采纳按钮 → 调用 onAcceptPrediction", () => {
    const onAcceptPrediction = vi.fn();
    const aiBox = makeAiBox("ai-2", "truck");
    renderUI({ aiBoxes: [aiBox], onAcceptPrediction });
    fireEvent.click(screen.getByTestId("accept-ai-2"));
    expect(onAcceptPrediction).toHaveBeenCalledWith(aiBox);
  });

  it("点击驳回按钮 → 调用 onRejectPrediction + onClearSelection", () => {
    const onRejectPrediction = vi.fn();
    const onClearSelection = vi.fn();
    const aiBox = makeAiBox("ai-3", "dog");
    renderUI({ aiBoxes: [aiBox], onRejectPrediction, onClearSelection });
    fireEvent.click(screen.getByTestId("reject-ai-3"));
    expect(onRejectPrediction).toHaveBeenCalledWith(aiBox);
    expect(onClearSelection).toHaveBeenCalled();
  });

  it("polygon AI 框点击精修 → 调用 onRefinePrediction", () => {
    const onRefinePrediction = vi.fn();
    const polygonBox: AiBox = {
      ...makeAiBox("ai-poly", "cat"),
      annotation_type: "polygon",
      geometry: { type: "polygon", points: [[0, 0], [0.1, 0], [0.1, 0.1]] },
    };
    renderUI({ aiBoxes: [polygonBox], onRefinePrediction });
    fireEvent.click(screen.getByTestId("refine-ai-poly"));
    expect(onRefinePrediction).toHaveBeenCalledWith(polygonBox);
  });

  it("多选时显示 multiSelectionBar", () => {
    const u1 = makeUserBox("u-sel-1");
    const u2 = makeUserBox("u-sel-2");
    renderUI({
      userBoxes: [u1, u2],
      selectedIds: ["u-sel-1", "u-sel-2"],
      selectedId: "u-sel-1",
    });
    expect(screen.getByText(/已选/)).toBeInTheDocument();
    expect(screen.getAllByText(/2/).length).toBeGreaterThan(0);
  });
});
