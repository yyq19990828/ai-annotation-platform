import type { UrlStateCodec, UrlStateIssue } from "@/hooks/useUrlFilterState";

export const BUG_STATUSES = [
  "new",
  "triaged",
  "in_progress",
  "fixed",
  "wont_fix",
  "duplicate",
] as const;
export const BUG_SEVERITIES = ["low", "medium", "high", "critical"] as const;

export interface BugsUrlState {
  status: string;
  severity: string;
}

export const BUGS_URL_DEFAULTS: BugsUrlState = { status: "", severity: "" };
export const BUGS_URL_KEYS = ["status", "severity"] as const;

export function parseBugsUrl(search: string | URLSearchParams) {
  const params = new URLSearchParams(search);
  const issues: UrlStateIssue[] = [];
  const rawStatus = params.get("status")?.trim() ?? "";
  const rawSeverity = params.get("severity")?.trim() ?? "";
  const status =
    !rawStatus || BUG_STATUSES.includes(rawStatus as (typeof BUG_STATUSES)[number])
      ? rawStatus
      : "";
  const severity =
    !rawSeverity || BUG_SEVERITIES.includes(rawSeverity as (typeof BUG_SEVERITIES)[number])
      ? rawSeverity
      : "";
  if (rawStatus && !status) issues.push({ key: "status", message: "未知的 BUG 状态" });
  if (rawSeverity && !severity) issues.push({ key: "severity", message: "未知的 BUG 严重度" });
  return { state: { status, severity }, issues };
}

export const bugsUrlCodec: UrlStateCodec<BugsUrlState> = {
  parse: parseBugsUrl,
  encode: (current, state) => {
    const params = new URLSearchParams(current);
    if (state.status) params.set("status", state.status);
    else params.delete("status");
    if (state.severity) params.set("severity", state.severity);
    else params.delete("severity");
    return params;
  },
};
