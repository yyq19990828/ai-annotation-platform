import type { DataManagerEntityScope, TaskSortItem } from "@/api/taskViews";
import type { UrlStateCodec } from "@/hooks/useUrlFilterState";

export interface UrlStateIssue {
  key: string;
  message: string;
}

export interface DataManagerUrlState {
  lens: DataManagerEntityScope;
  view: string | null;
  query: string;
  filter: Record<string, unknown> | null;
  sort: TaskSortItem[] | null;
  columns: string[] | null;
  selected: string | null;
}

export const DATA_MANAGER_FILTER_KEYS = [
  "lens",
  "view",
  "q",
  "filter",
  "sort",
  "columns",
  "selected",
] as const;

interface VersionedValue<T> {
  v: 1;
  value: T;
}

function decode<T>(params: URLSearchParams, key: string, issues: UrlStateIssue[]) {
  const raw = params.get(key);
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<VersionedValue<T>>;
    if (parsed?.v !== 1 || !("value" in parsed)) throw new Error("unsupported version");
    return parsed.value as T;
  } catch {
    issues.push({ key, message: "无法读取 URL 中的筛选状态，已使用安全默认值" });
    return null;
  }
}

function encode<T>(params: URLSearchParams, key: string, value: T | null) {
  if (value === null) {
    params.delete(key);
    return;
  }
  params.set(key, JSON.stringify({ v: 1, value } satisfies VersionedValue<T>));
}

function isSortItem(value: unknown): value is TaskSortItem {
  return Boolean(
    value &&
    typeof value === "object" &&
    typeof (value as TaskSortItem).field === "string" &&
    ((value as TaskSortItem).direction === "asc" || (value as TaskSortItem).direction === "desc"),
  );
}

export function parseDataManagerUrlWithIssues(search: string | URLSearchParams): {
  state: DataManagerUrlState;
  issues: UrlStateIssue[];
} {
  const params =
    typeof search === "string" ? new URLSearchParams(search) : new URLSearchParams(search);
  const issues: UrlStateIssue[] = [];
  const rawLens = params.get("lens");
  const lens: DataManagerEntityScope =
    rawLens === "objects" || rawLens === "tracks" || rawLens === "tasks" ? rawLens : "tasks";
  if (rawLens && rawLens !== lens) issues.push({ key: "lens", message: "未知的数据视图" });
  const rawFilter = decode<unknown>(params, "filter", issues);
  const rawSort = decode<unknown>(params, "sort", issues);
  const rawColumns = decode<unknown>(params, "columns", issues);
  const filter =
    rawFilter && typeof rawFilter === "object" && !Array.isArray(rawFilter)
      ? (rawFilter as Record<string, unknown>)
      : rawFilter === null
        ? null
        : (issues.push({ key: "filter", message: "筛选表达式格式无效" }), null);
  const sort =
    rawSort === null
      ? null
      : Array.isArray(rawSort) && rawSort.every(isSortItem)
        ? rawSort
        : (issues.push({ key: "sort", message: "排序格式无效" }), null);
  const columns =
    rawColumns === null
      ? null
      : Array.isArray(rawColumns) && rawColumns.every((item) => typeof item === "string")
        ? rawColumns
        : (issues.push({ key: "columns", message: "列配置格式无效" }), null);
  return {
    state: {
      lens,
      view: params.get("view"),
      query: params.get("q")?.trim() ?? "",
      filter,
      sort,
      columns,
      selected: params.get("selected"),
    },
    issues,
  };
}

export function hasFilterUrlOverrides(search: string | URLSearchParams) {
  const params = typeof search === "string" ? new URLSearchParams(search) : search;
  return ["q", "filter", "sort", "columns"].some((key) => params.has(key));
}

export const dataManagerUrlCodec: UrlStateCodec<DataManagerUrlState> = {
  parse: (search) => parseDataManagerUrlWithIssues(search),
  encode: (current, state) => updateDataManagerUrl(current, state),
  clear: (current, defaults) => updateDataManagerUrl(current, defaults),
};

export function parseDataManagerUrl(search: string | URLSearchParams): DataManagerUrlState {
  return parseDataManagerUrlWithIssues(search).state;
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
  encode(params, "filter", state.filter);
  encode(params, "sort", state.sort);
  encode(params, "columns", state.columns);
  if (state.selected) params.set("selected", state.selected);
  else params.delete("selected");
  return params;
}

export function clearFilterUrlState(
  current: string | URLSearchParams,
  defaults: DataManagerUrlState,
) {
  return updateDataManagerUrl(current, defaults);
}
