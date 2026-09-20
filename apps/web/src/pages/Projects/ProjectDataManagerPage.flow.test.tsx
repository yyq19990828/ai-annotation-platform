import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { updateDataManagerUrl } from "./data-manager/dataManagerUrlState";
import { ProjectDataManagerPage } from "./ProjectDataManagerPage";

const state = vi.hoisted(() => ({
  navigationSelections: [] as Array<string | null>,
  calls: [] as Array<{ enabled: boolean; payload: unknown }>,
  extraViews: [] as Array<Record<string, unknown>>,
  taskItems: [] as Array<Record<string, unknown>>,
  taskLookup: null as {
    id: string;
    project_id: string;
    display_id: string;
    file_name: string;
  } | null,
  pendingTaskLookups: new Set<string>(),
  taskLookups: new Map<
    string,
    { id: string; project_id: string; display_id: string; file_name: string }
  >(),
  schemaError: false,
  schemaRefetch: vi.fn(),
  viewsRefetch: vi.fn(),
  createView: vi.fn(),
  updateView: vi.fn(),
}));

function LocationProbe() {
  const location = useLocation();
  state.navigationSelections.push(new URLSearchParams(location.search).get("selected"));
  return <output data-testid="location">{location.search}</output>;
}

function HistoryProbe() {
  const navigate = useNavigate();
  return (
    <>
      <button type="button" onClick={() => navigate(-1)}>
        back
      </button>
      <button type="button" onClick={() => navigate(1)}>
        forward
      </button>
    </>
  );
}

function ExternalViewProbe() {
  const navigate = useNavigate();
  return (
    <button
      type="button"
      data-testid="external-view"
      onClick={() => navigate("/projects/p1/data-manager?lens=tasks&view=saved:v1")}
    >
      external
    </button>
  );
}

function currentView() {
  return new URL(
    "http://localhost" + document.querySelector('[data-testid="location"]')?.textContent,
  ).searchParams.get("view");
}

vi.mock("@/hooks/useProjects", () => ({
  useProject: () => ({
    data: { id: "p1", name: "Project", display_id: "P-1", owner_id: "u1" },
    isLoading: false,
    error: null,
  }),
}));

