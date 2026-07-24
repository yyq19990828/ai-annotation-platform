import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ProjectResponse } from "@/api/projects";
import { ProjectActionsMenu } from "./ProjectActionsMenu";

vi.mock("@/api/maskFormats", () => ({
  maskFormatsApi: { list: vi.fn() },
}));
vi.mock("@/components/mask-formats/MaskFormatImportWizard", () => ({
  MaskFormatImportWizard: () => <div data-testid="mask-import-wizard" />,
}));
vi.mock("@/components/predictions/PredictionImportWizard", () => ({
  PredictionImportWizard: () => null,
}));
vi.mock("@/components/predictions/PredictionPurgeModal", () => ({
  PredictionPurgeModal: () => null,
}));
vi.mock("./ExportModal", () => ({ ExportModal: () => null }));

import { maskFormatsApi } from "@/api/maskFormats";

const project = {
  id: "project-1",
  display_id: "P-1",
  name: "Mask Project",
  type_key: "image-seg",
  type_label: "图像分割",
  data_type: "image",
} as ProjectResponse;

function renderMenu() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ProjectActionsMenu project={project} canManage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("ProjectActionsMenu", () => {
  beforeEach(() => {
    vi.mocked(maskFormatsApi.list).mockReset();
  });

  it("菜单打开后按 registry 已验证能力暴露标注导入", async () => {
    vi.mocked(maskFormatsApi.list).mockResolvedValue([
      {
        format_id: "coco",
        label: "COCO Instance",
        adapter_version: "2.0.0",
        manifest_version: "1",
        media_types: ["image"],
        import_capability: {
          supported: true,
          verified: true,
          enabled_for_ui: true,
        },
        export_capability: {
          supported: true,
          verified: true,
          enabled_for_ui: true,
        },
        option_schema: {},
      },
    ]);
    renderMenu();
    fireEvent.click(screen.getByTitle("更多操作"));

    const importItem = await screen.findByRole("menuitem", { name: "导入标注" });
    expect(maskFormatsApi.list).toHaveBeenCalledWith("project-1");
    fireEvent.click(importItem);
    expect(screen.getByTestId("mask-import-wizard")).toBeInTheDocument();
  });

  it("未验证 adapter 不暴露标注导入", async () => {
    vi.mocked(maskFormatsApi.list).mockResolvedValue([
      {
        format_id: "candidate",
        label: "Candidate",
        adapter_version: "1.0.0",
        manifest_version: "1",
        media_types: ["image"],
        import_capability: {
          supported: true,
          verified: false,
          enabled_for_ui: false,
        },
        export_capability: {
          supported: false,
          verified: false,
          enabled_for_ui: false,
        },
        option_schema: {},
      },
    ]);
    renderMenu();
    fireEvent.click(screen.getByTitle("更多操作"));

    await waitFor(() => expect(maskFormatsApi.list).toHaveBeenCalledOnce());
    expect(screen.queryByRole("menuitem", { name: "导入标注" })).not.toBeInTheDocument();
  });
});
