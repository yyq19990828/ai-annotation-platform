import type { UrlStateCodec, UrlStateIssue } from "@/hooks/useUrlFilterState";

export const DASHBOARD_STATUS_VALUES = ["in_progress", "pending_review", "completed"] as const;
export type DashboardStatus = (typeof DASHBOARD_STATUS_VALUES)[number];

export const DASHBOARD_DATA_TYPE_VALUES = ["image", "video", "lidar"] as const;
export type DashboardDataType = (typeof DASHBOARD_DATA_TYPE_VALUES)[number];

export interface DashboardFilters {
  status?: DashboardStatus;
  data_type: DashboardDataType[];
  member_id?: string;
  created_from?: string;
  created_to?: string;
}

export interface DashboardUrlState extends DashboardFilters {
  query: string;
}

export const EMPTY_FILTERS: DashboardFilters = {
  status: undefined,
  data_type: [],
  member_id: undefined,
  created_from: undefined,
  created_to: undefined,
};

export const EMPTY_DASHBOARD_URL_STATE: DashboardUrlState = {
  ...EMPTY_FILTERS,
  query: "",
};

export const DASHBOARD_FILTER_KEYS = [
  "q",
  "status",
  "data_type",
  "member_id",
  "created_from",
  "created_to",
] as const;

function isDashboardStatus(value: string): value is DashboardStatus {
  return (DASHBOARD_STATUS_VALUES as readonly string[]).includes(value);
}

function isDashboardDataType(value: string): value is DashboardDataType {
  return (DASHBOARD_DATA_TYPE_VALUES as readonly string[]).includes(value);
}

function isDateValue(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

function uniqueDataTypes(values: string[]): DashboardDataType[] {
  const selected = new Set(values);
  return DASHBOARD_DATA_TYPE_VALUES.filter((value) => selected.has(value));
}

export function parseDashboardUrlWithIssues(search: string | URLSearchParams): {
  state: DashboardUrlState;
  issues: UrlStateIssue[];
} {
  const params = new URLSearchParams(typeof search === "string" ? search : search.toString());
  const issues: UrlStateIssue[] = [];

  const rawStatus = params.get("status")?.trim() ?? "";
  const status = rawStatus === "" || rawStatus === "all" ? undefined : rawStatus;
  if (status !== undefined && !isDashboardStatus(status)) {
    issues.push({ key: "status", message: "未知的项目状态" });
  }

  const rawDataTypes = params.getAll("data_type");
  const invalidDataType = rawDataTypes.find((value) => !isDashboardDataType(value));
  if (invalidDataType) {
    issues.push({ key: "data_type", message: "未知的项目数据类型" });
  }

  const query = params.get("q")?.trim() ?? "";
  const memberId = params.get("member_id")?.trim() ?? "";
  const createdFrom = params.get("created_from")?.trim() ?? "";
  const createdTo = params.get("created_to")?.trim() ?? "";
  const validCreatedFrom = createdFrom && isDateValue(createdFrom) ? createdFrom : undefined;
  const validCreatedTo = createdTo && isDateValue(createdTo) ? createdTo : undefined;
  if (createdFrom && !validCreatedFrom) {
    issues.push({ key: "created_from", message: "创建开始日期格式无效" });
  }
  if (createdTo && !validCreatedTo) {
    issues.push({ key: "created_to", message: "创建结束日期格式无效" });
  }
  const hasReversedDateRange =
    validCreatedFrom !== undefined &&
    validCreatedTo !== undefined &&
    validCreatedFrom > validCreatedTo;
  if (hasReversedDateRange) {
    issues.push({ key: "created_to", message: "创建日期范围无效" });
  }

  return {
    state: {
      query,
      status: status !== undefined && isDashboardStatus(status) ? status : undefined,
      data_type: uniqueDataTypes(rawDataTypes.filter(isDashboardDataType)),
      member_id: memberId || undefined,
      created_from: hasReversedDateRange ? undefined : validCreatedFrom,
      created_to: hasReversedDateRange ? undefined : validCreatedTo,
    },
    issues,
  };
}

export function updateDashboardUrl(
  current: URLSearchParams,
  state: DashboardUrlState,
): URLSearchParams {
  const next = new URLSearchParams(current);
  const query = state.query.trim();
  if (query) next.set("q", query);
  else next.delete("q");

  if (state.status) next.set("status", state.status);
  else next.delete("status");

  next.delete("data_type");
  uniqueDataTypes(state.data_type).forEach((value) => next.append("data_type", value));

  if (state.member_id?.trim()) next.set("member_id", state.member_id.trim());
  else next.delete("member_id");
  const validCreatedFrom = state.created_from && isDateValue(state.created_from);
  const validCreatedTo = state.created_to && isDateValue(state.created_to);
  const hasReversedDateRange =
    validCreatedFrom && validCreatedTo && state.created_from! > state.created_to!;
  if (validCreatedFrom && !hasReversedDateRange) next.set("created_from", state.created_from!);
  else next.delete("created_from");
  if (validCreatedTo && !hasReversedDateRange) next.set("created_to", state.created_to!);
  else next.delete("created_to");
  return next;
}

export const dashboardUrlCodec: UrlStateCodec<DashboardUrlState> = {
  parse: parseDashboardUrlWithIssues,
  encode: updateDashboardUrl,
  clear: (current, defaults) => updateDashboardUrl(current, defaults),
};

export function parseDashboardUrl(search: string | URLSearchParams): DashboardUrlState {
  return parseDashboardUrlWithIssues(search).state;
}
