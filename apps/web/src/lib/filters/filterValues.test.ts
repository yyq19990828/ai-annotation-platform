import { describe, expect, it } from "vitest";

import type { DataManagerFilterField } from "@/api/taskViews";
import { formatFilterDraft, parseFilterValue, splitFilterValues } from "./filterValues";

const field = (value_type: DataManagerFilterField["value_type"]): DataManagerFilterField => ({
  key: "value",
  label: "值",
  group: "测试",
  value_type,
  operators: ["eq", "in", "between"],
  options: [],
  expensive: false,
  tool_unit_id: null,
  attribute_key: null,
});
describe("filter values", () => {
  it("round-trips zero, false, and comma-containing list values", () => {
    expect(parseFilterValue(field("number"), "eq", "0")).toEqual({ ok: true, value: 0 });
    expect(parseFilterValue(field("boolean"), "eq", "false")).toEqual({ ok: true, value: false });
    const draft = formatFilterDraft(["a,b", "c"], field("text"), "in");
    expect(draft).toBe('"a,b", c');
    expect(parseFilterValue(field("text"), "in", draft)).toEqual({
      ok: true,
      value: ["a,b", "c"],
    });
  });

  it("keeps incomplete numbers and malformed lists out of applied values", () => {
    expect(parseFilterValue(field("number"), "eq", "-").ok).toBe(false);
    expect(parseFilterValue(field("number"), "between", "1,").ok).toBe(false);
    expect(parseFilterValue(field("text"), "in", '"unfinished,a').error).toContain("引号");
    expect(parseFilterValue(field("text"), "in", "a,,b").error).toContain("空值");
  });

  it("rejects reversed numeric and datetime ranges", () => {
    expect(parseFilterValue(field("number"), "between", "5,2").error).toContain("不能大于");
    expect(parseFilterValue(field("datetime"), "between", "2026-03-02,2026-03-01").error).toContain(
      "不能晚于",
    );
  });

  it("splits quoted values without stripping their commas", () => {
    expect(splitFilterValues('"red, blue", green')).toEqual(["red, blue", "green"]);
  });
});
