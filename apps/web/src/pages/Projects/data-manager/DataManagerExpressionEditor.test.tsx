import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { DataManagerFilterField } from "@/api/taskViews";
import { DataManagerExpressionEditor } from "./DataManagerExpressionEditor";

const fields: DataManagerFilterField[] = [
  {
    key: "status",
    label: "状态",
    group: "任务",
    value_type: "select",
    operators: ["eq"],
    options: [{ value: "pending", label: "待处理" }],
    expensive: false,
    tool_unit_id: null,
    attribute_key: null,
  },
];

const numberField: DataManagerFilterField = {
  key: "count",
  label: "数量",
  group: "任务",
  value_type: "number",
  operators: ["eq"],
  options: [],
  expensive: false,
  tool_unit_id: null,
  attribute_key: null,
};

describe("DataManagerExpressionEditor", () => {
  it("edits nested OR groups by path and keeps group controls visible", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <DataManagerExpressionEditor
        expression={{
          op: "and",
          rules: [
            {
              op: "or",
              rules: [{ field: "status", op: "eq", value: "pending" }],
            },
          ],
        }}
        fields={fields}
        onChange={onChange}
      />,
    );
    expect(screen.getByText("任一条件（1）")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "root 逻辑关系" })).toHaveValue("and");
    expect(screen.getByRole("combobox", { name: "0 逻辑关系" })).toHaveValue("or");
    await user.selectOptions(screen.getByRole("combobox", { name: "0 逻辑关系" }), "and");
    expect(onChange).toHaveBeenCalledWith({
      op: "and",
      rules: [{ op: "and", rules: [{ field: "status", op: "eq", value: "pending" }] }],
    });
  });

  it("reports an invalid grouped draft and clears it after correction or unmount", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const onValidityChange = vi.fn();
    const view = render(
      <DataManagerExpressionEditor
        expression={{ op: "and", rules: [{ field: "count", op: "eq", value: 1 }] }}
        fields={[numberField]}
        onChange={onChange}
        editorId="group:count"
        onValidityChange={onValidityChange}
      />,
    );
    await waitFor(() => expect(onValidityChange).toHaveBeenLastCalledWith(true, "group:count"));
    const input = screen.getByRole("textbox", { name: "条件值" });
    await user.clear(input);
    await user.type(input, "-");
    await waitFor(() => expect(onValidityChange).toHaveBeenLastCalledWith(false, "group:count"));
    await user.clear(input);
    await user.type(input, "2");
    await waitFor(() => expect(onValidityChange).toHaveBeenLastCalledWith(true, "group:count"));
    view.unmount();
    expect(onValidityChange).toHaveBeenLastCalledWith(true, "group:count");
  });

  it("keeps a new owner's invalid restored value blocked", async () => {
    const onValidityChange = vi.fn();
    const expression = (value: unknown) => ({
      op: "and" as const,
      rules: [{ field: "count", op: "eq" as const, value }],
    });
    const { rerender } = render(
      <DataManagerExpressionEditor
        expression={expression("")}
        fields={[numberField]}
        onChange={vi.fn()}
        editorId="group:first"
        onValidityChange={onValidityChange}
      />,
    );
    await waitFor(() => expect(onValidityChange).toHaveBeenLastCalledWith(false, "group:first"));
    rerender(
      <DataManagerExpressionEditor
        expression={expression("")}
        fields={[numberField]}
        onChange={vi.fn()}
        editorId="group:second"
        onValidityChange={onValidityChange}
      />,
    );
    await waitFor(() => expect(onValidityChange).toHaveBeenLastCalledWith(false, "group:second"));
  });
});
