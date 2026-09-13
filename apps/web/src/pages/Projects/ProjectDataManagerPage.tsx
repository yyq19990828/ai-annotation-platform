import { useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { useProject } from "@/hooks/useProjects";
import {
  useCreateTaskView,
  useDataManagerSchema,
  useDataManagerSummary,
  useDeleteTaskView,
  useProjectTaskQuery,
  useTaskViews,
  useUpdateTaskView,
} from "@/hooks/useTaskViews";
import type {
  DataManagerFilterField,
  DataManagerEntityScope,
  DataManagerTask,
  ProjectTaskView,
  TaskFilterOp,
  TaskFilterRule,
  TaskSortItem,
} from "@/api/taskViews";
import { useAuthStore } from "@/stores/authStore";
import { usePermissions } from "@/hooks/usePermissions";
import { cn } from "@/lib/utils";
import { Input } from "@/components/shadcn/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/shadcn/ui/popover";
import { Skeleton } from "@/components/shadcn/ui/skeleton";
import { DataManagerAnalyticsPanel } from "./data-manager/DataManagerAnalyticsPanel";
import {
  DataManagerFilterBar,
  type DataManagerFilterChip,
  type DataManagerQuickFilter,
} from "./data-manager/DataManagerFilterBar";
import { FilterValueEditor } from "@/components/filters/FilterValueEditor";
import { useFilterDraftValidity } from "@/components/filters/useFilterDraftValidity";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useUrlFilterState } from "@/hooks/useUrlFilterState";
import { formatFilterDraft, parseFilterValue } from "@/lib/filters/filterValues";
import { filterOperatorLabel } from "@/lib/filters/types";
import {
  combineKeyword,
  collapseEmptyGroups,
  hasNestedGroups,
  isExpressionValid,
  isEmptyFilter,
  isFilterGroup,
  isFilterRule,
  validateFilterStructure,
  appendRule,
  removeAtPath,
  splitKeyword,
  updateRuleAtPath,
  type DataManagerFilterExpression,
} from "./data-manager/dataManagerFilterExpression";
import { DataManagerExpressionEditor } from "./data-manager/DataManagerExpressionEditor";
import { DataManagerSummaryStrip } from "./data-manager/DataManagerOverview";
import { DataManagerLensTabs } from "./data-manager/DataManagerLensTabs";
import { EntityDataManagerLens } from "./data-manager/EntityDataManagerLens";
import { TaskMatchesSheet } from "./data-manager/TaskMatchesSheet";
import {
  DATA_MANAGER_FILTER_KEYS,
  dataManagerUrlCodec,
  hasFilterUrlOverrides,
  parseDataManagerUrl,
  updateDataManagerUrl,
} from "./data-manager/dataManagerUrlState";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/shadcn/ui/dialog";
import { useToastStore } from "@/components/ui/Toast";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/shadcn/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/shadcn/ui/alert-dialog";

const PAGE_SIZE = 50;

const EMPTY_DATA_MANAGER_URL_STATE = {
  lens: "tasks" as const,
  view: null,
  query: "",
  filter: null,
  sort: null,
  columns: null,
  selected: null,
};

// UA-safe 表单基线(无全局 preflight 期间,原生 select/input 需消浏览器默认样式)
const FIELD_CLASS =
  "h-8 w-full appearance-none rounded-sm border border-border bg-background px-2 py-1.5 text-foreground disabled:bg-muted disabled:text-muted-foreground";

const FALLBACK_FILTER_FIELDS: DataManagerFilterField[] = [
  {
    key: "task.status",
    label: "任务状态",
    group: "工作流",
    value_type: "select",
    operators: ["eq", "ne", "in"],
    options: [],
    expensive: false,
    tool_unit_id: null,
    attribute_key: null,
  },
  {
    key: "annotation.annotation_count",
    label: "标注数",
    group: "标注",
    value_type: "number",
    operators: ["eq", "ne", "gt", "gte", "lt", "lte", "in"],
    options: [],
    expensive: false,
    tool_unit_id: null,
    attribute_key: null,
  },
  {
    key: "annotation.class_name",
    label: "标注类别",
    group: "标注",
    value_type: "select",
    operators: ["exists", "eq", "in"],
    options: [],
    expensive: false,
    tool_unit_id: null,
    attribute_key: null,
  },
];

const COLUMN_OPTIONS = [
  { key: "display_id", label: "任务" },
  { key: "file_name", label: "文件名" },
  { key: "status", label: "状态" },
  { key: "annotation_count", label: "标注" },
  { key: "pending_prediction_shape_count", label: "AI 检测待审" },
  { key: "low_confidence_prediction_shape_count", label: "低置信 AI 待审 (<50%)" },
  { key: "pending_tracker_job_count", label: "AI 追踪待审" },
  { key: "unresolved_feedback_count", label: "反馈" },
  { key: "annotation_source_counts", label: "来源" },
  { key: "track_count", label: "轨迹" },
  { key: "last_activity_at", label: "最近活动" },
  { key: "assignee", label: "标注员" },
  { key: "reviewer", label: "审核员" },
] as const;

const DEFAULT_COLUMNS = COLUMN_OPTIONS.slice(0, 11).map((item) => item.key);
interface RuleChipDraft {
  field: string;
  op: TaskFilterOp;
  value: string;
}

function defaultSortForView(view: ProjectTaskView | null): TaskSortItem[] {
  if (view?.sort_json?.length) return view.sort_json;
  return [{ field: "task.created_at", direction: "asc" }];
}

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function statusLabel(status: string) {
  switch (status) {
    case "pending":
      return "待标注";
    case "in_progress":
      return "标注中";
    case "review":
      return "待审核";
    case "completed":
      return "已完成";
    case "uploading":
      return "上传中";
    default:
      return status;
  }
}

