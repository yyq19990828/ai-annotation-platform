import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { PreannotateConfigForm } from "./PreannotateConfigForm";
import type { PreannotateConfig } from "./usePreannotateConfig";

const emptyCfg = {
  backendId: null,
} as unknown as PreannotateConfig;

describe("PreannotateConfigForm", () => {
  it("labels the project-bound backend as 项目主后端", () => {
    render(
      <PreannotateConfigForm
        cfg={emptyCfg}
        backendSelectorLabel="本次 backend"
        backends={[
          { id: "b1", name: "yolo" },
          { id: "b2", name: "gsam2" },
        ]}
        selectedBackendId="b1"
        onSelectBackend={vi.fn()}
        projectMlBackendId="b2"
      />,
    );

    expect(screen.getByText("本次 backend")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "gsam2（项目主后端）" })).toBeInTheDocument();
    expect(screen.queryByText(/（默认）/)).toBeNull();
  });
});
