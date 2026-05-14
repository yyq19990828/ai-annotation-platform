/**
 * v0.10.2 · SchemaForm 单测 (number / boolean / enum / 空 schema).
 * 不引入 @rjsf, 自研 ~150 行覆盖核心范畴.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SchemaForm, deriveDefaults } from "./index";

describe("SchemaForm", () => {
  it("空 schema → 渲染占位提示", () => {
    render(<SchemaForm schema={undefined} value={{}} onChange={() => {}} />);
    expect(screen.getByTestId("schema-form-empty")).toBeInTheDocument();
  });

  it("number 字段 + 范围 → slider, onChange 反映新值", () => {
    const onChange = vi.fn();
    render(
      <SchemaForm
        schema={{
          type: "object",
          properties: {
            box_threshold: {
              type: "number",
              minimum: 0,
              maximum: 1,
              default: 0.25,
              title: "Box 阈值",
            },
          },
        }}
        value={{ box_threshold: 0.25 }}
        onChange={onChange}
      />,
    );
    const slider = screen.getByTestId("schema-field-box_threshold").querySelector("input")!;
    fireEvent.change(slider, { target: { value: "0.5" } });
    expect(onChange).toHaveBeenCalledWith({ box_threshold: 0.5 });
  });

  it("boolean 字段 → 复选框可切换", () => {
    const onChange = vi.fn();
    render(
      <SchemaForm
        schema={{ type: "object", properties: { as_polygon: { type: "boolean", default: false, title: "转多边形" } } }}
        value={{}}
        onChange={onChange}
      />,
    );
    const cb = screen.getByTestId("schema-field-as_polygon").querySelector("input")!;
    fireEvent.click(cb);
    expect(onChange).toHaveBeenCalledWith({ as_polygon: true });
  });

  it("string enum 字段 → 下拉选择", () => {
    const onChange = vi.fn();
    render(
      <SchemaForm
        schema={{ type: "object", properties: { variant: { type: "string", enum: ["base", "large"], default: "base" } } }}
        value={{ variant: "base" }}
        onChange={onChange}
      />,
    );
    const select = screen.getByTestId("schema-field-variant").querySelector("select")!;
    fireEvent.change(select, { target: { value: "large" } });
    expect(onChange).toHaveBeenCalledWith({ variant: "large" });
  });

  it("deriveDefaults → 从 properties.default 派生", () => {
    expect(
      deriveDefaults({
        type: "object",
        properties: {
          a: { type: "number", default: 0.5 },
          b: { type: "boolean", default: true },
          c: { type: "string" /* no default */ },
        },
      }),
    ).toEqual({ a: 0.5, b: true });
  });
});