function ruleValueLabel(rule: RuleChipDraft, fields: DataManagerFilterField[]) {
  if (rule.op === "exists" || rule.op === "missing") return filterOperatorLabel(rule.op);
  if (rule.value === "null") return `${filterOperatorLabel(rule.op)} 空值`;
  const field = fields.find((item) => item.key === rule.field);
  const option = field?.options.find((item) => item.value === rule.value);
  const value = option?.label ?? rule.value.trim();
  return `${filterOperatorLabel(rule.op)} ${value || "未填写"}`;
}

export function ProjectDataManagerPage() {
  const { id = "" } = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const { data: project, isLoading, error } = useProject(id);
  const schemaQ = useDataManagerSchema(id, "tasks");
  const requestedScope = parseDataManagerUrl(searchParams).lens;
  const availableScopes = schemaQ.data?.available_entity_scopes ?? ["tasks"];
  const scope = availableScopes.includes(requestedScope) ? requestedScope : "tasks";

  useEffect(() => {
    if (!schemaQ.data || requestedScope === scope) return;
    const next = updateDataManagerUrl(searchParams, {
      lens: scope,
      view: null,
      query: "",
      filter: null,
      sort: null,
      columns: null,
      selected: null,
    });
    setSearchParams(next, { replace: true });
  }, [requestedScope, schemaQ.data, scope, searchParams, setSearchParams]);

  if (isLoading || schemaQ.isLoading) {
    return <div className="p-15 text-center text-muted-foreground">加载中...</div>;
  }
  if (error || !project) return <Navigate to="/unauthorized" replace />;

  const changeScope = (nextScope: DataManagerEntityScope) => {
    const next = updateDataManagerUrl(searchParams, {
      lens: nextScope,
      view: null,
      query: "",
      filter: null,
      sort: null,
      columns: null,
      selected: null,
    });
    setSearchParams(next);
  };

  if (scope === "objects" || scope === "tracks") {
    return (
      <EntityDataManagerLens
        projectId={id}
        projectName={project.name}
        projectDisplayId={project.display_id}
        projectOwnerId={project.owner_id}
        scope={scope}
        availableScopes={availableScopes}
        onScopeChange={changeScope}
      />
    );
  }

  return <TaskDataManagerPage availableScopes={availableScopes} onScopeChange={changeScope} />;
}

