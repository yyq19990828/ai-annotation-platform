import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

const mockUseProject = vi.fn();

vi.mock("@/hooks/useProjects", () => ({
  useProject: (id: string) => mockUseProject(id),
}));

vi.mock("@/hooks/useIsProjectOwner", () => ({
  useIsProjectOwner: () => true,
}));

vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: () => ({ role: "project_admin" }),
}));

vi.mock("./sections/GeneralSection", () => ({
  GeneralSection: () => <div>general-section</div>,
}));
vi.mock("./sections/MembersSection", () => ({
  MembersSection: () => <div>members-section</div>,
}));
vi.mock("./sections/OwnerSection", () => ({
  OwnerSection: () => <div>owner-section</div>,
}));
vi.mock("./sections/DangerSection", () => ({
  DangerSection: () => <div>danger-section</div>,
}));
vi.mock("./sections/BatchesSection", () => ({
  BatchesSection: () => <div>batches-section</div>,
}));
vi.mock("./sections/ClassesSection", () => ({
  ClassesSection: () => <div>classes-section</div>,
}));
vi.mock("./sections/DatasetsSection", () => ({
  DatasetsSection: () => <div>datasets-section</div>,
}));
vi.mock("./sections/MlBackendsSection", () => ({
  MlBackendsSection: () => <div>ml-backends-section</div>,
}));
vi.mock("./sections/RenderingConfigSection", () => ({
  RenderingConfigSection: () => <div>rendering-section</div>,
}));
vi.mock("./sections/VideoSamplingSection", () => ({
  VideoSamplingSection: () => <div>video-sampling-section</div>,
}));
vi.mock("./sections/AnnotationGuideSection", () => ({
  AnnotationGuideSection: () => <div>annotation-guide-section</div>,
}));

import { ProjectSettingsPage } from "./ProjectSettingsPage";

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}{location.search}</div>;
}

function renderSettingsPage(project: Record<string, unknown>) {
  mockUseProject.mockReturnValue({
    data: project,
    isLoading: false,
    error: null,
  });
  return render(
    <MemoryRouter initialEntries={[`/projects/${project.id}/settings`]}>
      <Routes>
        <Route path="/projects/:id/settings" element={<ProjectSettingsPage />} />
        <Route
          path="/projects/:id/annotate"
          element={(
            <>
              <div>workbench-target</div>
              <LocationProbe />
            </>
          )}
        />
      </Routes>
    </MemoryRouter>,
  );
}

function renderSettingsPageAt(project: Record<string, unknown>, path: string) {
  mockUseProject.mockReturnValue({
    data: project,
    isLoading: false,
    error: null,
  });
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/projects/:id/settings" element={<ProjectSettingsPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("ProjectSettingsPage", () => {
  beforeEach(() => {
    mockUseProject.mockReset();
  });

  it("shows the workbench entry for video projects", () => {
    renderSettingsPage({
      id: "p-video",
      name: "Video Project",
      display_id: "P-VIDEO",
      type_label: "视频项目",
      type_key: "video-track",
      data_type: "video",
      status: "in_progress",
    });

    fireEvent.click(screen.getByRole("button", { name: /打开工作台/ }));

    expect(screen.getByText("workbench-target")).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent(
      "/projects/p-video/annotate?returnTo=%2Fprojects%2Fp-video%2Fsettings",
    );
  });

  it("shows the workbench entry for point cloud projects", () => {
    renderSettingsPage({
      id: "p-lidar",
      name: "Point Cloud Project",
      display_id: "P-LIDAR",
      type_label: "3D 点云",
      type_key: "lidar",
      data_type: "lidar",
      status: "in_progress",
    });

    fireEvent.click(screen.getByRole("button", { name: /打开工作台/ }));

    expect(screen.getByText("workbench-target")).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent(
      "/projects/p-lidar/annotate?returnTo=%2Fprojects%2Fp-lidar%2Fsettings",
    );
  });

  it("uses one combined classes and attributes settings tab", () => {
    renderSettingsPage({
      id: "p-image",
      name: "Image Project",
      display_id: "P-IMAGE",
      type_label: "图像检测",
      type_key: "image-det",
      data_type: "image",
      status: "in_progress",
    });

    expect(screen.getByTestId("settings-tab-classes")).toHaveTextContent("类别与属性");
    expect(screen.queryByTestId("settings-tab-attributes")).toBeNull();
  });

  it("maps old section=attributes links to the combined tab", () => {
    renderSettingsPageAt(
      {
        id: "p-image",
        name: "Image Project",
        display_id: "P-IMAGE",
        type_label: "图像检测",
        type_key: "image-det",
        data_type: "image",
        status: "in_progress",
      },
      "/projects/p-image/settings?section=attributes",
    );

    expect(screen.getByText("classes-section")).toBeInTheDocument();
  });
});
