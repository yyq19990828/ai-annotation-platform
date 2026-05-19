// v0.10.6 M4-γ · I13.2 · AttributeForm 单测：
// - mutable=true 字段在 context=video 时出现「逐帧」徽标；context=image / mutable 缺省时不出现
// - 传 dirtyTracker + annotationId 时，输入改变只标 dirty，不立即 onChange；form 失焦时 flush 触发一次 onChange
// - 不传 dirtyTracker 时维持 400ms debounce 行为（v0.6.x 兼容）

import { describe, expect, it, vi } from "vitest";
import { render, fireEvent, act } from "@testing-library/react";
import { renderHook } from "@testing-library/react";
import type { AttributeSchema } from "@/api/projects";
import { AttributeForm } from "./AttributeForm";
import { useDirtyTracker } from "../state/useDirtyTracker";

const schema: AttributeSchema = {
  fields: [
    { key: "color", label: "颜色", type: "text", mutable: false },
    { key: "occluded", label: "遮挡", type: "boolean", mutable: true },
  ],
};

describe("AttributeForm · mutable badge", () => {
  it("context=video + mutable=true 字段渲染「逐帧」徽标", () => {
    const { queryByTestId } = render(
      <AttributeForm
        schema={schema}
        className="car"
        attributes={{}}
        onChange={() => {}}
        context="video"
      />,
    );
    expect(queryByTestId("attr-mutable-badge-occluded")).not.toBeNull();
    expect(queryByTestId("attr-mutable-badge-color")).toBeNull();
  });

  it("context=image 下 mutable 标记被忽略（向后兼容）", () => {
    const { queryByTestId } = render(
      <AttributeForm
        schema={schema}
        className="car"
        attributes={{}}
        onChange={() => {}}
        context="image"
      />,
    );
    expect(queryByTestId("attr-mutable-badge-occluded")).toBeNull();
    expect(queryByTestId("attr-mutable-badge-color")).toBeNull();
  });
});

describe("AttributeForm · dirtyTracker 首次消费", () => {
  it("输入改变标 dirty 但不立即 onChange；blur form 时 flush 触发 onChange", () => {
    const { result: tracker } = renderHook(() => useDirtyTracker());
    const onChange = vi.fn();
    const { container, getByDisplayValue } = render(
      <AttributeForm
        schema={schema}
        className="car"
        attributes={{ color: "red" }}
        onChange={onChange}
        annotationId="anno-1"
        dirtyTracker={tracker.current}
      />,
    );

    const input = getByDisplayValue("red") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "blue" } });
    // dirty 已标，但 onChange 还没触发
    expect(tracker.current.getDirtyFields("anno-1")).toEqual(["attributes"]);
    expect(onChange).not.toHaveBeenCalled();

    // blur form 容器 → flush
    const formContainer = container.firstChild as HTMLElement;
    act(() => {
      fireEvent.blur(formContainer, { relatedTarget: null });
    });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toEqual({ color: "blue" });
    expect(tracker.current.getDirtyFields("anno-1")).toEqual([]);
  });

  it("不传 dirtyTracker 时维持 400ms debounce", () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    const { getByDisplayValue } = render(
      <AttributeForm
        schema={schema}
        className="car"
        attributes={{ color: "red" }}
        onChange={onChange}
      />,
    );
    const input = getByDisplayValue("red") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "blue" } });
    expect(onChange).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(450); });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toEqual({ color: "blue" });
    vi.useRealTimers();
  });
});

describe("AttributeForm · v0.10.20 · I12 batch banner", () => {
  it("batchCount > 1 时在顶部渲染 banner 提示 N 个标注被选中", () => {
    const { queryByTestId, getByTestId } = render(
      <AttributeForm
        schema={schema}
        className="car"
        attributes={{ color: "red" }}
        onChange={() => {}}
        batchCount={3}
      />,
    );
    const banner = queryByTestId("attribute-form-batch-banner");
    expect(banner).not.toBeNull();
    expect(getByTestId("attribute-form-batch-banner").textContent).toContain("3");
  });

  it("batchCount = 1 或未传时不渲染 banner (退化兼容单条编辑)", () => {
    const { queryByTestId, rerender } = render(
      <AttributeForm
        schema={schema}
        className="car"
        attributes={{ color: "red" }}
        onChange={() => {}}
        batchCount={1}
      />,
    );
    expect(queryByTestId("attribute-form-batch-banner")).toBeNull();
    rerender(
      <AttributeForm
        schema={schema}
        className="car"
        attributes={{ color: "red" }}
        onChange={() => {}}
      />,
    );
    expect(queryByTestId("attribute-form-batch-banner")).toBeNull();
  });
});
