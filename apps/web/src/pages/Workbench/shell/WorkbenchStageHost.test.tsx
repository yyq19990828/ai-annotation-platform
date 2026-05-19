// v0.10.18 · WorkbenchStageHost focused render tests.
// 验证按 stageKind 分发到唯一对应的舞台组件 (image / video / 3d).
// 不验证舞台组件内部行为 — 那些有各自单测 (VideoStage / ImageWorkbench).

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createRef, forwardRef } from "react";

vi.mock("../stages/image/ImageWorkbench", () => ({
  ImageWorkbench: () => <div data-testid="image-workbench" />,
}));
vi.mock("../stages/video/VideoWorkbench", () => ({
  VideoWorkbench: forwardRef(function VideoWorkbench() {
    return <div data-testid="video-workbench" />;
  }),
}));
vi.mock("../stages/three-d/ThreeDWorkbench.placeholder", () => ({
  ThreeDWorkbenchPlaceholder: () => <div data-testid="three-d-placeholder" />,
}));

import { WorkbenchStageHost } from "./WorkbenchStageHost";

// 全字段 mock; 大多数 prop 仅 image/video 各自子组件消费, 这里只关心 stageKind 分发.
// 子组件被 vi.mock 替换为空 div 后, 实际不消费任何 prop;
// 用 `as unknown as Parameters<typeof WorkbenchStageHost>[0]` 绕开 70+ 字段的精确 mock.
type StageHostProps = React.ComponentProps<typeof WorkbenchStageHost>;
const baseProps = {
  overlays: <div data-testid="overlays-content">overlays</div>,
  readOnly: false,
  activeClass: "person",
  selectedId: null,
  annotations: [],
  onSelectBox: vi.fn(),
  onCursorMove: vi.fn(),

  videoManifest: undefined,
  videoTool: "box",
  videoFrameIndex: 0,
  hiddenVideoTrackIds: new Set<string>(),
  lockedVideoTrackIds: new Set<string>(),
  onVideoFrameIndexChange: vi.fn(),
  onVideoCreate: vi.fn(),
  onVideoPendingDraw: vi.fn(),
  onVideoUpdate: vi.fn(),
  onVideoRename: vi.fn(),
  onVideoConvertToBboxes: vi.fn(),

  fileUrl: null,
  thumbnailUrl: null,
  tool: "box",
  selectedIds: [],
  fadedAiIds: new Set<string>(),
  nudgeMap: new Map(),
  userBoxes: [],
  aiBoxes: [],
  spacePan: false,
  vp: { scale: 1, x: 0, y: 0 },
  setVp: vi.fn(),
  fitTick: 0,
  setFitTick: vi.fn(),
  pendingDrawing: null,
  onAcceptPrediction: vi.fn(),
  onRejectPrediction: vi.fn(),
  onDeleteUserBox: vi.fn(),
  onCommitDrawing: vi.fn(),
  onSamPrompt: vi.fn(),
  samCandidates: [],
  samActiveIdx: -1,
  samSubTool: null,
  samPolarity: "fg",
  onCommitMove: vi.fn(),
  onCommitResize: vi.fn(),
  onCommitPolygonGeometry: vi.fn(),
  onChangeUserBoxClass: vi.fn(),
  onBatchDelete: vi.fn(),
  onBatchChangeClass: vi.fn(),
  onStageGeometry: vi.fn(),
  canvasShapes: [],
  canvasEditable: false,
  canvasStroke: "#fff",
  onCanvasStrokeCommit: vi.fn(),
  canUndo: false,
  canRedo: false,
  onUndo: vi.fn(),
  onRedo: vi.fn(),
  onSetCanvasStroke: vi.fn(),
  canvasShapeCount: 0,
  onUndoCanvasShape: vi.fn(),
  onClearCanvasShapes: vi.fn(),
  onCancelCanvasDraft: vi.fn(),
  onDoneCanvasDraft: vi.fn(),
  stageGeom: { imgW: 0, imgH: 0, vpSize: { w: 0, h: 0 } },
};

function propsFor(stageKind: "image" | "video" | "3d"): StageHostProps {
  return { ...baseProps, stageKind } as unknown as StageHostProps;
}

describe("WorkbenchStageHost", () => {
  it("stageKind=image: renders ImageWorkbench, not Video / 3d", () => {
    render(<WorkbenchStageHost ref={createRef()} {...propsFor("image")} />);

    expect(screen.getByTestId("image-workbench")).toBeTruthy();
    expect(screen.queryByTestId("video-workbench")).toBeNull();
    expect(screen.queryByTestId("three-d-placeholder")).toBeNull();
  });

  it("stageKind=video: renders VideoWorkbench + overlays rendered outside (image owns overlays inline)", () => {
    render(<WorkbenchStageHost ref={createRef()} {...propsFor("video")} />);

    expect(screen.getByTestId("video-workbench")).toBeTruthy();
    expect(screen.queryByTestId("image-workbench")).toBeNull();
    expect(screen.queryByTestId("three-d-placeholder")).toBeNull();
    // Image 模式时 overlays 被传给 ImageWorkbench 自渲染; non-image 模式 host 在子组件后兜底渲染
    expect(screen.getByTestId("overlays-content")).toBeTruthy();
  });

  it("stageKind=3d: renders ThreeDWorkbenchPlaceholder only", () => {
    render(<WorkbenchStageHost ref={createRef()} {...propsFor("3d")} />);

    expect(screen.getByTestId("three-d-placeholder")).toBeTruthy();
    expect(screen.queryByTestId("image-workbench")).toBeNull();
    expect(screen.queryByTestId("video-workbench")).toBeNull();
  });
});
