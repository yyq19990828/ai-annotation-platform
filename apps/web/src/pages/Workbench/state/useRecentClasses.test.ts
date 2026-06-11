import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useRecentClasses } from "./useRecentClasses";

describe("useRecentClasses", () => {
  beforeEach(() => window.localStorage.clear());

  it("slices stored classes by configured limit", () => {
    window.localStorage.setItem(
      "recent-classes:p1",
      JSON.stringify(["Car", "Bike", "Bus", "Person"]),
    );

    const { result } = renderHook(() => useRecentClasses("p1", 3));

    expect(result.current.recent).toEqual(["Car", "Bike", "Bus"]);
  });

  it("dedupes and writes by configured limit", () => {
    const { result } = renderHook(() => useRecentClasses("p1", 3));

    act(() => {
      result.current.record("Car");
      result.current.record("Bike");
      result.current.record("Bus");
      result.current.record("Car");
      result.current.record("Person");
    });

    expect(result.current.recent).toEqual(["Person", "Car", "Bus"]);
    expect(JSON.parse(window.localStorage.getItem("recent-classes:p1") ?? "[]")).toEqual([
      "Person",
      "Car",
      "Bus",
    ]);
  });
});
