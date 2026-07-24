import type { DataManagerEntityScope, TaskSortItem } from "@/api/taskViews";

export interface DataManagerUrlState {
  lens: DataManagerEntityScope;
  view: string | null;
  query: string;
  filter: Record<string, unknown> | null;
  sort: TaskSortItem[] | null;
  columns: string[] | null;
  selected: string | null;
}

interface VersionedValue<T> {
  v: 1;
  value: T;
}

function parseVersioned<T>(value: string | null): T | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as VersionedValue<T>;
    return parsed?.v === 1 ? parsed.value : null;
  } catch {
    return null;
  }
}

function setVersioned<T>(params: URLSearchParams, key: string, value: T | null) {
  if (value === null) {
    params.delete(key);
    return;
  }
  params.set(key, JSON.stringify({ v: 1, value } satisfies VersionedValue<T>));
}

export function parseDataManagerUrl(search: string | URLSearchParams): DataManagerUrlState {
  const params = typeof search === "string" ? new URLSearchParams(search) : search;
  const rawLens = params.get("lens");
  const lens: DataManagerEntityScope =
    rawLens === "objects" || rawLens === "tracks" ? rawLens : "tasks";
  const columns = parseVersioned<unknown>(params.get("columns"));
  const sort = parseVersioned<unknown>(params.get("sort"));
  const filter = parseVersioned<unknown>(params.get("filter"));
  return {
    lens,
    view: params.get("view"),
    query: params.get("q") ?? "",
    filter:
      filter && typeof filter === "object" && !Array.isArray(filter)
        ? (filter as Record<string, unknown>)
        : null,
    sort: Array.isArray(sort) ? (sort as TaskSortItem[]) : null,
    columns: Array.isArray(columns)
      ? columns.filter((item): item is string => typeof item === "string")
      : null,
    selected: params.get("selected"),
  };
}

export function resolveDataManagerSort(
  urlSort: TaskSortItem[] | null,
  viewSort: TaskSortItem[],
  allowedFields: string[],
  fallbackField: string,
): TaskSortItem[] {
  const allowed = new Set(allowedFields);
  const isValid = (items: TaskSortItem[] | null) =>
    Boolean(
      items?.length &&
      items.every(
        (item) =>
          allowed.has(item.field) && (item.direction === "asc" || item.direction === "desc"),
      ),
    );
  if (isValid(urlSort)) return urlSort!;
  if (isValid(viewSort)) return viewSort;
  return [{ field: fallbackField, direction: "asc" }];
}

export function updateDataManagerUrl(
  current: string | URLSearchParams,
  state: DataManagerUrlState,
): URLSearchParams {
  const params = new URLSearchParams(typeof current === "string" ? current : current.toString());
  params.set("lens", state.lens);
  if (state.view) params.set("view", state.view);
  else params.delete("view");
  if (state.query) params.set("q", state.query);
  else params.delete("q");
  setVersioned(params, "filter", state.filter);
  setVersioned(params, "sort", state.sort);
  setVersioned(params, "columns", state.columns);
  if (state.selected) params.set("selected", state.selected);
  else params.delete("selected");
  return params;
}
