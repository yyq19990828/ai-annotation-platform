import { fireEvent, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkbenchPet } from "./WorkbenchPet";
import type { WorkbenchPetContext } from "./usePetState";

function petContext(overrides: Partial<WorkbenchPetContext> = {}): WorkbenchPetContext {
  return {
    selection: {
      count: 0,
      title: null,
      collapsed: false,
      sourceKind: "unknown",
      ...overrides.selection,
    },
    ai: {
      running: false,
      candidateCount: 0,
      backendOnline: true,
      ...overrides.ai,
    },
    workflow: {
      saving: false,
      offline: false,
      offlineQueueCount: 0,
      readOnly: false,
      reviewMode: false,
      ...overrides.workflow,
    },
    quality: {
      warningCount: 0,
      primaryWarning: null,
      ...overrides.quality,
    },
    counts: {
      annotationCount: 0,
      ...overrides.counts,
    },
  };
}

function renderPet(overrides: Partial<React.ComponentProps<typeof WorkbenchPet>> = {}) {
  return render(
    <WorkbenchPet
      context={petContext()}
      onExpand={vi.fn()}
      {...overrides}
    />,
  );
}

describe("WorkbenchPet", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("默认渲染像素标注员皮肤", () => {
    const { container } = renderPet();
    expect(container.querySelector('svg[data-pet-skin="pixel-human"]')).not.toBeNull();
  });

  it("举牌态点击展开选中信息卡", () => {
    const onExpand = vi.fn();
    const { getByLabelText, getByText } = renderPet({
      context: petContext({
        selection: { count: 1, title: "car", collapsed: true, sourceKind: "manual" },
      }),
      onExpand,
    });

    expect(getByText("car")).not.toBeNull();
    fireEvent.click(getByLabelText(/展开选中信息卡:car/));
    expect(onExpand).toHaveBeenCalledTimes(1);
  });

  it("多选显示数量提示", () => {
    const { getByText } = renderPet({
      context: petContext({
        selection: { count: 3, title: "3 个已选中 · 批量", collapsed: true, sourceKind: "manual" },
      }),
    });

    expect(getByText("已选 3 个")).not.toBeNull();
  });

  it("AI 运行与候选待处理显示上下文文案", () => {
    const { getByText, unmount } = renderPet({
      context: petContext({ ai: { running: true, candidateCount: 0, backendOnline: true } }),
    });

    expect(getByText("AI 推理中")).not.toBeNull();
    unmount();

    const candidate = renderPet({
      context: petContext({ ai: { running: false, candidateCount: 2, backendOnline: true } }),
    });

    expect(candidate.getByText("2 个候选待处理")).not.toBeNull();
  });
});
