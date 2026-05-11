import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ThreeDWorkbenchPlaceholder } from "./ThreeDWorkbench.placeholder";

describe("ThreeDWorkbenchPlaceholder", () => {
  it("renders unsupported placeholder", () => {
    render(<ThreeDWorkbenchPlaceholder />);

    expect(screen.getByTestId("three-d-workbench-placeholder")).toBeTruthy();
    expect(screen.getByText("3D 标注工作台暂未启用")).toBeTruthy();
  });
});