vi.mock("@/hooks/useProjectAccess", () => ({
  useProjectAccess: () => ({
    // The members section is gated on performance.read; these flows exercise
    // an authorized manager, so the capability must resolve to true.
    hasCapability: (capability: string) => capability === "performance.read",
    capabilities: new Set<string>(["performance.read"]),
    access: undefined,
    projectRole: null,
    membershipVersion: null,
    isManager: false,
    isPending: false,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

vi.mock("@/hooks/useTasks", () => ({
  useTask: (id: string) => ({
    data: state.taskLookups.get(id) ?? state.taskLookup,
    isLoading: state.pendingTaskLookups.has(id),
    isError: false,
  }),
}));

vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: () => ({ role: "employee" }),
}));

vi.mock("@/stores/authStore", () => ({
  useAuthStore: (selector: (value: { user: { id: string } }) => unknown) =>
    selector({ user: { id: "u1" } }),
}));

vi.mock("@/components/ui/Toast", () => ({
  useToastStore: (selector: (value: { push: () => void }) => unknown) =>
    selector({ push: vi.fn() }),
}));

vi.mock("./data-manager/ProjectMembersPerformance", () => ({
  ProjectMembersPerformance: ({ projectId }: { projectId: string }) => (
    <div data-testid="project-members">Members for {projectId}</div>
  ),
  ProjectPerformanceSummary: ({ onOpenMembers }: { onOpenMembers: () => void }) => (
    <button type="button" onClick={onOpenMembers}>
      成员看板
    </button>
  ),
}));

vi.mock("./data-manager/DataManagerTaskActions", () => ({
  DataManagerTaskActions: ({
    taskIds,
    onCompleted,
  }: {
    taskIds: string[];
    onCompleted: () => void;
  }) => (
    <button data-testid="task-actions" onClick={onCompleted} disabled={!taskIds.length}>
      Operate {taskIds.join(",")}
    </button>
  ),
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
      {
        key: "task.assignee",
        label: "标注员",
        group: "人员",
        value_type: "text",
        operators: ["eq"],
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
      {
        key: "unresolved_issue_count",
        label: "未解决问题",
        group: "质量",
        default: true,
        expensive: true,
        sortable: true,
        sort_field: "unresolved_issue_count",
      },
      {
        key: "comment_count",
        label: "评论",
        group: "讨论",
        default: true,
        expensive: true,
        sortable: true,
        sort_field: "comment_count",
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
    {
      id: "v2",
      key: null,
      project_id: "p1",
      owner_id: "u1",
      name: "第二视图",
      visibility: "private",
      entity_scope: "tasks",
      filter_json: { field: "task.status", op: "eq", value: "pending" },
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
      data: { items: state.taskItems, total: state.taskItems.length, limit: 50, offset: 0 },
      isLoading: false,
      isError: false,
      isFetching: false,
      refetch: vi.fn(),
    };
  };
  return {
    useTaskViews: () => ({
      data: { items: [...views, ...state.extraViews] },
      isLoading: false,
      refetch: state.viewsRefetch,
    }),
    useDataManagerSchema: () => ({
      data: schema,
      isLoading: false,
      isError: state.schemaError,
      refetch: state.schemaRefetch,
    }),
    useProjectTaskQuery: taskQuery,
    useDataManagerSummary: () => ({ data: undefined, isLoading: false, isFetching: false }),
    useCreateTaskView: () => ({ mutateAsync: state.createView, isPending: false }),
    useUpdateTaskView: () => ({ mutateAsync: state.updateView, isPending: false }),
    useDeleteTaskView: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useDataManagerMatches: () => ({ data: undefined, isLoading: false, isError: false }),
    useDataManagerObjectDetail: () => ({ data: undefined, isLoading: false, isError: false }),
    useDataManagerTrackDetail: () => ({ data: undefined, isLoading: false, isError: false }),
  };
});

beforeEach(() => {
  state.calls.length = 0;
  state.extraViews = [];
  state.taskItems = [];
  state.taskLookup = null;
  state.taskLookups.clear();
  state.pendingTaskLookups.clear();
  state.navigationSelections.length = 0;
  state.schemaError = false;
  state.schemaRefetch.mockReset();
  state.viewsRefetch.mockReset().mockResolvedValue(undefined);
  state.createView.mockReset();
  state.updateView.mockReset();
});

describe("ProjectDataManagerPage filter hydration", () => {
  it("opens project members without mounting a task query that rewrites the section", async () => {
    render(
      <MemoryRouter initialEntries={["/projects/p1/data-manager?section=members&keep=yes"]}>
        <LocationProbe />
        <Routes>
          <Route path="/projects/:id/data-manager" element={<ProjectDataManagerPage />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByTestId("project-members")).toHaveTextContent("Members for p1");
    expect(screen.getByTestId("location")).toHaveTextContent("section=members");
    expect(screen.getByTestId("location")).toHaveTextContent("keep=yes");
    expect(state.calls).toEqual([]);
  });

  it("opens the project members from the period summary in overview", async () => {
    render(
      <MemoryRouter initialEntries={["/projects/p1/data-manager?section=overview"]}>
        <Routes>
          <Route path="/projects/:id/data-manager" element={<ProjectDataManagerPage />} />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("button", { name: "成员看板" }));
    expect(await screen.findByTestId("project-members")).toHaveTextContent("Members for p1");
  });

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

  it("preserves a saved keyword when layout or sort is overridden in the URL", async () => {
    state.extraViews = [
      {
        id: "keyword-view",
        key: null,
        project_id: "p1",
        owner_id: "u1",
        name: "关键字视图",
        visibility: "private",
        entity_scope: "tasks",
        filter_json: { field: "task.keyword", op: "contains", value: "needle" },
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
    const search = updateDataManagerUrl("", {
      lens: "tasks",
      view: "saved:keyword-view",
      query: "",
      filter: null,
      sort: [{ field: "task.created_at", direction: "desc" }],
      columns: null,
      selected: null,
      layout: "gallery",
    }).toString();
    render(
      <MemoryRouter initialEntries={[`/projects/p1/data-manager?${search}`]}>
        <ProjectDataManagerPage />
      </MemoryRouter>,
    );
    await waitFor(() => expect(state.calls.some((call) => call.enabled)).toBe(true));
    const enabled = state.calls.filter((call) => call.enabled);
    expect((enabled[enabled.length - 1]?.payload as { filter_json: unknown }).filter_json).toEqual({
      field: "task.keyword",
      op: "contains",
      value: "needle",
    });
  });

  it("hydrates a selected task outside the first page through the task API", async () => {
    state.taskLookup = {
      id: "task-deep",
      project_id: "p1",
      display_id: "T-deep",
      file_name: "deep.png",
    };
    const search = updateDataManagerUrl("", {
      lens: "tasks",
      view: "builtin:all",
      query: "",
      filter: null,
      sort: null,
      columns: null,
      selected: "task-deep",
    }).toString();
    render(
      <MemoryRouter initialEntries={[`/projects/p1/data-manager?${search}`]}>
        <ProjectDataManagerPage />
      </MemoryRouter>,
    );
    expect(await screen.findByRole("heading", { name: "T-deep" })).toBeInTheDocument();
  });

  it.each(["cached", "pending"])(
    "keeps same-route external task selections authoritative with a %s lookup",
    async (lookup) => {
      for (const suffix of ["a", "b"]) {
        state.taskLookups.set(`task-${suffix}`, {
          id: `task-${suffix}`,
          project_id: "p1",
          display_id: `T-${suffix}`,
          file_name: `${suffix}.png`,
        });
      }
      function ExternalSelectionProbe() {
        const location = useLocation();
        const navigate = useNavigate();
        const select = (id: string | null) => {
          const next = new URLSearchParams(location.search);
          if (id) next.set("selected", id);
          else next.delete("selected");
          navigate(`${location.pathname}?${next}`);
        };
        return (
          <>
            <button onClick={() => select("task-b")}>Select B through URL</button>
            <button onClick={() => select(null)}>Clear selection through URL</button>
          </>
        );
      }
      const ui = () => (
        <MemoryRouter
          initialEntries={["/projects/p1/data-manager?lens=tasks&view=builtin:all&selected=task-a"]}
        >
          <LocationProbe />
          <HistoryProbe />
          <ExternalSelectionProbe />
          <Routes>
            <Route path="/projects/:id/data-manager" element={<ProjectDataManagerPage />} />
          </Routes>
        </MemoryRouter>
      );
      const view = render(ui());
      expect(await screen.findByRole("heading", { name: "T-a" })).toBeInTheDocument();
      const taskB = state.taskLookups.get("task-b")!;
      if (lookup === "pending") {
        state.taskLookups.delete("task-b");
        state.pendingTaskLookups.add("task-b");
      }
      state.navigationSelections.length = 0;
      fireEvent.click(screen.getByText("Select B through URL"));
      expect(state.navigationSelections).toEqual(["task-b"]);
      if (lookup === "pending") {
        expect(screen.queryByRole("heading", { name: "T-a" })).not.toBeInTheDocument();
        state.taskLookups.set("task-b", taskB);
        state.pendingTaskLookups.clear();
        view.rerender(ui());
      }
      expect(await screen.findByRole("heading", { name: "T-b" })).toBeInTheDocument();
      expect(new URLSearchParams(screen.getByTestId("location").textContent!).get("selected")).toBe(
        "task-b",
      );
      state.navigationSelections.length = 0;
      fireEvent.click(screen.getByText("back"));
      expect(state.navigationSelections).toEqual(["task-a"]);
      expect(await screen.findByRole("heading", { name: "T-a" })).toBeInTheDocument();
      state.navigationSelections.length = 0;
      fireEvent.click(screen.getByText("forward"));
      expect(state.navigationSelections).toEqual(["task-b"]);
      expect(await screen.findByRole("heading", { name: "T-b" })).toBeInTheDocument();
      state.navigationSelections.length = 0;
      fireEvent.click(screen.getByText("Clear selection through URL"));
      expect(state.navigationSelections).toEqual([null]);
      expect(screen.queryByRole("heading", { name: "T-b" })).not.toBeInTheDocument();
    },
  );

  it("clears the selected task deep link when the detail sheet closes", async () => {
    state.taskLookup = {
      id: "task-selected",
      project_id: "p1",
      display_id: "T-selected",
      file_name: "selected.png",
    };
    const search = updateDataManagerUrl("", {
      lens: "tasks",
      view: "builtin:all",
      query: "",
      filter: null,
      sort: null,
      columns: ["display_id"],
      selected: "task-selected",
    }).toString();
    render(
      <MemoryRouter initialEntries={[`/projects/p1/data-manager?${search}`]}>
        <LocationProbe />
        <Routes>
          <Route path="/projects/:id/data-manager" element={<ProjectDataManagerPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByRole("heading", { name: "T-selected" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => {
      expect(
        new URLSearchParams(screen.getByTestId("location").textContent ?? "").get("selected"),
      ).toBeNull();
    });
  });

  it("does not open task detail when the gallery checkbox label is clicked", async () => {
    state.taskItems = [
      {
        id: "task-gallery",
        project_id: "p1",
        display_id: "T-gallery",
        file_name: "gallery.bin",
        file_type: "point_cloud",
        status: "pending",
        annotation_count: 0,
        unresolved_feedback_count: 0,
        unresolved_issue_count: 0,
        comment_count: 0,
        assignee: null,
        thumbnail_url: null,
        blurhash: null,
      },
    ];
    const search = updateDataManagerUrl("", {
      lens: "tasks",
      view: "builtin:all",
      query: "",
      filter: null,
      sort: null,
      columns: ["display_id"],
      selected: null,
      layout: "gallery",
    }).toString();
    render(
      <MemoryRouter initialEntries={[`/projects/p1/data-manager?${search}`]}>
        <ProjectDataManagerPage />
      </MemoryRouter>,
    );
    const checkbox = await screen.findByRole("checkbox", { name: "选择任务 T-gallery" });
    const galleryCalls = state.calls.filter((call) => call.enabled);
    expect(galleryCalls[galleryCalls.length - 1]?.payload).toMatchObject({
      columns_json: ["display_id", "annotation_count", "unresolved_issue_count", "comment_count"],
    });
    expect(screen.getByLabelText("任务画廊").parentElement).toHaveClass("min-h-[280px]");
    fireEvent.click(checkbox.parentElement!);
    fireEvent.keyDown(checkbox, { key: " " });
    fireEvent.keyDown(checkbox, { key: "Enter" });
    expect(screen.queryByRole("heading", { name: "T-gallery" })).not.toBeInTheDocument();
    expect(screen.getByRole("img", { name: "点云数据" })).toHaveTextContent("点云");
    fireEvent.click(screen.getByRole("button", { name: "列表视图" }));
    const listCalls = state.calls.filter((call) => call.enabled);
    expect(listCalls[listCalls.length - 1]?.payload).toMatchObject({
      columns_json: ["display_id"],
    });
    fireEvent.keyDown(screen.getByRole("checkbox", { name: "选择任务 T-gallery" }), { key: " " });
    expect(screen.queryByRole("heading", { name: "T-gallery" })).not.toBeInTheDocument();
    expect(screen.getByRole("img", { name: "点云数据" })).toHaveTextContent("点云");
  });

  it("normalizes a legacy feedback column and renders issue and comment columns", async () => {
    state.taskItems = [
      {
        id: "task-cols",
        project_id: "p1",
        display_id: "T-cols",
        file_name: "cols.png",
        file_type: "image",
        status: "pending",
        annotation_count: 0,
        unresolved_feedback_count: 1,
        unresolved_issue_count: 1,
        comment_count: 4,
        annotation_source_counts: {
          manual: 0,
          prediction_based: 0,
          ai_tracker: 0,
          interpolated: 0,
        },
        track_count: 0,
        pending_prediction_shape_count: 0,
        low_confidence_prediction_shape_count: 0,
        pending_tracker_job_count: 0,
        last_activity_at: null,
        assignee: null,
        thumbnail_url: null,
        blurhash: null,
      },
    ];
    const search = updateDataManagerUrl("", {
      lens: "tasks",
      view: "builtin:all",
      query: "",
      filter: null,
      sort: null,
      columns: ["display_id", "unresolved_feedback_count", "comment_count"],
      selected: null,
    }).toString();
    render(
      <MemoryRouter initialEntries={[`/projects/p1/data-manager?${search}`]}>
        <ProjectDataManagerPage />
      </MemoryRouter>,
    );
    await waitFor(() => expect(state.calls.some((call) => call.enabled)).toBe(true));
    // The legacy feedback column is normalized onto the issue column once.
    expect(screen.getAllByRole("columnheader", { name: "未解决问题" })).toHaveLength(1);
    expect(screen.getByRole("columnheader", { name: "评论" })).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "反馈" })).not.toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "任务" })).toBeInTheDocument();
    // The plan example: 未解决问题 1 / 评论 4.
    const row = screen.getByRole("row", { name: /T-cols/ });
    expect(within(row).getByText("4")).toBeInTheDocument();
    expect(within(row).getByText("1")).toBeInTheDocument();
    // The query requests the normalized column set.
    const enabled = state.calls.filter((call) => call.enabled);
    expect(
      (enabled[enabled.length - 1]?.payload as { columns_json: string[] }).columns_json,
    ).toEqual(["display_id", "unresolved_issue_count", "comment_count"]);
  });

  it("offers a retry action when the task schema request fails", () => {
    state.schemaError = true;
    render(
      <MemoryRouter initialEntries={["/projects/p1/data-manager?lens=tasks"]}>
        <ProjectDataManagerPage />
      </MemoryRouter>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("无法加载 Data Manager 筛选字段");
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(state.schemaRefetch).toHaveBeenCalledOnce();
  });

  it("falls back from an invalid saved task sort before querying", async () => {
    state.extraViews = [
      {
        id: "stale-sort",
        key: null,
        project_id: "p1",
        owner_id: "u1",
        name: "失效排序视图",
        visibility: "private",
        entity_scope: "tasks",
        filter_json: {},
        sort_json: [{ field: "removed.sort", direction: "desc" }],
        columns_json: ["display_id"],
        builtin: false,
        task_count: 1,
        result_count: 1,
        created_at: null,
        updated_at: null,
        invalid_fields: [],
      },
    ];
    render(
      <MemoryRouter initialEntries={["/projects/p1/data-manager?lens=tasks&view=saved:stale-sort"]}>
        <ProjectDataManagerPage />
      </MemoryRouter>,
    );
    await waitFor(() => expect(state.calls.some((call) => call.enabled)).toBe(true));
    const enabled = state.calls.filter((call) => call.enabled);
    expect((enabled[enabled.length - 1]?.payload as { sort_json: unknown }).sort_json).toEqual([
      { field: "task.created_at", direction: "asc" },
    ]);
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

  it("does not query after adding a new text condition without a value", async () => {
    state.calls.length = 0;
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/projects/p1/data-manager?lens=tasks"]}>
        <ProjectDataManagerPage />
      </MemoryRouter>,
    );
    await waitFor(() => expect(state.calls.some((call) => call.enabled)).toBe(true));
    const enabledBefore = state.calls.filter((call) => call.enabled).length;
    await user.click(screen.getByRole("button", { name: "筛选" }));
    await user.click(screen.getByRole("button", { name: /标注员 task\.assignee/ }));
    expect(
      screen.getByText("当前筛选包含未完成或 schema 中不存在的条件，完成编辑后才会查询。"),
    ).toBeInTheDocument();
    expect(state.calls.filter((call) => call.enabled).length).toBe(enabledBefore);
    expect(screen.getByRole("button", { name: "刷新" })).toBeDisabled();
  });

  it("bounds a deeply nested URL filter before rendering the editor", async () => {
    state.calls.length = 0;
    let filter: Record<string, unknown> = {
      field: "task.status",
      op: "eq",
      value: "pending",
    };
    for (let index = 0; index < 1000; index += 1) {
      filter = { op: "and", rules: [filter] };
    }
    const search = updateDataManagerUrl("", {
      lens: "tasks",
      view: "builtin:all",
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
    await waitFor(() => expect(screen.getByText(/筛选条件嵌套超过/)).toBeInTheDocument());
    expect(state.calls.some((call) => call.enabled)).toBe(false);
    expect(screen.getByRole("button", { name: "刷新" })).toBeDisabled();
  });

  it("keeps a newly created view selected after refetch", async () => {
    const user = userEvent.setup();
    const filter = {
      op: "or",
      rules: [
        { field: "task.status", op: "eq", value: "pending" },
        { field: "ai.low_confidence_prediction_shape_count", op: "gt", value: 0 },
      ],
    };
    const createdView = {
      id: "v-created",
      key: null,
      project_id: "p1",
      owner_id: "u1",
      name: "新视图",
      visibility: "private",
      entity_scope: "tasks",
      filter_json: filter,
      sort_json: [{ field: "task.created_at", direction: "asc" }],
      columns_json: ["display_id"],
      builtin: false,
      task_count: 1,
      result_count: 1,
      created_at: null,
      updated_at: null,
      invalid_fields: [],
    };
    state.createView.mockResolvedValue({ id: createdView.id });
    state.viewsRefetch.mockImplementation(async () => {
      state.extraViews = [createdView];
    });
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
        <LocationProbe />
      </MemoryRouter>,
    );
    await waitFor(() => expect(state.calls.some((call) => call.enabled)).toBe(true));
    await user.click(screen.getByRole("button", { name: "保存视图" }));
    const nameInput = screen.getByRole("textbox");
    await user.clear(nameInput);
    await user.type(nameInput, createdView.name);
    await user.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(currentView()).toBe("saved:v-created"));
    expect(screen.getAllByText(createdView.name, { exact: true }).length).toBeGreaterThan(0);
    expect(state.createView).toHaveBeenCalledWith(
      expect.objectContaining({ entity_scope: "tasks", filter_json: filter }),
    );
  });

  it("hydrates the selected view after navigation and browser history", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/projects/p1/data-manager?lens=tasks&view=saved:v1"]}>
        <ProjectDataManagerPage />
        <LocationProbe />
        <HistoryProbe />
      </MemoryRouter>,
    );
    await waitFor(() => expect(state.calls.some((call) => call.enabled)).toBe(true));
    await user.click(screen.getByRole("button", { name: /^第二视图/ }));
    await waitFor(() => expect(currentView()).toBe("saved:v2"));
    await waitFor(() => {
      const enabled = state.calls.filter((call) => call.enabled);
      expect(
        (enabled[enabled.length - 1]?.payload as { filter_json: unknown }).filter_json,
      ).toEqual({
        field: "task.status",
        op: "eq",
        value: "pending",
      });
    });
    await user.click(screen.getByRole("button", { name: "back" }));
    await waitFor(() => expect(currentView()).toBe("saved:v1"));
    await waitFor(() => {
      const enabled = state.calls.filter((call) => call.enabled);
      expect(
        (enabled[enabled.length - 1]?.payload as { filter_json: unknown }).filter_json,
      ).toEqual({});
    });
    await user.click(screen.getByRole("button", { name: "forward" }));
    await waitFor(() => expect(currentView()).toBe("saved:v2"));
    await waitFor(() => {
      const enabled = state.calls.filter((call) => call.enabled);
      expect(
        (enabled[enabled.length - 1]?.payload as { filter_json: unknown }).filter_json,
      ).toEqual({
        field: "task.status",
        op: "eq",
        value: "pending",
      });
    });
  });

  it("does not let a completed create navigate after the owner changed", async () => {
    const user = userEvent.setup();
    let resolveCreate!: (value: { id: string }) => void;
    state.createView.mockImplementation(
      () => new Promise<{ id: string }>((resolve) => (resolveCreate = resolve)),
    );
    render(
      <MemoryRouter initialEntries={["/projects/p1/data-manager?lens=tasks"]}>
        <ProjectDataManagerPage />
        <LocationProbe />
        <ExternalViewProbe />
      </MemoryRouter>,
    );
    await waitFor(() => expect(state.calls.some((call) => call.enabled)).toBe(true));
    await user.click(screen.getByRole("button", { name: "保存视图" }));
    const nameInput = screen.getByRole("textbox");
    await user.clear(nameInput);
    await user.type(nameInput, "异步视图");
    await user.click(screen.getByRole("button", { name: "保存" }));
    fireEvent.click(screen.getByTestId("external-view"));
    await waitFor(() => expect(currentView()).toBe("saved:v1"));
    await act(async () => {
      resolveCreate({ id: "v-created" });
      await Promise.resolve();
    });
    expect(currentView()).toBe("saved:v1");
  });
});
