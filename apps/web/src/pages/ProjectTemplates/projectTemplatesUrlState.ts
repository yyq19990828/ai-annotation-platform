import type { UrlStateCodec, UrlStateIssue } from "@/hooks/useUrlFilterState";
import type { TemplateScope } from "@/api/projectTemplates";

export const TEMPLATE_SCOPE_VALUES = ["private", "organization", "public", "all"] as const;
export type ProjectTemplateScope = (typeof TEMPLATE_SCOPE_VALUES)[number];

export interface ProjectTemplatesUrlState {
  query: string;
  scope: ProjectTemplateScope;
}

export const EMPTY_PROJECT_TEMPLATES_URL_STATE: ProjectTemplatesUrlState = {
  query: "",
  scope: "private",
};

export const PROJECT_TEMPLATE_FILTER_KEYS = ["q", "scope"] as const;

function isProjectTemplateScope(value: string): value is ProjectTemplateScope {
  return (TEMPLATE_SCOPE_VALUES as readonly string[]).includes(value);
}

export function parseProjectTemplatesUrlWithIssues(search: string | URLSearchParams): {
  state: ProjectTemplatesUrlState;
  issues: UrlStateIssue[];
} {
  const params = new URLSearchParams(typeof search === "string" ? search : search.toString());
  const issues: UrlStateIssue[] = [];
  const rawScope = params.get("scope")?.trim() ?? "";
  const scope = rawScope || "private";
  if (!isProjectTemplateScope(scope)) {
    issues.push({ key: "scope", message: "未知的模板范围" });
  }
  return {
    state: {
      query: params.get("q")?.trim() ?? "",
      scope: isProjectTemplateScope(scope) ? scope : "private",
    },
    issues,
  };
}

function updateProjectTemplatesUrl(
  current: URLSearchParams,
  state: ProjectTemplatesUrlState,
): URLSearchParams {
  const next = new URLSearchParams(current);
  const query = state.query.trim();
  if (query) next.set("q", query);
  else next.delete("q");
  if (state.scope === "private") next.delete("scope");
  else next.set("scope", state.scope);
  return next;
}

export const projectTemplatesUrlCodec: UrlStateCodec<ProjectTemplatesUrlState> = {
  parse: parseProjectTemplatesUrlWithIssues,
  encode: updateProjectTemplatesUrl,
  clear: (current, defaults) => updateProjectTemplatesUrl(current, defaults),
};

export function parseProjectTemplatesUrl(
  search: string | URLSearchParams,
): ProjectTemplatesUrlState {
  return parseProjectTemplatesUrlWithIssues(search).state;
}

export function templateScopeForApi(scope: ProjectTemplateScope): TemplateScope | undefined {
  return scope === "all" ? undefined : scope;
}