function TaskDataManagerPage({
  availableScopes,
  onScopeChange,
}: {
  availableScopes: DataManagerEntityScope[];
  onScopeChange: (scope: DataManagerEntityScope) => void;
}) {
  const { id = "" } = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const urlState = useUrlFilterState({
    codec: dataManagerUrlCodec,
    defaults: EMPTY_DATA_MANAGER_URL_STATE,
    ownedKeys: DATA_MANAGER_FILTER_KEYS,
  });
  const currentUrl = urlState.state;
  const navigate = useNavigate();
  const { role } = usePermissions();
  const user = useAuthStore((s) => s.user);
  const pushToast = useToastStore((state) => state.push);
  const { data: project, isLoading: projectLoading, error } = useProject(id);
  const viewsQ = useTaskViews(id);
  const schemaQ = useDataManagerSchema(id);
  const createView = useCreateTaskView(id);
  const updateView = useUpdateTaskView(id);
  const deleteView = useDeleteTaskView(id);
  const [selectedKey, setSelectedKey] = useState<string>(
    currentUrl.lens === "tasks" && currentUrl.view ? currentUrl.view : "builtin:all",
  );
  const draftOwner = `tasks:${id}:${user?.id ?? "anonymous"}:${selectedKey}`;
  const mutationOwnerRef = useRef(draftOwner);
  mutationOwnerRef.current = draftOwner;
  const { hasInvalidDraft, onDraftValidityChange } = useFilterDraftValidity(draftOwner);
  const [filterExpression, setFilterExpression] = useState<DataManagerFilterExpression>({});
  const [appliedFilterExpression, setAppliedFilterExpression] =
    useState<DataManagerFilterExpression>({});
  const [keyword, setKeyword] = useState("");
  const [keywordFlushKey, setKeywordFlushKey] = useState(0);
  const debouncedKeyword = useDebouncedValue(keyword, 250, keywordFlushKey);
  const [columns, setColumns] = useState<string[]>(DEFAULT_COLUMNS);
  const [sort, setSort] = useState<TaskSortItem[]>([
    { field: "task.created_at", direction: "asc" },
  ]);
  const [page, setPage] = useState(0);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [saveName, setSaveName] = useState("任务视图");
  const [saveVisibility, setSaveVisibility] = useState<"private" | "project">("private");
  const [selectedTask, setSelectedTask] = useState<DataManagerTask | null>(null);
  const [baselineSignature, setBaselineSignature] = useState("");
  const [pendingViewKey, setPendingViewKey] = useState<string | null>(null);
  const [pendingScope, setPendingScope] = useState<DataManagerEntityScope | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [analyticsOpen, setAnalyticsOpen] = useState(
    () => typeof window !== "undefined" && localStorage.getItem("dm-analytics-open") === "1",
  );
  const urlHydratedRef = useRef(false);
  const lastWrittenUrlRef = useRef<string | null>(null);
  const pendingViewKeyRef = useRef<string | null>(null);
  const mountedRef = useRef(false);
  const skipUrlSyncRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const views = useMemo(() => viewsQ.data?.items ?? [], [viewsQ.data?.items]);
  const filterFields = useMemo(
    () =>
      (schemaQ.data?.filter_fields ?? FALLBACK_FILTER_FIELDS).filter(
        (field) => field.key !== "task.keyword",
      ),
    [schemaQ.data?.filter_fields],
  );
  const columnOptions = useMemo(
    () =>
      schemaQ.data?.columns ??
      COLUMN_OPTIONS.map((column) => ({
        ...column,
        group: "任务",
        default: DEFAULT_COLUMNS.includes(column.key),
        expensive: false,
        sortable: false,
        sort_field: null,
      })),
    [schemaQ.data?.columns],
  );
  const defaultColumns = useMemo(
    () => (schemaQ.data?.default_columns?.length ? schemaQ.data.default_columns : DEFAULT_COLUMNS),
    [schemaQ.data?.default_columns],
  );
  const fieldLabel = useMemo(
    () => new Map(filterFields.map((field) => [field.key, field.label])),
    [filterFields],
  );
  const selectedView = useMemo(() => {
    return (
      views.find(
        (view) => (view.id ? `saved:${view.id}` : `builtin:${view.key}`) === selectedKey,
      ) ?? null
    );
  }, [selectedKey, views]);

  useEffect(() => {
    if (lastWrittenUrlRef.current === searchParams.toString()) return;
    if (pendingViewKeyRef.current === selectedKey) return;
    const requestedKey =
      currentUrl.lens === "tasks" && currentUrl.view ? currentUrl.view : "builtin:all";
    if (requestedKey !== selectedKey) {
      urlHydratedRef.current = false;
      setSelectedKey(requestedKey);
    }
  }, [currentUrl.lens, currentUrl.view, searchParams, selectedKey]);

  useEffect(() => {
    if (!views.length) return;
    if (!selectedView) {
      const first = views[0];
      const firstKey = first.id ? `saved:${first.id}` : `builtin:${first.key}`;
      urlHydratedRef.current = false;
      setSelectedKey(firstKey);
      setSearchParams(
        updateDataManagerUrl(searchParams, {
          lens: "tasks",
          view: firstKey,
          query: currentUrl.query,
          filter: currentUrl.filter,
          sort: currentUrl.sort,
          columns: currentUrl.columns,
          selected: currentUrl.selected,
        }),
        { replace: true },
      );
    }
  }, [currentUrl, searchParams, selectedView, setSearchParams, views]);

  useEffect(() => {
    if (!selectedView) return;
    const url = currentUrl;
    const useUrl =
      url.lens === "tasks" &&
      (!url.view || url.view === selectedKey) &&
      hasFilterUrlOverrides(searchParams);
    if (lastWrittenUrlRef.current === searchParams.toString()) {
      lastWrittenUrlRef.current = null;
      if (pendingViewKeyRef.current !== selectedKey) {
        urlHydratedRef.current = true;
        return;
      }
      pendingViewKeyRef.current = null;
    }
    const source = (useUrl && url.filter ? url.filter : selectedView.filter_json) as
      | DataManagerFilterExpression
      | Record<string, unknown>;
    const structureIssue = validateFilterStructure(source);
    const split = structureIssue
      ? { query: "", filter: source }
      : splitKeyword(collapseEmptyGroups(source));
    const nextKeyword = useUrl ? url.query : split.query;
    setKeyword(nextKeyword);
    setKeywordFlushKey((value) => value + 1);
    setFilterExpression(split.filter);
    setAppliedFilterExpression(split.filter);
    const allowedColumns = new Set(columnOptions.map((column) => column.key));
    const restoredColumns = (
      useUrl && url.columns?.length
        ? url.columns
        : selectedView.columns_json?.length
          ? selectedView.columns_json
          : defaultColumns
    ).filter((column) => allowedColumns.has(column));
    const nextColumns = restoredColumns.length ? restoredColumns : defaultColumns;
    const nextSort = useUrl && url.sort?.length ? url.sort : defaultSortForView(selectedView);
    setColumns(nextColumns);
    setSort(nextSort);
    setBaselineSignature(
      structureIssue
        ? ""
        : JSON.stringify({
            filter_json: combineKeyword(nextKeyword, split.filter),
            sort_json: nextSort,
            columns_json: nextColumns,
          }),
    );
    urlHydratedRef.current = true;
    skipUrlSyncRef.current = true;
    setPage(0);
  }, [
    columnOptions,
    currentUrl,
    defaultColumns,
    filterFields,
    searchParams,
    selectedKey,
    selectedView,
  ]);

  const switchView = (key: string) => {
    const next = updateDataManagerUrl(searchParams, {
      lens: "tasks",
      view: key,
      query: "",
      filter: null,
      sort: null,
      columns: null,
      selected: null,
    });
    urlHydratedRef.current = false;
    pendingViewKeyRef.current = key;
    lastWrittenUrlRef.current = next.toString();
    setSelectedKey(key);
    setSearchParams(next);
  };

  const expressionValid = useMemo(
    () => isExpressionValid(filterExpression, filterFields),
    [filterExpression, filterFields],
  );
  const filterStructureIssue = useMemo(
    () => validateFilterStructure(filterExpression),
    [filterExpression],
  );
  const filterReady = expressionValid && !hasInvalidDraft;
  useEffect(() => {
    if (expressionValid) setAppliedFilterExpression(filterExpression);
  }, [expressionValid, filterExpression]);
  const queryExpression = useMemo(
    () => (filterReady ? filterExpression : filterStructureIssue ? {} : appliedFilterExpression),
    [appliedFilterExpression, filterExpression, filterReady, filterStructureIssue],
  );
  const filterJson = useMemo(
    () => combineKeyword(debouncedKeyword, queryExpression),
    [debouncedKeyword, queryExpression],
  );
  const queryStateSignature = useMemo(
    () => JSON.stringify({ filter_json: filterJson, sort_json: sort }),
    [filterJson, sort],
  );
  const pageSignatureRef = useRef("");
  const pageForQuery = pageSignatureRef.current === queryStateSignature ? page : 0;
  useEffect(() => {
    if (pageSignatureRef.current === queryStateSignature) return;
    pageSignatureRef.current = queryStateSignature;
    setPage(0);
  }, [queryStateSignature]);
  const queryPayload = useMemo(
    () => ({
      filter_json: filterJson as Record<string, unknown>,
      sort_json: sort,
      columns_json: columns,
      limit: PAGE_SIZE,
      offset: pageForQuery * PAGE_SIZE,
    }),
    [columns, filterJson, pageForQuery, sort],
  );
  const queryReady = Boolean(
    selectedView && schemaQ.data && urlHydratedRef.current && expressionValid,
  );
  const tasksQ = useProjectTaskQuery(id, queryPayload, queryReady);
  const summaryQ = useDataManagerSummary(id, filterJson as Record<string, unknown>, queryReady);
  const currentSignature = useMemo(
    () => JSON.stringify({ filter_json: filterJson, sort_json: sort, columns_json: columns }),
    [columns, filterJson, sort],
  );
  const isDirty = Boolean(
    baselineSignature && (!filterReady || baselineSignature !== currentSignature),
  );
  const total = tasksQ.data?.total ?? 0;
  const visibleTotal =
    summaryQ.data?.scope.visible_task_total ??
    views.find((view) => view.key === "all")?.task_count ??
    0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const canManageProject =
    role === "super_admin" || Boolean(project && user?.id === project.owner_id);
  const canEditSelected = Boolean(
    selectedView?.id &&
    (selectedView.visibility === "private"
      ? selectedView.owner_id === user?.id || role === "super_admin"
      : canManageProject),
  );

  const selectionFilterSignatureRef = useRef<string | null>(null);
  useEffect(() => {
    if (!urlHydratedRef.current) return;
    if (selectionFilterSignatureRef.current === null) {
      selectionFilterSignatureRef.current = currentSignature;
      return;
    }
    if (selectionFilterSignatureRef.current !== currentSignature) {
      selectionFilterSignatureRef.current = currentSignature;
      setSelectedTask(null);
    }
  }, [currentSignature]);

  useEffect(() => {
    if (!urlHydratedRef.current || skipUrlSyncRef.current || !filterReady) {
      skipUrlSyncRef.current = false;
      return;
    }
    const next = updateDataManagerUrl(searchParams, {
      lens: "tasks",
      view: selectedKey,
      query: keyword,
      filter: isEmptyFilter(queryExpression) ? {} : (queryExpression as Record<string, unknown>),
      sort,
      columns,
      selected: selectedTask?.id ?? null,
    });
    if (next.toString() !== searchParams.toString()) {
      lastWrittenUrlRef.current = next.toString();
      setSearchParams(next, { replace: true });
    }
  }, [
    columns,
    queryExpression,
    keyword,
    searchParams,
    selectedKey,
    selectedTask?.id,
    setSearchParams,
    sort,
    filterReady,
  ]);

  useEffect(() => {
    if (!currentUrl.selected) {
      setSelectedTask(null);
      return;
    }
    const restored = tasksQ.data?.items.find((task) => task.id === currentUrl.selected);
    if (restored) setSelectedTask(restored);
  }, [currentUrl.selected, tasksQ.data?.items]);

  if (projectLoading)
    return <div className="p-15 text-center text-muted-foreground">加载中...</div>;
  if (error || !project) return <Navigate to="/unauthorized" replace />;
  if (schemaQ.isError)
    return (
      <div role="alert" className="p-6 text-center text-sm text-destructive">
        无法加载 Data Manager 筛选字段，请刷新重试。
      </div>
    );

  const saveCurrent = async () => {
    if (!filterReady) {
      pushToast({ msg: "请先完成筛选条件", kind: "warning" });
      return;
    }
    const ownerAtStart = draftOwner;
    const payload = {
      name: selectedView?.name ?? "任务视图",
      visibility: selectedView?.visibility ?? "private",
      filter_json: filterJson as Record<string, unknown>,
      sort_json: sort,
      columns_json: columns,
    };
    if (canEditSelected && selectedView?.id) {
      try {
        await updateView.mutateAsync({ viewId: selectedView.id, payload });
        if (!mountedRef.current || mutationOwnerRef.current !== ownerAtStart) return;
        setBaselineSignature(currentSignature);
        pushToast({ msg: "视图已保存", kind: "success" });
      } catch {
        if (!mountedRef.current || mutationOwnerRef.current !== ownerAtStart) return;
        pushToast({ msg: "无法保存视图", sub: "请检查网络后重试", kind: "error" });
      }
      return;
    }
    setSaveName(selectedView ? `${selectedView.name} 副本` : "任务视图");
    setSaveVisibility("private");
    setSaveDialogOpen(true);
  };

  const createSavedView = async () => {
    const name = saveName.trim();
    if (!name || !filterReady) return;
    const ownerAtStart = draftOwner;
    try {
      const created = await createView.mutateAsync({
        name,
        visibility: saveVisibility,
        entity_scope: "tasks",
        filter_json: filterJson as Record<string, unknown>,
        sort_json: sort,
        columns_json: columns,
      });
      if (!mountedRef.current || mutationOwnerRef.current !== ownerAtStart) return;
      await viewsQ.refetch();
      if (!mountedRef.current || mutationOwnerRef.current !== ownerAtStart) return;
      switchView(`saved:${created.id}`);
      setSaveDialogOpen(false);
      pushToast({ msg: "视图已创建", kind: "success" });
    } catch {
      if (!mountedRef.current || mutationOwnerRef.current !== ownerAtStart) return;
      pushToast({ msg: "无法创建视图", sub: "名称可能已存在", kind: "error" });
    }
  };

  const removeCurrent = async () => {
    if (!selectedView?.id || !canEditSelected) return;
    try {
      await deleteView.mutateAsync(selectedView.id);
      switchView("builtin:all");
      pushToast({ msg: "视图已删除", kind: "success" });
    } catch {
      pushToast({ msg: "无法删除视图", kind: "error" });
    }
  };

  const visibleColumnSet = new Set(columns);
  const expressionRuleEntries = isFilterGroup(filterExpression)
    ? (filterExpression.rules
        .map((rule, index) => ({ rule, path: [index] }))
        .filter(({ rule }) => isFilterRule(rule)) as Array<{
        rule: TaskFilterRule;
        path: number[];
      }>)
    : isFilterRule(filterExpression)
      ? [{ rule: filterExpression, path: [] }]
      : [];
  const conjunctEntries =
    isFilterGroup(filterExpression) && filterExpression.op === "or" ? [] : expressionRuleEntries;
  const toggleQuickRule = (rule: RuleChipDraft) => {
    const existing = conjunctEntries.find(
      ({ rule: item }) =>
        item.field === rule.field && item.op === rule.op && String(item.value ?? "") === rule.value,
    );
    if (existing) {
      setFilterExpression(removeAtPath(filterExpression, existing.path));
      return;
    }
    const field = filterFields.find((item) => item.key === rule.field);
    if (!field) return;
    const parsed = parseFilterValue(field, rule.op, rule.value);
    if (!parsed.ok) return;
    setFilterExpression((previous) => {
      const next = appendRule(previous, field);
      const addedPath = isFilterGroup(next) ? [next.rules.length - 1] : [];
      return updateRuleAtPath(next, addedPath, (item) => ({
        ...item,
        op: rule.op,
        value: parsed.value,
      }));
    });
  };
  const toggleAnalytics = () => {
    setAnalyticsOpen((value) => {
      const next = !value;
      localStorage.setItem("dm-analytics-open", next ? "1" : "0");
      return next;
    });
  };
  const quickFilters: DataManagerQuickFilter[] = [
    {
      key: "low-confidence",
      label: "低置信",
      active: conjunctEntries.some(
        ({ rule }) =>
          rule.field === "ai.low_confidence_prediction_shape_count" &&
          rule.op === "gt" &&
          String(rule.value) === "0",
      ),
      onClick: () =>
        toggleQuickRule({
          field: "ai.low_confidence_prediction_shape_count",
          op: "gt",
          value: "0",
        }),
    },
    {
      key: "feedback",
      label: "有反馈",
      active: conjunctEntries.some(
        ({ rule }) =>
          rule.field === "feedback.unresolved_count" &&
          rule.op === "gt" &&
          String(rule.value) === "0",
      ),
      onClick: () => toggleQuickRule({ field: "feedback.unresolved_count", op: "gt", value: "0" }),
    },
    {
      key: "manual",
      label: "人工标注",
      active: conjunctEntries.some(
        ({ rule }) =>
          rule.field === "annotation.source" && rule.op === "eq" && String(rule.value) === "manual",
      ),
      onClick: () => toggleQuickRule({ field: "annotation.source", op: "eq", value: "manual" }),
    },
  ];
  const topRuleEntries = expressionRuleEntries;
  const filterChips: DataManagerFilterChip[] = topRuleEntries.map(({ rule, path }) => {
    const field = filterFields.find((item) => item.key === rule.field);
    const draft = formatFilterDraft(rule.value, field, rule.op);
    return {
      id: `${path.join(".")}:${rule.field}`,
      onRemove: () => setFilterExpression(removeAtPath(filterExpression, path)),
      label: fieldLabel.get(rule.field) ?? rule.field,
      value: ruleValueLabel(
        { field: rule.field, op: rule.op, value: rule.value === null ? "null" : draft },
        filterFields,
      ),
      editor: (
        <div className="flex flex-col gap-2">
          <select
            className={FIELD_CLASS}
            value={rule.op}
            onChange={(event) => {
              setFilterExpression(
                updateRuleAtPath(filterExpression, path, (item) => ({
                  ...item,
                  op: event.target.value as TaskFilterOp,
                })),
              );
            }}
          >
            {(field?.operators ?? [rule.op]).map((operator) => (
              <option key={operator} value={operator}>
                {filterOperatorLabel(operator)}
              </option>
            ))}
          </select>
          {field ? (
            <FilterValueEditor
              field={field}
              operator={rule.op}
              appliedValue={rule.value}
              editorId={`${draftOwner}:chip:${path.join(".") || "root"}`}
              onDraftValidityChange={onDraftValidityChange}
              onCommit={(value) =>
                setFilterExpression(
                  updateRuleAtPath(filterExpression, path, (item) => ({ ...item, value })),
                )
              }
            />
          ) : (
            <div role="alert" className="text-xs text-destructive">
              当前字段不在 schema 中，无法执行条件
            </div>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setFilterExpression(removeAtPath(filterExpression, path))}
          >
            <Icon name="trash" size={12} />
            移除条件
          </Button>
        </div>
      ),
    };
  });

  return (
    <div className="mx-auto h-full min-h-0 max-w-[1800px] overflow-hidden px-4 pt-2 pb-3 text-foreground md:px-6">
      <DataManagerLensTabs
        scope="tasks"
        availableScopes={availableScopes}
        onScopeChange={(nextScope) => {
          if (nextScope === "tasks") return;
          if (isDirty) setPendingScope(nextScope);
          else onScopeChange(nextScope);
        }}
      >
        <div className="flex h-full min-h-0 flex-col gap-2">
          <header className="flex shrink-0 items-center justify-between gap-4 max-md:flex-col max-md:items-start">
            <div className="min-w-0">
              <button
                type="button"
                className="mb-1 inline-flex cursor-pointer appearance-none items-center gap-1 border-0 bg-transparent p-0 text-xs text-muted-foreground"
                onClick={() => navigate(`/projects/${id}/settings`)}
              >
                <Icon name="chevLeft" size={12} />
                返回项目设置
              </button>
              <h1 className="truncate text-lg font-semibold tracking-tight">
                {project.name} · Data Manager
              </h1>
              {!!urlState.issues.length && (
                <div role="alert" className="mt-1 text-xs text-status-caution">
                  URL 筛选状态无法完整恢复，已使用安全默认值。
                </div>
              )}
              <div className="flex items-center gap-2.5 text-xs text-muted-foreground">
                <span className="mono">{project.display_id}</span>
                <span>{visibleTotal.toLocaleString()} 可见任务</span>
                <span>{total.toLocaleString()} 当前匹配</span>
                <span>{views.length.toLocaleString()} 视图</span>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button variant={analyticsOpen ? "primary" : undefined} onClick={toggleAnalytics}>
                <Icon name="activity" size={12} />
                统计
              </Button>
              <Button
                onClick={() => {
                  if (!queryReady || !filterReady) return;
                  tasksQ.refetch();
                  summaryQ.refetch();
                  viewsQ.refetch();
                }}
                disabled={!queryReady || !filterReady || tasksQ.isFetching || summaryQ.isFetching}
              >
                <Icon name="refresh" size={12} />
                刷新
              </Button>
              <Button
                variant="primary"
                onClick={saveCurrent}
                disabled={!filterReady || createView.isPending || updateView.isPending}
              >
                <Icon name="save" size={12} />
                保存视图
              </Button>
            </div>
          </header>

          <DataManagerSummaryStrip
            summary={summaryQ.data}
            isLoading={summaryQ.isLoading}
            onDrill={(rule) => {
              if (!filterFields.some((item) => item.key === rule.field)) return;
              toggleQuickRule({
                field: rule.field,
                op: rule.op as TaskFilterOp,
                value: rule.value,
              });
            }}
          />

          {analyticsOpen && (
            <DataManagerAnalyticsPanel
              scope="tasks"
              summary={summaryQ.data}
              isLoading={summaryQ.isLoading}
              fields={filterFields}
              onSelect={(field, value) => {
                if (!filterFields.some((item) => item.key === field)) return;
                toggleQuickRule({ field, op: "eq" as const, value });
              }}
            />
          )}

          <div className="grid min-h-0 flex-1 grid-cols-[210px_minmax(0,1fr)] gap-3 max-lg:grid-cols-1">
            <aside className="min-h-0 overflow-y-auto rounded-md border border-border bg-card p-2 max-lg:hidden">
              <div className="px-1 pb-2 text-xs font-semibold text-muted-foreground">视图</div>
              <div className="mb-2 flex flex-col gap-0.5 max-md:grid max-md:grid-cols-2 max-sm:grid-cols-1">
                {views.map((view) => {
                  const key = view.id ? `saved:${view.id}` : `builtin:${view.key}`;
                  const active = key === selectedKey;
                  return (
                    <button
                      key={key}
                      type="button"
                      className={cn(
                        "flex min-h-[34px] w-full cursor-pointer appearance-none items-center justify-between gap-2 rounded-sm border border-transparent bg-transparent px-2 py-1.5 text-left text-sm text-muted-foreground hover:bg-muted hover:text-foreground [&>span:first-child]:min-w-0 [&>span:first-child]:overflow-hidden [&>span:first-child]:text-ellipsis [&>span:first-child]:whitespace-nowrap",
                        active && "border-border bg-muted text-foreground",
                      )}
                      onClick={() => {
                        if (key === selectedKey) return;
                        if (isDirty) setPendingViewKey(key);
                        else switchView(key);
                      }}
                    >
                      <span>{view.name}</span>
                      <Badge
                        variant={
                          view.builtin
                            ? "outline"
                            : view.visibility === "project"
                              ? "accent"
                              : "default"
                        }
                      >
                        {view.invalid_fields.length ? "失效" : (view.task_count ?? "—")}
                      </Badge>
                    </button>
                  );
                })}
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setDeleteConfirmOpen(true)}
                disabled={!canEditSelected || deleteView.isPending}
                className="w-full justify-start text-muted-foreground"
              >
                <Icon name="trash" size={12} />
                删除
              </Button>
            </aside>

            <main className="flex min-h-0 min-w-0 flex-col gap-2">
              <section className="flex shrink-0 flex-col gap-2 rounded-md border border-border bg-card p-2.5">
                <div className="flex items-center justify-between gap-3 px-0.5 pb-0.5">
                  <div>
                    <div className="text-sm font-semibold">{selectedView?.name ?? "任务视图"}</div>
                    <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                      {selectedView?.builtin
                        ? "内置视图"
                        : selectedView?.visibility === "project"
                          ? "项目共享"
                          : "私有视图"}
                      <span>·</span>
                      {total.toLocaleString()} 条匹配
                    </div>
                  </div>
                  <Badge variant={isDirty ? "warning" : canEditSelected ? "accent" : "outline"}>
                    {isDirty ? "未保存" : canEditSelected ? "可编辑" : "只读"}
                  </Badge>
                </div>
                <div className="flex gap-2 max-sm:flex-col">
                  <Select
                    value={selectedKey}
                    onValueChange={(key) => {
                      if (key === selectedKey) return;
                      if (isDirty) setPendingViewKey(key);
                      else switchView(key);
                    }}
                  >
                    <SelectTrigger className="hidden w-44 max-lg:flex">
                      <SelectValue placeholder="选择视图" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {views.map((view) => {
                          const key = view.id ? `saved:${view.id}` : `builtin:${view.key}`;
                          return (
                            <SelectItem key={key} value={key}>
                              {view.name}
                            </SelectItem>
                          );
                        })}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  <div className="relative min-w-0 flex-1">
                    <Icon
                      name="search"
                      size={14}
                      className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted-foreground"
                    />
                    <Input
                      value={keyword}
                      onChange={(event) => setKeyword(event.target.value)}
                      placeholder="搜索任务编号或文件名"
                      aria-label="搜索任务编号或文件名"
                      className="h-9 pl-8"
                    />
                  </div>
                  <Select
                    value={sort[0]?.field ?? "task.created_at"}
                    onValueChange={(field) => {
                      setSort([{ field, direction: sort[0]?.direction ?? "asc" }]);
                      setPage(0);
                    }}
                  >
                    <SelectTrigger className="w-40">
                      <SelectValue placeholder="排序字段" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {(schemaQ.data?.sort_fields ?? []).map((field) => (
                          <SelectItem key={field.value} value={field.value}>
                            {field.label}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  <Button
                    onClick={() => {
                      const current = sort[0] ?? {
                        field: "task.created_at",
                        direction: "asc" as const,
                      };
                      setSort([
                        { ...current, direction: current.direction === "asc" ? "desc" : "asc" },
                      ]);
                      setPage(0);
                    }}
                  >
                    {sort[0]?.direction === "desc" ? "降序" : "升序"}
                  </Button>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button>列设置</Button>
                    </PopoverTrigger>
                    <PopoverContent align="end" className="w-72">
                      <div className="mb-2 text-sm font-medium">显示列</div>
                      <div className="max-h-80 overflow-y-auto">
                        {columnOptions.map((column) => (
                          <label
                            key={column.key}
                            className="flex min-h-8 items-center gap-2 text-xs"
                          >
                            <input
                              type="checkbox"
                              checked={visibleColumnSet.has(column.key)}
                              disabled={column.key === "display_id"}
                              onChange={(event) =>
                                setColumns(
                                  event.target.checked
                                    ? [...columns, column.key]
                                    : columns.filter((item) => item !== column.key),
                                )
                              }
                            />
                            <span>{column.label}</span>
                          </label>
                        ))}
                      </div>
                    </PopoverContent>
                  </Popover>
                </div>
                <DataManagerFilterBar
                  fields={filterFields}
                  chips={filterChips}
                  quickFilters={quickFilters}
                  hasConditions={!isEmptyFilter(filterExpression)}
                  onAdd={(field) => setFilterExpression((previous) => appendRule(previous, field))}
                  onClear={() => setFilterExpression({})}
                />
                {isFilterGroup(filterExpression) &&
                  (!expressionValid ||
                    filterExpression.op === "or" ||
                    hasNestedGroups(filterExpression)) && (
                    <DataManagerExpressionEditor
                      expression={filterExpression}
                      fields={filterFields}
                      onChange={setFilterExpression}
                      editorId={`${draftOwner}:group`}
                      onValidityChange={onDraftValidityChange}
                    />
                  )}
                {!filterReady && (
                  <div role="alert" className="text-xs text-destructive">
                    当前筛选包含未完成或 schema 中不存在的条件，完成编辑后才会查询。
                  </div>
                )}
              </section>

              <div className="min-h-0 flex-1 overflow-auto rounded-md border border-border bg-card shadow-sm">
                <table className="w-full min-w-[980px] table-fixed border-collapse [&_td]:overflow-hidden [&_td]:border-b [&_td]:border-border [&_td]:px-3 [&_td]:py-2.5 [&_td]:text-left [&_td]:align-middle [&_td]:text-ellipsis [&_td]:whitespace-nowrap [&_th]:overflow-hidden [&_th]:border-b [&_th]:border-border [&_th]:bg-muted [&_th]:px-3 [&_th]:py-2.5 [&_th]:text-left [&_th]:align-middle [&_th]:text-xs [&_th]:font-semibold [&_th]:text-ellipsis [&_th]:whitespace-nowrap [&_th]:text-muted-foreground [&_td:first-child]:w-[140px] [&_th:first-child]:w-[140px] [&_tbody_tr:hover]:bg-muted [&_tr:last-child_td]:border-b-0">
                  <thead className="sticky top-0 z-base">
                    <tr>
                      {columns.map((column) => (
                        <th key={column}>
                          {columnOptions.find((item) => item.key === column)?.label ?? column}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {tasksQ.data?.items.map((task) => (
                      <tr
                        key={task.id}
                        tabIndex={0}
                        className="cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        onClick={() => setSelectedTask(task)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            setSelectedTask(task);
                          }
                        }}
                      >
                        {columns.map((column) => (
                          <td key={`${task.id}-${column}`}>{renderCell(task, column)}</td>
                        ))}
                      </tr>
                    ))}
                    {tasksQ.isLoading &&
                      Array.from({ length: 6 }, (_, rowIndex) => (
                        <tr key={`loading-${rowIndex}`}>
                          {columns.map((column) => (
                            <td key={`loading-${rowIndex}-${column}`}>
                              <Skeleton className="h-4 w-full" />
                            </td>
                          ))}
                        </tr>
                      ))}
                    {tasksQ.isError && (
                      <tr>
                        <td
                          colSpan={Math.max(1, columns.length)}
                          className="text-center text-destructive"
                        >
                          无法加载任务，请刷新重试
                        </td>
                      </tr>
                    )}
                    {!tasksQ.isLoading && !tasksQ.isError && !tasksQ.data?.items.length && (
                      <tr>
                        <td
                          colSpan={Math.max(1, columns.length)}
                          className="text-center text-muted-foreground"
                        >
                          无匹配任务
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <footer className="flex shrink-0 items-center justify-between gap-3 px-0.5 text-xs text-muted-foreground max-sm:flex-col max-sm:items-start">
                <div>
                  {[
                    ...(debouncedKeyword ? [`关键词 “${debouncedKeyword}”`] : []),
                    ...expressionRuleEntries
                      .filter(
                        ({ rule }) =>
                          rule.value !== undefined || ["exists", "missing"].includes(rule.op),
                      )
                      .map(
                        ({ rule }) =>
                          `${fieldLabel.get(rule.field) ?? rule.field} ${filterOperatorLabel(rule.op)}`,
                      ),
                  ].join(" / ") || "全部任务"}
                </div>
                <div className="flex items-center gap-2 whitespace-nowrap">
                  <Button size="sm" disabled={page <= 0} onClick={() => setPage(page - 1)}>
                    <Icon name="chevLeft" size={12} />
                    上一页
                  </Button>
                  <span>
                    {page + 1} / {totalPages}
                  </span>
                  <Button
                    size="sm"
                    disabled={page + 1 >= totalPages}
                    onClick={() => setPage(page + 1)}
                  >
                    下一页
                    <Icon name="chevRight" size={12} />
                  </Button>
                </div>
              </footer>
            </main>
          </div>
        </div>
        <Dialog open={saveDialogOpen} onOpenChange={setSaveDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>保存任务视图</DialogTitle>
              <DialogDescription>保存当前搜索、筛选、排序和显示列。</DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-3">
              <label className="flex flex-col gap-1.5 text-sm">
                视图名称
                <Input
                  value={saveName}
                  onChange={(event) => setSaveName(event.target.value)}
                  autoFocus
                />
              </label>
              <label className="flex flex-col gap-1.5 text-sm">
                可见性
                <select
                  className={FIELD_CLASS}
                  value={saveVisibility}
                  onChange={(event) =>
                    setSaveVisibility(event.target.value as "private" | "project")
                  }
                >
                  <option value="private">仅自己</option>
                  {canManageProject && <option value="project">项目共享</option>}
                </select>
              </label>
            </div>
            <DialogFooter>
              <Button onClick={() => setSaveDialogOpen(false)}>取消</Button>
              <Button
                variant="primary"
                onClick={createSavedView}
                disabled={!saveName.trim() || !filterReady || createView.isPending}
              >
                保存
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <TaskMatchesSheet
          projectId={id}
          task={selectedTask}
          filterJson={filterJson as Record<string, unknown>}
          open={Boolean(selectedTask)}
          onOpenChange={(open) => !open && setSelectedTask(null)}
        />
        <AlertDialog
          open={Boolean(pendingViewKey || pendingScope)}
          onOpenChange={(open) => {
            if (!open) {
              setPendingViewKey(null);
              setPendingScope(null);
            }
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>放弃未保存的视图修改？</AlertDialogTitle>
              <AlertDialogDescription>
                当前搜索、筛选、排序或显示列尚未保存。切换视图会丢弃这些修改。
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>继续编辑</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  if (pendingViewKey) switchView(pendingViewKey);
                  if (pendingScope) onScopeChange(pendingScope);
                  setPendingViewKey(null);
                  setPendingScope(null);
                }}
              >
                放弃并切换
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>删除“{selectedView?.name}”？</AlertDialogTitle>
              <AlertDialogDescription>
                仅删除保存的视图配置，不会删除任务或标注。此操作无法撤销。
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>取消</AlertDialogCancel>
              <AlertDialogAction
                onClick={async () => {
                  await removeCurrent();
                  setDeleteConfirmOpen(false);
                }}
              >
                确认删除
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DataManagerLensTabs>
    </div>
  );
}

function renderCell(task: DataManagerTask, column: string) {
  switch (column) {
    case "display_id":
      return <span className="mono">{task.display_id}</span>;
    case "file_name":
      return task.file_name || "—";
    case "status":
      return (
        <Badge
          variant={
            task.status === "completed"
              ? "success"
              : task.status === "review"
                ? "warning"
                : "default"
          }
        >
          {statusLabel(task.status)}
        </Badge>
      );
    case "annotation_count":
      return task.annotation_count.toLocaleString();
    case "pending_prediction_shape_count":
      return task.pending_prediction_shape_count ? (
        <Badge variant="warning">{task.pending_prediction_shape_count}</Badge>
      ) : (
        "0"
      );
    case "low_confidence_prediction_shape_count":
      return task.low_confidence_prediction_shape_count ? (
        <Badge variant="warning">{task.low_confidence_prediction_shape_count}</Badge>
      ) : (
        "0"
      );
    case "pending_tracker_job_count":
      return task.pending_tracker_job_count ? (
        <Badge variant="warning">{task.pending_tracker_job_count}</Badge>
      ) : (
        "0"
      );
    case "annotation_source_counts": {
      const parts = [
        ["人工", task.annotation_source_counts.manual],
        ["AI", task.annotation_source_counts.prediction_based],
        ["追踪", task.annotation_source_counts.ai_tracker],
        ["插值", task.annotation_source_counts.interpolated],
      ].filter(([, count]) => Number(count) > 0);
      return parts.length ? parts.map(([label, count]) => `${label} ${count}`).join(" · ") : "—";
    }
    case "track_count":
      return task.track_count.toLocaleString();
    case "prediction_count":
      return task.prediction_count.toLocaleString();
    case "unresolved_feedback_count":
      return task.unresolved_feedback_count ? (
        <Badge variant="warning">{task.unresolved_feedback_count}</Badge>
      ) : (
        "0"
      );
    case "scene_name":
      return task.scene_name ?? "—";
    case "frame_index":
      return task.frame_index ?? "—";
    case "last_activity_at":
      return formatDate(task.last_activity_at);
    case "assignee":
      return task.assignee?.name ?? "—";
    case "reviewer":
      return task.reviewer?.name ?? "—";
    case "duration":
      return task.video_metadata?.duration_ms === null ||
        task.video_metadata?.duration_ms === undefined
        ? "—"
        : `${(task.video_metadata.duration_ms / 1000).toFixed(1)}s`;
    case "fps":
      return task.video_metadata?.fps === null || task.video_metadata?.fps === undefined
        ? "—"
        : task.video_metadata.fps.toFixed(2);
    case "frame_count":
      return task.video_metadata?.frame_count ?? "—";
    case "resolution":
      return task.image_width && task.image_height
        ? `${task.image_width} × ${task.image_height}`
        : "—";
    case "keyframe_count":
      return task.keyframe_count.toLocaleString();
    case "outside_range_count":
      return task.outside_range_count.toLocaleString();
    case "camera_count":
      return task.camera_count.toLocaleString();
    case "calibration_issue_count":
      return task.calibration_issue_count ? (
        <Badge variant="warning">{task.calibration_issue_count}</Badge>
      ) : (
        "0"
      );
    case "scene_total_frames":
      return task.scene_total_frames ?? "—";
    default:
      return "—";
  }
}
