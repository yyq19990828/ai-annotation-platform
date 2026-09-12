import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AnnotationFeedback } from "@/api/feedbacks";
import { IssueLayer } from "./IssueLayer";

function issue(id: string, severity: AnnotationFeedback["severity"] = "warn") {
  return {
    id,
    kind: "issue",
    anchor_type: "pixel",
    status: "open",
    severity,
    anchor_position: { x: 0.25, y: 0.5 },
  } as unknown as AnnotationFeedback;
}

describe("IssueLayer", () => {
  it("uses shared screen-sized pins, symbols, and a selected outer ring", () => {
    const onPinClick = vi.fn();
    const view = render(
      <IssueLayer
        pixelIssues={[issue("pin-1", "blocker"), issue("pin-2", "info")]}
        imgW={1000}
        imgH={500}
        scale={1}
        highlightId="pin-1"
        onPinClick={onPinClick}
      />,
    );
    expect(document.querySelector('[data-testid="issue-pin-pin-1"]')).toHaveAttribute(
      "data-radius",
      "8",
    );
    expect(document.querySelector('[data-testid="issue-pin-ring-pin-1"]')).toHaveAttribute(
      "data-radius",
      "11",
    );
    expect(document.querySelector('[data-testid="issue-pin-pin-2"]')).toHaveAttribute(
      "data-radius",
      "8",
    );
    expect(document.querySelectorAll('[data-konva="Text"]')[0]).toHaveAttribute("data-text", "×");
    fireEvent.click(document.querySelector('[data-testid="issue-pin-pin-2"]')!);
    expect(onPinClick).toHaveBeenCalledWith("pin-2");
    view.rerender(
      <IssueLayer
        pixelIssues={[issue("pin-1", "blocker")]}
        imgW={1000}
        imgH={500}
        scale={2}
        highlightId="pin-1"
        onPinClick={onPinClick}
      />,
    );
    expect(document.querySelector('[data-testid="issue-pin-pin-1"]')).toHaveAttribute(
      "data-radius",
      "4",
    );
  });
});
