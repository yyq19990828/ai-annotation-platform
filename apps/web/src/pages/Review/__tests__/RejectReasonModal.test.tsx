/**
 * v0.8.8 · RejectReasonModal 单测：preset 选择 / 其他自填 / skip_reason hint 预填。
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RejectReasonModal } from "../RejectReasonModal";

describe("RejectReasonModal", () => {
  it("默认选中第一个 preset，确认时回调返回该字符串", () => {
    const onConfirm = vi.fn();
    render(
      <RejectReasonModal open count={3} onClose={() => {}} onConfirm={onConfirm} />,
    );
    fireEvent.click(screen.getByTestId("reject-confirm"));
    expect(onConfirm).toHaveBeenCalledWith("类别错误");
  });

  it("选「其他」时显示 textarea，未输入则禁用确认按钮", () => {
    const onConfirm = vi.fn();
    render(
      <RejectReasonModal open count={1} onClose={() => {}} onConfirm={onConfirm} />,
    );
    fireEvent.click(screen.getByLabelText("其他"));
    const confirm = screen.getByTestId("reject-confirm") as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.click(confirm);
    expect(onConfirm).not.toHaveBeenCalled();

    const textarea = screen.getByPlaceholderText("自定义原因…") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "图框漂移" } });
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledWith("图框漂移");
  });

  it("传入 skipReasonHint 时显示紫色提示并默认选「其他」+ 预填文案", () => {
    const onConfirm = vi.fn();
    render(
      <RejectReasonModal
        open
        count={1}
        onClose={() => {}}
        onConfirm={onConfirm}
        skipReasonHint="图片损坏"
      />,
    );
    expect(screen.getByTestId("reject-skip-hint")).toBeInTheDocument();
    const textarea = screen.getByPlaceholderText("自定义原因…") as HTMLTextAreaElement;
    expect(textarea.value).toBe("标注员跳过：图片损坏");

    fireEvent.click(screen.getByTestId("reject-confirm"));
    expect(onConfirm).toHaveBeenCalledWith("标注员跳过：图片损坏");
  });

  it("无 skipReasonHint 时不显示紫色提示", () => {
    render(
      <RejectReasonModal
        open
        count={1}
        onClose={() => {}}
        onConfirm={() => {}}
      />,
    );
    expect(screen.queryByTestId("reject-skip-hint")).toBeNull();
  });
});
