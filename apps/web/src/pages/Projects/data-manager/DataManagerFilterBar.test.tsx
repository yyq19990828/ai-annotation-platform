import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { DataManagerFilterField } from "@/api/taskViews";
import { DataManagerFilterBar } from "./DataManagerFilterBar";

const fields: DataManagerFilterField[] = [
  {
    key: "annotation.source",
    label: "标注来源",
    group: "标注",
    value_type: "select",
    operators: ["eq"],
    options: [],
    expensive: false,
    tool_unit_id: null,
    attribute_key: null,
  },
  {
    key: "prediction.model_version",
    label: "历史预测模型版本",
    group: "AI 追溯",
    value_type: "text",
    operators: ["eq"],
    options: [],
    expensive: true,
    tool_unit_id: null,
    attribute_key: null,
  },
];

describe("DataManagerFilterBar", () => {
  it("searches grouped fields and adds the selected filter", async () => {
    const user = userEvent.setup();
    const onAdd = vi.fn();

    render(
      <DataManagerFilterBar fields={fields} chips={[]} onAdd={onAdd} onClear={vi.fn()} />,
    );

    await user.click(screen.getByRole("button", { name: "筛选" }));
    await user.type(screen.getByRole("textbox", { name: "搜索筛选字段" }), "模型");

    expect(screen.queryByText("标注来源")).not.toBeInTheDocument();
    expect(screen.getByText("AI 追溯")).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", {
        name: "历史预测模型版本 prediction.model_version",
      }),
    );

    expect(onAdd).toHaveBeenCalledWith(fields[1]);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("exposes active conditions as editable chips and clears them together", async () => {
    const user = userEvent.setup();
    const onClear = vi.fn();

    render(
      <DataManagerFilterBar
        fields={fields}
        chips={[
          {
            id: "source",
            label: "标注来源",
            value: "= 人工",
            editor: <div>条件编辑器</div>,
          },
        ]}
        onAdd={vi.fn()}
        onClear={onClear}
      />,
    );

    await user.click(screen.getByRole("button", { name: "标注来源 = 人工" }));
    expect(screen.getByText("条件编辑器")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "清除全部" }));
    expect(onClear).toHaveBeenCalledOnce();
  });
});
