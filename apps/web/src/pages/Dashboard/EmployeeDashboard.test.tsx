import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const useProjects = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/useProjects", () => ({ useProjects }));
vi.mock("./AnnotatorDashboard", () => ({
  AnnotatorDashboard: () => <div data-testid="annotator-dashboard" />,
}));
vi.mock("./ReviewerDashboard", () => ({
  ReviewerDashboard: () => <div data-testid="reviewer-dashboard" />,
}));

import { EmployeeDashboard } from "./EmployeeDashboard";

function renderDashboard() {
  return render(
    <MemoryRouter>
      <EmployeeDashboard />
    </MemoryRouter>,
  );
}

describe("EmployeeDashboard", () => {
  beforeEach(() => useProjects.mockReset());

  it("无项目时展示等待分配项目", () => {
    useProjects.mockReturnValue({ isSuccess: true, data: [] });
    renderDashboard();
    expect(screen.getByText("等待分配项目")).toBeInTheDocument();
    expect(screen.queryByTestId("annotator-dashboard")).not.toBeInTheDocument();
  });

  it("默认展示标注工作，可切换到质检工作", () => {
    useProjects.mockReturnValue({ isSuccess: true, data: [{ id: "p1" }] });
    renderDashboard();
    expect(screen.getByTestId("annotator-dashboard")).toBeInTheDocument();
    expect(screen.queryByTestId("reviewer-dashboard")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("employee-tab-review"));
    expect(screen.getByTestId("reviewer-dashboard")).toBeInTheDocument();
    expect(screen.queryByTestId("annotator-dashboard")).not.toBeInTheDocument();
  });
});
