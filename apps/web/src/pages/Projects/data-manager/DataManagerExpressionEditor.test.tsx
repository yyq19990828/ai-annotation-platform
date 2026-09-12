import { render, screen } from "@testing-library/react";
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
});
