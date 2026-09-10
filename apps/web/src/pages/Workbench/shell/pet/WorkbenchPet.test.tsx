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
  return render(<WorkbenchPet context={petContext()} onExpand={vi.fn()} {...overrides} />);
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

  it.each([1, 3])("详情展开时隐藏简化气泡，收起后恢复（选中 %i 个）", (count) => {
    const context = petContext({
      selection: { count, title: "car", collapsed: true, sourceKind: "manual" },
    });
    const onExpand = vi.fn();
    const view = renderPet({ context, onExpand });
    const pet = view.container.querySelector("[data-pet-mood]")!;
    const sprite = pet.querySelector("[data-pet-skin]");
    expect(pet.textContent).toContain(count === 1 ? "car" : "已选 3 个");

    view.rerender(<WorkbenchPet context={context} detailsVisible onExpand={onExpand} />);
    expect(pet.textContent).toBe("");
    expect(pet.querySelector("[data-pet-skin]")).toBe(sprite);

    view.rerender(<WorkbenchPet context={context} detailsVisible={false} onExpand={onExpand} />);
    expect(pet.textContent).toContain(count === 1 ? "car" : "已选 3 个");
    fireEvent.click(view.getByText("▸ 点我展开"));
    expect(onExpand).toHaveBeenCalledOnce();
  });

  it("详情展开时状态提示不叠放在详情上，桌宠仍保留对应状态", () => {
    const context = petContext({
      ai: { running: true, candidateCount: 0, backendOnline: true },
    });
    const onExpand = vi.fn();
    const view = renderPet({ context, onExpand });
    expect(view.getByText("AI 推理中")).toBeTruthy();
    view.rerender(<WorkbenchPet context={context} detailsVisible onExpand={onExpand} />);
    expect(view.queryByText("AI 推理中")).toBeNull();
    expect(view.container.querySelector("[data-pet-mood]")).toHaveAttribute(
      "data-pet-mood",
      "aiRunning",
    );
  });
});
