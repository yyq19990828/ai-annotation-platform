import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { StatusBar } from "./StatusBar";

it("keeps the cursor slot mounted when the pointer enters and leaves the image", () => {
  const props = {
    userBoxesCount: 0,
    aiBoxesCount: 0,
    activeClass: "person",
    imageWidth: 1280,
    imageHeight: 720,
    cursor: null,
    preannotationProgress: null,
    preannotationConn: "open" as const,
    preannotationRetries: 0,
  };
  const { rerender } = render(<StatusBar {...props} />);
  const slot = screen.getByTestId("status-cursor");
  expect(slot).toHaveTextContent("—");
  rerender(<StatusBar {...props} cursor={{ x: 0.5, y: 0.5 }} />);
  expect(screen.getByTestId("status-cursor")).toBe(slot);
  expect(slot).toHaveTextContent("(640, 360)");
  rerender(<StatusBar {...props} />);
  expect(screen.getByTestId("status-cursor")).toBe(slot);
  expect(slot).toHaveTextContent("—");
});
