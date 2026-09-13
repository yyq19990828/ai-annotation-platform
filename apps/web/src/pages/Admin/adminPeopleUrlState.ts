import type { UrlStateCodec, UrlStateIssue } from "@/hooks/useUrlFilterState";

export type PeoplePeriod = "today" | "7d" | "1m";
export type PeopleSort = "throughput" | "quality" | "activity" | "weekly_compare";

export interface AdminPeopleUrlState {
  role: string;
  project: string;
  period: PeoplePeriod;
  sort: PeopleSort;
  q: string;
}

export const ADMIN_PEOPLE_URL_DEFAULTS: AdminPeopleUrlState = {
  role: "",
  project: "",
  period: "7d",
  sort: "throughput",
  q: "",
};

export const ADMIN_PEOPLE_URL_KEYS = ["role", "project", "period", "sort", "q"] as const;

const PERIODS = new Set<PeoplePeriod>(["today", "7d", "1m"]);
const SORTS = new Set<PeopleSort>(["throughput", "quality", "activity", "weekly_compare"]);

export function parseAdminPeopleUrl(search: string | URLSearchParams) {
  const params = new URLSearchParams(search);
  const issues: UrlStateIssue[] = [];
  const rawPeriod = params.get("period");
  const period =
    rawPeriod && PERIODS.has(rawPeriod as PeoplePeriod) ? (rawPeriod as PeoplePeriod) : "7d";
  if (rawPeriod && !PERIODS.has(rawPeriod as PeoplePeriod)) {
    issues.push({ key: "period", message: "未知的绩效时间范围" });
  }
  const rawSort = params.get("sort");
  const sort = rawSort && SORTS.has(rawSort as PeopleSort) ? (rawSort as PeopleSort) : "throughput";
  if (rawSort && !SORTS.has(rawSort as PeopleSort)) {
    issues.push({ key: "sort", message: "未知的绩效排序" });
  }
  return {
    state: {
      role: params.get("role")?.trim() ?? "",
      project: params.get("project")?.trim() ?? "",
      period,
      sort,
      q: params.get("q")?.trim() ?? "",
    },
    issues,
  };
}

export const adminPeopleUrlCodec: UrlStateCodec<AdminPeopleUrlState> = {
  parse: parseAdminPeopleUrl,
  encode: (current, state) => {
    const params = new URLSearchParams(current);
    if (state.role) params.set("role", state.role.trim());
    else params.delete("role");
    if (state.project) params.set("project", state.project.trim());
    else params.delete("project");
    if (state.period === "7d") params.delete("period");
    else params.set("period", state.period);
    if (state.sort === "throughput") params.delete("sort");
    else params.set("sort", state.sort);
    if (state.q) params.set("q", state.q.trim());
    else params.delete("q");
    return params;
  },
};
