import { describe, expect, it } from "vitest";

import type { DataManagerFilterField, TaskFilterRule } from "@/api/taskViews";
import {
  combineKeyword,
  expressionRules,
  removeAtPath,
  splitKeyword,
  updateRuleAtPath,
  isExpressionValid,
  MAX_FILTER_DEPTH,
  MAX_FILTER_NODES,
  validateFilterStructure,
} from "./dataManagerFilterExpression";

const fields: DataManagerFilterField[] = [
  {
    key: "task.status",
    label: "状态",
    group: "任务",
    value_type: "select",
    operators: ["eq", "in"],
    options: [],
    expensive: false,
    tool_unit_id: null,
    attribute_key: null,
  },
];

describe("Data Manager filter expressions", () => {
  it("keeps nested OR groups and same-object grouping when adding a keyword", () => {
    const nested = {
      op: "and" as const,
      rules: [
        {
          op: "or" as const,
          rules: [
            { field: "annotation.class_name", op: "eq" as const, value: "car" },
            { field: "annotation.attribute.color", op: "eq" as const, value: "red" },
          ],
        },
      ],
    };
    const combined = combineKeyword("frame 42", nested);
    expect(combined).toEqual({
      op: "and",
      rules: [{ field: "task.keyword", op: "contains", value: "frame 42" }, nested],
    });
    expect(splitKeyword(combined)).toEqual({ query: "frame 42", filter: nested });
  });

  it("extracts only a direct contains keyword and leaves other keyword operators intact", () => {
    const eq: TaskFilterRule = { field: "task.keyword", op: "eq", value: "exact" };
    expect(splitKeyword(eq)).toEqual({ query: "", filter: eq });
    const inGroup = { op: "and" as const, rules: [eq] };
    expect(splitKeyword(inGroup)).toEqual({ query: "", filter: inGroup });
    const nestedOr = {
      op: "or" as const,
      rules: [{ field: "task.keyword", op: "contains" as const, value: "x" }],
    };
    expect(splitKeyword(nestedOr)).toEqual({ query: "", filter: nestedOr });
    const nonScalar = { field: "task.keyword", op: "contains" as const, value: ["x"] };
    expect(splitKeyword(nonScalar)).toEqual({ query: "", filter: nonScalar });
  });

  it("updates and removes by path without flattening groups", () => {
    const expression = {
      op: "and" as const,
      rules: [
        {
          op: "or" as const,
          rules: [{ field: "task.status", op: "eq" as const, value: "pending" }],
        },
      ],
    };
    const updated = updateRuleAtPath(expression, [0, 0], (rule) => ({ ...rule, value: "review" }));
    expect(updated).toEqual({
      op: "and",
      rules: [{ op: "or", rules: [{ field: "task.status", op: "eq", value: "review" }] }],
    });
    expect(removeAtPath(updated, [0, 0])).toEqual({});
    expect(expressionRules(expression)).toEqual([
      { path: [0, 0], rule: { field: "task.status", op: "eq", value: "pending" } },
    ]);
    const grouped = {
      op: "and" as const,
      rules: [
        {
          op: "and" as const,
          rules: [{ field: "task.status", op: "eq" as const, value: "pending" }],
        },
        { field: "task.status", op: "eq" as const, value: "review" },
      ],
    };
    expect(removeAtPath(grouped, [1])).toEqual({
      op: "and",
      rules: [{ op: "and", rules: [{ field: "task.status", op: "eq", value: "pending" }] }],
    });
  });

  it("does not require a field option list to restore a valid saved value", () => {
    expect(splitKeyword({ field: fields[0].key, op: "eq", value: "orphan" })).toEqual({
      query: "",
      filter: { field: fields[0].key, op: "eq", value: "orphan" },
    });
  });

  it("blocks a scalar that was switched to an array operator until it is committed as an array", () => {
    expect(isExpressionValid({ field: fields[0].key, op: "in", value: "pending" }, fields)).toBe(
      false,
    );
    expect(isExpressionValid({ field: fields[0].key, op: "in", value: ["pending"] }, fields)).toBe(
      true,
    );
  });

  it("retains an explicit nullable eq/ne null value from a saved view", () => {
    expect(isExpressionValid({ field: fields[0].key, op: "eq", value: null }, fields)).toBe(true);
  });

  it("rejects structural depth and node budgets before recursive validation", () => {
    let deep: unknown = { field: "status", op: "eq", value: "pending" };
    for (let index = 0; index < MAX_FILTER_DEPTH; index += 1) deep = { op: "and", rules: [deep] };
    expect(validateFilterStructure(deep)).toContain("嵌套");
    const wide = {
      op: "and",
      rules: Array.from({ length: MAX_FILTER_NODES }, () => ({
        field: "status",
        op: "eq",
        value: "pending",
      })),
    };
    expect(validateFilterStructure(wide)).toContain("节点");
    expect(isExpressionValid(deep as never, fields)).toBe(false);
  });
});
