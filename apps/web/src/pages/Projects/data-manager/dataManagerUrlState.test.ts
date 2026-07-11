import { describe, expect, it } from "vitest";

import {
  parseDataManagerUrl,
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

  it("falls back safely for invalid lens and malformed JSON", () => {
    const state = parseDataManagerUrl("lens=other&filter=%7Bbad&columns=1");
    expect(state.lens).toBe("tasks");
    expect(state.filter).toBeNull();
    expect(state.columns).toBeNull();
  });

  it("uses the view sort when a short URL has no sort or carries another lens sort", () => {
    const viewSort = [{ field: "track.track_id", direction: "asc" }] as const;
    expect(resolveDataManagerSort(null, [...viewSort], ["track.track_id"], "track.track_id"))
      .toEqual(viewSort);
    expect(resolveDataManagerSort(
      [{ field: "annotation.updated_at", direction: "desc" }],
      [...viewSort],
      ["track.track_id"],
      "track.track_id",
    )).toEqual(viewSort);
  });
});
