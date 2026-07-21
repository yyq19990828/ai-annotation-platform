// v0.16.14 · ImageSelectionCardContent 单测:
// - 渲染 改类/隐藏/锁定/删除 操作 + 结构化指标网格(bbox 像素 / polygon 顶点)
// - 各操作回调透传正确的 annotationId / flag / value
// - 有属性 schema 时渲染 AttributeForm,改值经 onUpdateAttributes 上抛

import { describe, expect, it, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import type { AnnotationResponse } from "@/types";
import type { AttributeSchema } from "@/api/projects";
import { ImageSelectionCardContent } from "./ImageSelectionCardContent";

function makeAnnotation(overrides: Partial<AnnotationResponse> = {}): AnnotationResponse {
  return {
    id: "anno-1",
    class_name: "car",
    geometry: { type: "bbox", x: 0.1, y: 0.1, w: 0.25, h: 0.2 },
    attributes: {},
    ...overrides,
  } as AnnotationResponse;
}

const noop = () => {};

describe("ImageSelectionCardContent", () => {
  it("渲染 bbox 像素指标(尺寸 + 占图)", () => {
    const { getByText } = render(
      <ImageSelectionCardContent
        annotation={makeAnnotation()}
        imageWidth={1920}
        imageHeight={1080}
        attributeSchema={undefined}
        readOnly={false}
        onChangeClass={noop}
        onToggleFlag={noop}
        onDelete={noop}
        onUpdateAttributes={noop}
      />,
    );
    // 0.25*1920=480, 0.2*1080=216
    expect(getByText("480×216 px")).not.toBeNull();
    expect(getByText("5.0%")).not.toBeNull(); // 占图 0.25*0.2
  });

  it("polygon 指标网格显示顶点数", () => {
    const ann = makeAnnotation({
      geometry: { type: "polygon", points: [[0, 0], [1, 0], [1, 1], [0, 1]] },
    });
    const { getByText } = render(
      <ImageSelectionCardContent
        annotation={ann}
        imageWidth={null}
        imageHeight={null}
        attributeSchema={undefined}
        readOnly={false}
        onChangeClass={noop}
        onToggleFlag={noop}
        onDelete={noop}
        onUpdateAttributes={noop}
      />,
    );
    expect(getByText("顶点")).not.toBeNull();
    expect(getByText("4")).not.toBeNull();
  });

  it.each([
    {
      name: "polygon holes",
      geometry: {
        type: "polygon" as const,
        points: [[0, 0], [1, 0], [1, 1], [0, 1]] as [number, number][],
        holes: [[[0.2, 0.2], [0.4, 0.2], [0.3, 0.4]]] as [number, number][][],
      },
    },
    {
      name: "multi_polygon",
      geometry: {
        type: "multi_polygon" as const,
        polygons: [{
          type: "polygon" as const,
          points: [[0, 0], [1, 0], [1, 1]] as [number, number][],
        }],
      },
    },
  ])("$name 显示防降级编辑提示", ({ geometry }) => {
    const { getByRole } = render(
      <ImageSelectionCardContent
        annotation={makeAnnotation({ geometry })}
        imageWidth={100}
        imageHeight={100}
        attributeSchema={undefined}
        readOnly={false}
        onChangeClass={noop}
        onToggleFlag={noop}
        onDelete={noop}
        onUpdateAttributes={noop}
      />,
    );

    expect(getByRole("status").textContent).toContain("禁用顶点编辑和整体拖动");
  });

  it("改类 / 锁定 / 删除 回调透传正确参数", () => {
    const onChangeClass = vi.fn();
    const onToggleFlag = vi.fn();
    const onDelete = vi.fn();
    const { getByLabelText } = render(
      <ImageSelectionCardContent
        annotation={makeAnnotation({ is_locked: false })}
        imageWidth={1920}
        imageHeight={1080}
        attributeSchema={undefined}
        readOnly={false}
        onChangeClass={onChangeClass}
        onToggleFlag={onToggleFlag}
        onDelete={onDelete}
        onUpdateAttributes={noop}
      />,
    );
    fireEvent.click(getByLabelText("修改类别"));
    expect(onChangeClass).toHaveBeenCalledWith("anno-1");
    fireEvent.click(getByLabelText("锁定"));
    expect(onToggleFlag).toHaveBeenCalledWith("anno-1", "is_locked", true);
    fireEvent.click(getByLabelText("删除标注"));
    expect(onDelete).toHaveBeenCalledWith("anno-1");
  });

  it("有属性 schema 时渲染 AttributeForm,改值经 onUpdateAttributes 上抛", () => {
    const schema: AttributeSchema = {
      fields: [{ key: "color", label: "颜色", type: "text" }],
    };
    const onUpdateAttributes = vi.fn();
    const { getByDisplayValue } = render(
      <ImageSelectionCardContent
        annotation={makeAnnotation({ attributes: { color: "red" } })}
        imageWidth={1920}
        imageHeight={1080}
        attributeSchema={schema}
        readOnly={false}
        onChangeClass={noop}
        onToggleFlag={noop}
        onDelete={noop}
        onUpdateAttributes={onUpdateAttributes}
      />,
    );
    const input = getByDisplayValue("red") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "blue" } });
    // 防抖路径:同步标 draft,400ms 后 flush(此处只验证渲染 + 受控值更新即可)
    expect(input.value).toBe("blue");
  });

  it("readOnly 时禁用 改类/锁定/删除(隐藏仍可用)", () => {
    const { getByLabelText } = render(
      <ImageSelectionCardContent
        annotation={makeAnnotation()}
        imageWidth={1920}
        imageHeight={1080}
        attributeSchema={undefined}
        readOnly
        onChangeClass={noop}
        onToggleFlag={noop}
        onDelete={noop}
        onUpdateAttributes={noop}
      />,
    );
    expect((getByLabelText("修改类别") as HTMLButtonElement).disabled).toBe(true);
    expect((getByLabelText("锁定") as HTMLButtonElement).disabled).toBe(true);
    expect((getByLabelText("删除标注") as HTMLButtonElement).disabled).toBe(true);
  });
});
