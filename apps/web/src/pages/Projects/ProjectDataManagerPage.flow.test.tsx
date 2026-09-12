import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { updateDataManagerUrl } from "./data-manager/dataManagerUrlState";
import { ProjectDataManagerPage } from "./ProjectDataManagerPage";

const state = vi.hoisted(() => ({ calls: [] as Array<{ enabled: boolean; payload: unknown }> }));

vi.mock("@/hooks/useProjects", () => ({
  useProject: () => ({
    data: { id: "p1", name: "Project", display_id: "P-1", owner_id: "u1" },
    isLoading: false,
    error: null,
  }),
}));

vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: () => ({ role: "annotator" }),
}));

vi.mock("@/stores/authStore", () => ({
  useAuthStore: (selector: (value: { user: { id: string } }) => unknown) =>
    selector({ user: { id: "u1" } }),
}));

vi.mock("@/components/ui/Toast", () => ({
  useToastStore: (selector: (value: { push: () => void }) => unknown) =>
    selector({ push: vi.fn() }),
}));

vi.mock("@/hooks/useTaskViews", () => {
  const schema = {
    entity_scope: "tasks",
    available_entity_scopes: ["tasks"],
    project_kind: { data_type: "image", type_key: "image", scene_mode: false },
    tool_units: [],
    filter_fields: [
      {
        key: "ai.low_confidence_prediction_shape_count",
        label: "低置信候选",
        group: "AI",
        value_type: "number",
        operators: ["gt"],
        options: [],
      },
      {
        key: "task.status",
        label: "任务状态",
        group: "任务",
        value_type: "select",
        operators: ["eq", "in"],
        options: [],
        expensive: false,
        tool_unit_id: null,
        attribute_key: null,
      },
    ],
    columns: [
      {
        key: "display_id",
        label: "任务",
        group: "任务",
        default: true,
        expensive: false,
        sortable: false,
        sort_field: null,
      },
    ],
    default_columns: ["display_id"],
    sort_fields: [{ value: "task.created_at", label: "创建时间" }],
    metrics: [],
    builtin_views: ["all"],
  };
  const views = [
    {
      id: null,
      key: "all",
      project_id: "p1",
      owner_id: null,
      name: "全部任务",
      visibility: "project",
      entity_scope: "tasks",
      filter_json: {},
      sort_json: [{ field: "task.created_at", direction: "asc" }],
      columns_json: ["display_id"],
      builtin: true,
      task_count: 1,
      result_count: 1,
      created_at: null,
      updated_at: null,
      invalid_fields: [],
    },
    {
      id: "v1",
      key: null,
      project_id: "p1",
      owner_id: "u1",
      name: "组合视图",
      visibility: "private",
      entity_scope: "tasks",
      filter_json: {},
      sort_json: [{ field: "task.created_at", direction: "asc" }],
      columns_json: ["display_id"],
      builtin: false,
      task_count: 1,
      result_count: 1,
      created_at: null,
      updated_at: null,
      invalid_fields: [],
    },
  ];
  const taskQuery = (projectId: string, payload: unknown, enabled: boolean) => {
    state.calls.push({ enabled, payload });
    return {
      data: { items: [], total: 0, limit: 50, offset: 0 },
      isLoading: false,
      isError: false,
      isFetching: false,
      refetch: vi.fn(),
    };
  };
  return {
    useTaskViews: () => ({ data: { items: views }, isLoading: false, refetch: vi.fn() }),
    useDataManagerSchema: () => ({ data: schema, isLoading: false, isError: false }),
    useProjectTaskQuery: taskQuery,
    useDataManagerSummary: () => ({ data: undefined, isLoading: false, isFetching: false }),
    useCreateTaskView: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useUpdateTaskView: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useDeleteTaskView: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useDataManagerMatches: () => ({ data: undefined, isLoading: false, isError: false }),
    useDataManagerObjectDetail: () => ({ data: undefined, isLoading: false, isError: false }),
    useDataManagerTrackDetail: () => ({ data: undefined, isLoading: false, isError: false }),
  };
});

describe("ProjectDataManagerPage filter hydration", () => {
  it("adds a typed quick conjunct without removing the same condition from OR", async () => {
    state.calls.length = 0;
    const condition = { field: "ai.low_confidence_prediction_shape_count", op: "gt", value: 0 };
    const filter = {
      op: "or",
      rules: [condition, { field: "task.status", op: "eq", value: "pending" }],
    };
    const search = updateDataManagerUrl("", {
      lens: "tasks",
      view: "builtin:all",
      query: "",
      filter,
      sort: null,
      columns: null,
      selected: null,
    });
    render(
      <MemoryRouter initialEntries={[`/projects/p1/data-manager?${search}`]}>
        <ProjectDataManagerPage />
      </MemoryRouter>,
    );
    await waitFor(() => expect(state.calls.some((call) => call.enabled)).toBe(true));
    const quick = screen.getByRole("button", { name: "低置信" });
    expect(quick).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(quick);
    await waitFor(() => {
      const enabled = state.calls.filter((call) => call.enabled);
      const applied = enabled[enabled.length - 1]?.payload as {
        filter_json: unknown;
      };
      expect(applied.filter_json).toEqual({ op: "and", rules: [filter, condition] });
    });
  });

  it("does not issue the initial query until the saved URL expression is hydrated", async () => {
    state.calls.length = 0;
    const filter = {
      op: "or" as const,
      rules: [
        { field: "task.status", op: "eq" as const, value: "pending" },
        { field: "task.status", op: "eq" as const, value: "review" },
      ],
    };
    const search = updateDataManagerUrl("layout=compact", {
      lens: "tasks",
      view: "saved:v1",
      query: "",
      filter,
      sort: [{ field: "task.created_at", direction: "asc" }],
      columns: ["display_id"],
      selected: null,
    }).toString();
    render(
      <MemoryRouter initialEntries={[`/projects/p1/data-manager?${search}`]}>
        <ProjectDataManagerPage />
      </MemoryRouter>,
    );
    expect(state.calls[0]?.enabled).toBe(false);
    await waitFor(() => expect(state.calls.some((call) => call.enabled)).toBe(true));
    const applied = state.calls.find((call) => call.enabled)?.payload as {
      filter_json: unknown;
    };
    expect(applied.filter_json).toEqual(filter);
  });

  it("falls back from an unknown saved view without issuing a request loop", async () => {
    state.calls.length = 0;
    const search = updateDataManagerUrl("layout=compact", {
      lens: "tasks",
      view: "saved:missing",
      query: "",
      filter: null,
      sort: null,
      columns: null,
      selected: null,
    }).toString();
    render(
      <MemoryRouter initialEntries={[`/projects/p1/data-manager?${search}`]}>
        <ProjectDataManagerPage />
      </MemoryRouter>,
    );
    await waitFor(() => expect(state.calls.some((call) => call.enabled)).toBe(true));
  });
});
