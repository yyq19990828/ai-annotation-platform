import { describe, expect, it } from "vitest";
import {
  ADMIN_PEOPLE_URL_DEFAULTS,
  adminPeopleUrlCodec,
  parseAdminPeopleUrl,
} from "./adminPeopleUrlState";

describe("Admin people URL state", () => {
  it("accepts explicit default period and sort values", () => {
    expect(parseAdminPeopleUrl("?period=7d&sort=throughput").issues).toEqual([]);
  });

  it("normalizes supported values and preserves unrelated query keys", () => {
    const encoded = adminPeopleUrlCodec.encode(new URLSearchParams("returnTo=%2Fdashboard"), {
      ...ADMIN_PEOPLE_URL_DEFAULTS,
      role: "annotator",
      project: "p1",
      period: "1m",
      sort: "quality",
      q: " Alice ",
    });
    expect(encoded.get("returnTo")).toBe("/dashboard");
    expect(parseAdminPeopleUrl(encoded).state).toEqual({
      role: "annotator",
      project: "p1",
      period: "1m",
      sort: "quality",
      q: "Alice",
    });
  });

  it("falls back to documented defaults for invalid enum values", () => {
    const parsed = parseAdminPeopleUrl("?period=90d&sort=other");
    expect(parsed.state.period).toBe("7d");
    expect(parsed.state.sort).toBe("throughput");
    expect(parsed.issues.map((item) => item.key)).toEqual(["period", "sort"]);
  });
});
