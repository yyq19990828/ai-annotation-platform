import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import {
  dataManagerUrlCodec,
  type DataManagerUrlState,
} from "@/pages/Projects/data-manager/dataManagerUrlState";
import { useUrlFilterState } from "./useUrlFilterState";

const defaults: DataManagerUrlState = {
  lens: "tasks",
  view: null,
  query: "",
  filter: null,
  sort: null,
  columns: null,
  selected: null,
};

function wrapper({ children }: { children: ReactNode }) {
  return (
    <MemoryRouter initialEntries={["/projects/p1?keep=1&lens=tasks"]}>{children}</MemoryRouter>
  );
}

describe("useUrlFilterState", () => {
  it("patches owned state atomically while preserving unrelated params and can reset", () => {
    const { result } = renderHook(
      () => useUrlFilterState({ codec: dataManagerUrlCodec, defaults }),
      { wrapper },
    );
    act(() => {
      result.current.patch({
        query: "car",
        filter: { field: "name", op: "contains", value: "car" },
      });
    });
    expect(result.current.state.query).toBe("car");
    expect(result.current.state.filter).toEqual({ field: "name", op: "contains", value: "car" });
    act(() => result.current.reset());
    expect(result.current.state.query).toBe("");
    expect(result.current.state.filter).toBeNull();
  });
});
