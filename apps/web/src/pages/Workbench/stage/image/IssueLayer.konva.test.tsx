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

  it("centers every pin symbol in a fixed box at zoom", () => {
    const symbols = [
      { id: "warn", symbol: "!", status: "open", severity: "warn", x: 0.1, y: 0.2 },
      { id: "info", symbol: "i", status: "open", severity: "info", x: 0.2, y: 0.3 },
      { id: "blocker", symbol: "×", status: "open", severity: "blocker", x: 0.3, y: 0.4 },
      { id: "resolved", symbol: "✓", status: "resolved", severity: "warn", x: 0.4, y: 0.5 },
      { id: "wont-fix", symbol: "–", status: "wont_fix", severity: "warn", x: 0.5, y: 0.6 },
    ] as const;
    render(
      <IssueLayer
        pixelIssues={symbols.map(({ id, status, severity, x, y }) => ({
          ...issue(id, severity),
          status,
          anchor_position: { x, y },
        }))}
        imgW={1000}
        imgH={500}
        scale={2}
      />,
    );

    symbols.forEach(({ symbol, x, y }, index) => {
      const text = document.querySelectorAll('[data-konva="Text"]')[index];
      expect(text).toHaveAttribute("data-text", symbol);
      expect(text).toHaveAttribute("data-x", String(x * 1000 - 4));
      expect(text).toHaveAttribute("data-y", String(y * 500 - 4));
      expect(text).toHaveAttribute("data-width", "8");
      expect(text).toHaveAttribute("data-height", "8");
      expect(text).toHaveAttribute("data-align", "center");
      expect(text).toHaveAttribute("data-verticalalign", "middle");
      expect(text).not.toHaveAttribute("data-offsetx");
      expect(text).not.toHaveAttribute("data-offsety");
    });
  });
});
