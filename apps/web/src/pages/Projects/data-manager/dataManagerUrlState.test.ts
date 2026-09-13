import { describe, expect, it } from "vitest";

import {
  hasFilterUrlOverrides,
  parseDataManagerUrl,
  parseDataManagerUrlWithIssues,
  resolveDataManagerSort,
  updateDataManagerUrl,
} from "./dataManagerUrlState";

describe("Data Manager URL state", () => {
  it("round-trips all three lens states while preserving unrelated params", () => {
    for (const lens of ["tasks", "objects", "tracks"] as const) {
      const params = updateDataManagerUrl("keep=1", {
        lens,
        view: "builtin:all",
        query: "car / red",
        filter: { op: "and", rules: [] },
        sort: [{ field: "annotation.updated_at", direction: "desc" }],
        columns: ["class_name", "attributes"],
        selected: "实体 / 中文",
      });
      expect(params.get("keep")).toBe("1");
      expect(parseDataManagerUrl(params)).toEqual({
        lens,
        view: "builtin:all",
        query: "car / red",
        filter: { op: "and", rules: [] },
        sort: [{ field: "annotation.updated_at", direction: "desc" }],
        columns: ["class_name", "attributes"],
        selected: "实体 / 中文",
      });
    }
  });

  it("round-trips project sections, gallery layout and capped task selection", () => {
    const taskIds = Array.from({ length: 205 }, (_, index) => `task-${index}`);
    const params = updateDataManagerUrl("keep=1", {
      section: "members",
      lens: "tasks",
      view: "builtin:all",
      query: "",
      filter: null,
      sort: null,
      columns: null,
      selected: null,
      selectedTasks: taskIds,
      layout: "gallery",
    });
    const state = parseDataManagerUrl(params);
    expect(state.section).toBe("members");
    expect(state.layout).toBe("gallery");
    expect(state.selectedTasks).toHaveLength(200);
    expect(state.selectedTasks?.[199]).toBe("task-199");
    expect(params.get("keep")).toBe("1");
  });

  it("reports malformed task selection entries instead of hiding them", () => {
    const params = updateDataManagerUrl("", {
      lens: "tasks",
      view: "builtin:all",
      query: "",
      filter: null,
      sort: null,
      columns: null,
      selected: null,
      selectedTasks: ["task-1", ""],
    });
    expect(parseDataManagerUrlWithIssues(params).issues).toEqual([
      { key: "selected_tasks", message: "任务选择包含无效任务 ID" },
    ]);
  });

  it("falls back safely for invalid lens and malformed JSON", () => {
    const state = parseDataManagerUrl("lens=other&filter=%7Bbad&columns=1");
    expect(state.lens).toBe("tasks");
    expect(state.filter).toBeNull();
    expect(state.columns).toBeNull();
  });

  it("preserves an explicit empty filter envelope and reports malformed state", () => {
    const params = updateDataManagerUrl("layout=compact", {
      lens: "tasks",
      view: "saved:1",
      query: "",
      filter: {},
      sort: null,
      columns: null,
      selected: null,
    });
    expect(params.get("layout")).toBe("compact");
    expect(params.has("q")).toBe(false);
    expect(params.has("filter")).toBe(true);
    expect(hasFilterUrlOverrides("lens=tasks&selected=t1")).toBe(false);
    expect(parseDataManagerUrl(params).filter).toEqual({});
    expect(parseDataManagerUrlWithIssues("filter=%7Bbad").issues).toHaveLength(1);
  });

  it("uses the view sort when a short URL has no sort or carries another lens sort", () => {
    const viewSort = [{ field: "track.track_id", direction: "asc" }] as const;
    expect(
      resolveDataManagerSort(null, [...viewSort], ["track.track_id"], "track.track_id"),
    ).toEqual(viewSort);
    expect(
      resolveDataManagerSort(
        [{ field: "annotation.updated_at", direction: "desc" }],
        [...viewSort],
        ["track.track_id"],
        "track.track_id",
      ),
    ).toEqual(viewSort);
  });
});
