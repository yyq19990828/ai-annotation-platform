/**
 * v0.10.16 · RejectReasonModal 单测：4 个 reason_type 单选 + comment 可空 + skip hint 预填。
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RejectReasonModal } from "../RejectReasonModal";

describe("RejectReasonModal", () => {
  it("默认选中第一个 type (missing)，确认时回调返回 reason_type", () => {
    const onConfirm = vi.fn();
    render(
      <RejectReasonModal open count={3} onClose={() => {}} onConfirm={onConfirm} />,
    );
    fireEvent.click(screen.getByTestId("reject-confirm"));
    expect(onConfirm).toHaveBeenCalledWith({
      reason_type: "missing",
      reason: undefined,
    });
  });

  it("切换 type 后 payload 带新 type", () => {
    const onConfirm = vi.fn();
    render(
      <RejectReasonModal open count={1} onClose={() => {}} onConfirm={onConfirm} />,
    );
    fireEvent.click(screen.getByTestId("reject-type-wrong_geometry"));
    fireEvent.click(screen.getByTestId("reject-confirm"));
    expect(onConfirm).toHaveBeenCalledWith({
      reason_type: "wrong_geometry",
      reason: undefined,
    });
  });

  it("comment 文本填写后 payload 同时带 reason", () => {
    const onConfirm = vi.fn();
    render(
      <RejectReasonModal open count={1} onClose={() => {}} onConfirm={onConfirm} />,
    );
    fireEvent.change(screen.getByTestId("reject-comment"), {
      target: { value: "框漏了 3 处行人" },
    });
    fireEvent.click(screen.getByTestId("reject-confirm"));
    expect(onConfirm).toHaveBeenCalledWith({
      reason_type: "missing",
      reason: "框漏了 3 处行人",
    });
  });

  it("传入 skipReasonHint 时显示紫色提示且 comment 预填", () => {
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
    const textarea = screen.getByTestId("reject-comment") as HTMLTextAreaElement;
    expect(textarea.value).toBe("标注员跳过：图片损坏");

    fireEvent.click(screen.getByTestId("reject-confirm"));
    expect(onConfirm).toHaveBeenCalledWith({
      reason_type: "missing",
      reason: "标注员跳过：图片损坏",
    });
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
