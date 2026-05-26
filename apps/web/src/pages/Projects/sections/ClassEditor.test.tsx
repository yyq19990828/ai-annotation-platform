import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ClassEditor, type ClassRow } from "./ClassEditor";

describe("<ClassEditor />", () => {
  it("删除类别前等待确认回调", async () => {
    const rows: ClassRow[] = [{ name: "car", color: "#ff0000" }];
    const onChange = vi.fn();
    const onConfirmDelete = vi.fn().mockResolvedValue(false);
    render(
      <ClassEditor
        value={rows}
        onChange={onChange}
        onConfirmDelete={onConfirmDelete}
      />,
    );

    fireEvent.click(screen.getByTitle("删除"));

    await waitFor(() => {
      expect(onConfirmDelete).toHaveBeenCalledWith(rows[0]);
    });
    expect(onChange).not.toHaveBeenCalled();
  });
});
