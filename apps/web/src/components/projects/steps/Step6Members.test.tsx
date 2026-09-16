import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";

const mockUseUsers = vi.fn();

vi.mock("@/hooks/useUsers", () => ({
  useUsers: (...args: unknown[]) => mockUseUsers(...args),
}));

vi.mock("@/hooks/useProjects", () => ({
  useAddProjectMember: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock("@/components/ui/Toast", async () => {
  const actual =
    await vi.importActual<typeof import("@/components/ui/Toast")>("@/components/ui/Toast");
  return {
    ...actual,
    useToastStore: <T,>(sel: (s: { push: (...args: unknown[]) => void }) => T) =>
      sel({ push: vi.fn() }),
  };
});

import { Step6Members } from "./Step6Members";
import type { FormState } from "../CreateProjectWizard";
import type { ProjectResponse } from "@/api/projects";

const baseForm: FormState = {
  name: "p",
  dataType: "lidar",
  typeKey: "lidar",
  dueDate: "",
  unitBindings: {},
  activeUnit: "lidar_box_3d",
  aiEnabled: false,
  mlBackendSourceId: "",
  sceneMode: true,
  datasetIds: [],
  splitStrategy: "by_scene",
  splitNBatches: 0,
  members: [],
  copyAnnotationGuide: true,
};

const user = (id: string, name: string, role: string) => ({
  id,
  name,
  email: `${id}@example.com`,
  role,
  is_active: true,
  status: "offline",
  group_id: null,
  group_name: null,
  created_at: `2026-01-0${id.slice(-1)}T00:00:00Z`,
});

function Harness() {
  const [form, setForm] = useState<FormState>(baseForm);
  return (
    <Step6Members
      project={
        {
          id: "p1",
          display_id: "P-1",
          name: "project",
          type_key: "lidar",
          type_label: "点云",
          data_type: "lidar",
          scene_mode: true,
        } as unknown as ProjectResponse
      }
      form={form}
      setForm={setForm}
      onNext={vi.fn()}
    />
  );
}

describe("Step6Members", () => {
  beforeEach(() => {
    mockUseUsers.mockReset();
  });

  it("按角色分两次取候选人（annotator / reviewer），与指派弹窗一致", () => {
    mockUseUsers.mockImplementation((params?: { role?: string }) => ({
      data:
        params?.role === "annotator"
          ? [user("a1", "Free Annotator", "annotator")]
          : [user("r1", "Free Reviewer", "reviewer")],
      isLoading: false,
    }));
    render(<Harness />);

    expect(mockUseUsers).toHaveBeenCalledWith({ role: "annotator" });
    expect(mockUseUsers).toHaveBeenCalledWith({ role: "reviewer" });
    expect(screen.getByText("Free Annotator")).toBeInTheDocument();
    expect(screen.getByText("Free Reviewer")).toBeInTheDocument();
  });

  it("两个角色查询结果按 id 去重合并", () => {
    const shared = user("a1", "Dual Role", "annotator");
    mockUseUsers.mockImplementation(() => ({
      data: [shared, user("r1", "Free Reviewer", "reviewer")],
      isLoading: false,
    }));
    render(<Harness />);

    expect(screen.getAllByText("Dual Role")).toHaveLength(1);
    expect(screen.getByText("Free Reviewer")).toBeInTheDocument();
  });

  it("无候选人时显示空态提示", () => {
    mockUseUsers.mockReturnValue({ data: [], isLoading: false });
    render(<Harness />);
    expect(screen.getByText(/暂无 annotator \/ reviewer 角色的用户/)).toBeInTheDocument();
  });

  it("点击候选人写入表单成员", () => {
    mockUseUsers.mockImplementation((params?: { role?: string }) => ({
      data: params?.role === "annotator" ? [user("a1", "Free Annotator", "annotator")] : [],
      isLoading: false,
    }));
    render(<Harness />);
    fireEvent.click(screen.getByText("Free Annotator"));
    // 选中态按钮显示已选
    expect(screen.getByText(/添加 1 位并完成/)).toBeInTheDocument();
  });
});
