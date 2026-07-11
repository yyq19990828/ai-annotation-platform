import { useEffect, useMemo, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
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
import { Skeleton } from "@/components/shadcn/ui/skeleton";
import { DataManagerOverview } from "./data-manager/DataManagerOverview";
import { TaskMatchesSheet } from "./data-manager/TaskMatchesSheet";
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

// UA-safe 表单基线(无全局 preflight 期间,原生 select/input 需消浏览器默认样式)
const FIELD_CLASS =
  "h-8 w-full appearance-none rounded-sm border border-border bg-background px-2 py-1.5 text-foreground disabled:bg-muted disabled:text-muted-foreground";

const FALLBACK_FILTER_FIELDS: DataManagerFilterField[] = [
  { key: "task.status", label: "任务状态", group: "工作流", value_type: "select", operators: ["eq", "ne", "in"], options: [], expensive: false, tool_unit_id: null, attribute_key: null },
  { key: "annotation.annotation_count", label: "标注数", group: "标注", value_type: "number", operators: ["eq", "ne", "gt", "gte", "lt", "lte", "in"], options: [], expensive: false, tool_unit_id: null, attribute_key: null },
  { key: "annotation.class_name", label: "标注类别", group: "标注", value_type: "select", operators: ["exists", "eq", "in"], options: [], expensive: false, tool_unit_id: null, attribute_key: null },
];

const COLUMN_OPTIONS = [
  { key: "display_id", label: "任务" },
  { key: "file_name", label: "文件名" },
  { key: "status", label: "状态" },
  { key: "annotation_count", label: "标注" },
  { key: "pending_prediction_shape_count", label: "AI 检测待审" },
  { key: "pending_tracker_job_count", label: "AI 追踪待审" },
  { key: "unresolved_feedback_count", label: "反馈" },
  { key: "annotation_source_counts", label: "来源" },
  { key: "track_count", label: "轨迹" },
  { key: "last_activity_at", label: "最近活动" },
  { key: "assignee", label: "标注员" },
  { key: "reviewer", label: "审核员" },
] as const;

const DEFAULT_COLUMNS = COLUMN_OPTIONS.slice(0, 10).map((item) => item.key);
const EMPTY_RULE: EditableRule = { field: "task.status", op: "in", value: "pending" };

interface EditableRule {
  field: string;
  op: TaskFilterOp;
  value: string;
}

function isFilterRule(value: unknown): value is TaskFilterRule {
  return Boolean(value && typeof value === "object" && "field" in value && "op" in value);
}

export function editableRulesFromView(view: ProjectTaskView | null): EditableRule[] {
  const raw = view?.filter_json;
  if (!raw || !("rules" in raw) || !Array.isArray(raw.rules)) return [];
  const rules = raw.rules
    .filter(isFilterRule)
    .map((rule) => ({
      field: rule.field,
      op: rule.op,
      value: Array.isArray(rule.value) ? rule.value.join(", ") : String(rule.value ?? ""),
    }));
  return rules;
}

function normalizeRuleValue(rule: EditableRule, fields: DataManagerFilterField[]): unknown {
  const field = fields.find((item) => item.key === rule.field);
  if (rule.op === "exists" || rule.op === "missing") return true;
  if (["in", "contains_any", "contains_all", "between"].includes(rule.op)) {
    const values = rule.value.split(",").map((item) => item.trim()).filter(Boolean);
    return field?.value_type === "number"
      ? values.map((item) => Number(item)).filter(Number.isFinite)
      : values;
  }
  if (field?.value_type === "number") {
    const n = Number(rule.value);
    return Number.isFinite(n) ? n : rule.value;
  }
  if (field?.value_type === "boolean") return rule.value === "true";
  return rule.value.trim();
}

export function buildFilterJson(
  rules: EditableRule[],
  fields: DataManagerFilterField[],
  keyword: string,
): Record<string, unknown> {
  const clean = rules
    .filter((rule) => rule.field && rule.op && (["exists", "missing"].includes(rule.op) || rule.value.trim()))
    .map((rule) => ({
      field: rule.field,
      op: rule.op,
      value: normalizeRuleValue(rule, fields),
    }));
  if (keyword.trim()) {
    clean.unshift({ field: "task.keyword", op: "contains", value: keyword.trim() });
  }
  if (!clean.length) return {};
  return { op: "and", rules: clean };
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

function operatorLabel(operator: TaskFilterOp) {
  const labels: Partial<Record<TaskFilterOp, string>> = {
    eq: "=",
    ne: "!=",
    in: "属于",
    gt: ">",
    gte: ">=",
    lt: "<",
    lte: "<=",
    exists: "已填写",
    missing: "缺失",
    contains: "包含",
    between: "区间",
    contains_any: "包含任一",
    contains_all: "包含全部",
  };
  return labels[operator] ?? operator;
}

function renderRuleValueControl(
  rule: EditableRule,
  index: number,
  rules: EditableRule[],
  setRules: (rules: EditableRule[]) => void,
  fields: DataManagerFilterField[],
) {
  const field = fields.find((item) => item.key === rule.field);
  const update = (value: string) => {
    const next = [...rules];
    next[index] = { ...rule, value };
    setRules(next);
  };
  if (rule.op === "exists" || rule.op === "missing") {
    return <input className={FIELD_CLASS} value="无需填写" disabled readOnly />;
  }
  if (field?.value_type === "boolean") {
    return (
      <select className={FIELD_CLASS} value={rule.value || "true"} onChange={(event) => update(event.target.value)}>
        <option value="true">是</option>
        <option value="false">否</option>
      </select>
    );
  }
  if (field?.options.length && rule.op === "eq") {
    return (
      <select className={FIELD_CLASS} value={rule.value} onChange={(event) => update(event.target.value)}>
        <option value="">请选择</option>
        {field.options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    );
  }
  return (
    <input
      className={FIELD_CLASS}
      value={rule.value}
      inputMode={field?.value_type === "number" ? "decimal" : undefined}
      placeholder={["in", "between", "contains_any", "contains_all"].includes(rule.op) ? "多个值用逗号分隔" : undefined}
      onChange={(event) => update(event.target.value)}
    />
  );
}

export function ProjectDataManagerPage() {
  const { id = "" } = useParams<{ id: string }>();
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
  const [selectedKey, setSelectedKey] = useState<string>("builtin:all");
  const [rules, setRules] = useState<EditableRule[]>([]);
  const [keyword, setKeyword] = useState("");
  const [debouncedKeyword, setDebouncedKeyword] = useState("");
  const [columns, setColumns] = useState<string[]>(DEFAULT_COLUMNS);
  const [sort, setSort] = useState<TaskSortItem[]>([{ field: "task.created_at", direction: "asc" }]);
  const [page, setPage] = useState(0);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [saveName, setSaveName] = useState("任务视图");
  const [saveVisibility, setSaveVisibility] = useState<"private" | "project">("private");
  const [selectedTask, setSelectedTask] = useState<DataManagerTask | null>(null);
  const [baselineSignature, setBaselineSignature] = useState("");
  const [pendingViewKey, setPendingViewKey] = useState<string | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  const views = useMemo(() => viewsQ.data?.items ?? [], [viewsQ.data?.items]);
  const filterFields = useMemo(
    () => (schemaQ.data?.filter_fields ?? FALLBACK_FILTER_FIELDS).filter((field) => field.key !== "task.keyword"),
    [schemaQ.data?.filter_fields],
  );
  const columnOptions = useMemo(
    () => schemaQ.data?.columns ?? COLUMN_OPTIONS.map((column) => ({ ...column, group: "任务", default: DEFAULT_COLUMNS.includes(column.key), expensive: false })),
    [schemaQ.data?.columns],
  );
  const defaultColumns = useMemo(
    () => schemaQ.data?.default_columns?.length ? schemaQ.data.default_columns : DEFAULT_COLUMNS,
    [schemaQ.data?.default_columns],
  );
  const fieldLabel = useMemo(
    () => new Map(filterFields.map((field) => [field.key, field.label])),
    [filterFields],
  );
  const selectedView = useMemo(() => {
    return views.find((view) => (view.id ? `saved:${view.id}` : `builtin:${view.key}`) === selectedKey) ?? null;
  }, [selectedKey, views]);

  useEffect(() => {
    if (!views.length) return;
    if (!selectedView) {
      const first = views[0];
      setSelectedKey(first.id ? `saved:${first.id}` : `builtin:${first.key}`);
    }
  }, [selectedView, views]);

  useEffect(() => {
    if (!selectedView) return;
    const hydrated = editableRulesFromView(selectedView);
    const keywordRule = hydrated.find((rule) => rule.field === "task.keyword");
    setKeyword(keywordRule?.value ?? "");
    setDebouncedKeyword(keywordRule?.value ?? "");
    setRules(hydrated.filter((rule) => rule.field !== "task.keyword"));
    const allowedColumns = new Set(columnOptions.map((column) => column.key));
    const restoredColumns = (selectedView.columns_json?.length ? selectedView.columns_json : defaultColumns)
      .filter((column) => allowedColumns.has(column));
    const nextColumns = restoredColumns.length ? restoredColumns : defaultColumns;
    const nextSort = defaultSortForView(selectedView);
    setColumns(nextColumns);
    setSort(nextSort);
    setBaselineSignature(JSON.stringify({
      filter_json: buildFilterJson(
        hydrated.filter((rule) => rule.field !== "task.keyword"),
        filterFields,
        keywordRule?.value ?? "",
      ),
      sort_json: nextSort,
      columns_json: nextColumns,
    }));
    setPage(0);
  }, [columnOptions, defaultColumns, filterFields, selectedView]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedKeyword(keyword), 250);
    return () => window.clearTimeout(timer);
  }, [keyword]);

  const filterJson = useMemo(
    () => buildFilterJson(rules, filterFields, debouncedKeyword),
    [debouncedKeyword, filterFields, rules],
  );
  useEffect(() => setPage(0), [filterJson]);
  const queryPayload = useMemo(() => ({
    filter_json: filterJson,
    sort_json: sort,
    columns_json: columns,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  }), [columns, filterJson, page, sort]);
  const queryReady = Boolean(selectedView && schemaQ.data);
  const tasksQ = useProjectTaskQuery(id, queryPayload, queryReady);
  const summaryQ = useDataManagerSummary(id, filterJson, queryReady);
  const currentSignature = useMemo(
    () => JSON.stringify({ filter_json: filterJson, sort_json: sort, columns_json: columns }),
    [columns, filterJson, sort],
  );
  const isDirty = Boolean(baselineSignature && baselineSignature !== currentSignature);
  const total = tasksQ.data?.total ?? 0;
  const visibleTotal = summaryQ.data?.scope.visible_task_total
    ?? views.find((view) => view.key === "all")?.task_count
    ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const canManageProject = role === "super_admin" || Boolean(project && user?.id === project.owner_id);
  const canEditSelected = Boolean(
    selectedView?.id
      && (selectedView.visibility === "private"
        ? selectedView.owner_id === user?.id || role === "super_admin"
        : canManageProject),
  );

  if (projectLoading) return <div className="p-15 text-center text-muted-foreground">加载中...</div>;
  if (error || !project) return <Navigate to="/unauthorized" replace />;

  const saveCurrent = async () => {
    const payload = {
      name: selectedView?.name ?? "任务视图",
      visibility: selectedView?.visibility ?? "private",
      filter_json: filterJson,
      sort_json: sort,
      columns_json: columns,
    };
    if (canEditSelected && selectedView?.id) {
      try {
        await updateView.mutateAsync({ viewId: selectedView.id, payload });
        setBaselineSignature(currentSignature);
        pushToast({ msg: "视图已保存", kind: "success" });
      } catch {
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
    if (!name) return;
    try {
      const created = await createView.mutateAsync({
        name,
        visibility: saveVisibility,
        filter_json: filterJson,
        sort_json: sort,
        columns_json: columns,
      });
      await viewsQ.refetch();
      setSelectedKey(`saved:${created.id}`);
      setSaveDialogOpen(false);
      pushToast({ msg: "视图已创建", kind: "success" });
    } catch {
      pushToast({ msg: "无法创建视图", sub: "名称可能已存在", kind: "error" });
    }
  };

  const removeCurrent = async () => {
    if (!selectedView?.id || !canEditSelected) return;
    try {
      await deleteView.mutateAsync(selectedView.id);
      setSelectedKey("builtin:all");
      pushToast({ msg: "视图已删除", kind: "success" });
    } catch {
      pushToast({ msg: "无法删除视图", kind: "error" });
    }
  };

  const visibleColumnSet = new Set(columns);

  return (
    <div className="mx-auto max-w-[1680px] px-4 pt-4 pb-8 text-foreground md:px-7">
      <header className="mb-3.5">
        <button
          type="button"
          className="mb-2 inline-flex cursor-pointer appearance-none items-center gap-1 border-0 bg-transparent p-0 text-xs text-muted-foreground"
          onClick={() => navigate(`/projects/${id}/settings`)}
        >
          <Icon name="chevLeft" size={12} />返回项目设置
        </button>
        <div className="flex items-center justify-between gap-4 max-md:flex-col max-md:items-start">
          <div>
            <h1 className="mb-1 text-xl font-semibold">{project.name} · Data Manager</h1>
            <div className="flex items-center gap-2.5 text-xs text-muted-foreground">
              <span className="mono">{project.display_id}</span>
              <span>{visibleTotal.toLocaleString()} 可见任务</span>
              <span>{total.toLocaleString()} 当前匹配</span>
              <span>{views.length.toLocaleString()} 视图</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              onClick={() => {
                tasksQ.refetch();
                summaryQ.refetch();
                viewsQ.refetch();
              }}
              disabled={tasksQ.isFetching || summaryQ.isFetching}
            >
              <Icon name="refresh" size={12} />刷新
            </Button>
            <Button variant="primary" onClick={saveCurrent} disabled={createView.isPending || updateView.isPending}>
              <Icon name="save" size={12} />保存视图
            </Button>
          </div>
        </div>
      </header>

      <div className="mb-3.5">
        <DataManagerOverview summary={summaryQ.data} isLoading={summaryQ.isLoading} />
      </div>

      <div className="grid grid-cols-[220px_minmax(0,1fr)] gap-3.5 max-md:grid-cols-1">
        <aside className="self-start rounded-md border border-border bg-card p-2 max-md:static md:sticky md:top-4">
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
                    else setSelectedKey(key);
                  }}
                >
                  <span>{view.name}</span>
                  <Badge variant={view.builtin ? "outline" : view.visibility === "project" ? "accent" : "default"}>
                    {view.invalid_fields.length ? "失效" : view.task_count ?? "—"}
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
            <Icon name="trash" size={12} />删除
          </Button>
        </aside>

        <main className="min-w-0">
          <section className="mb-2.5 flex flex-col gap-2.5 rounded-md border border-border bg-card p-2.5">
            <div className="flex items-center justify-between gap-3 px-0.5 pb-0.5">
              <div>
                <div className="text-sm font-semibold">{selectedView?.name ?? "任务视图"}</div>
                <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                  {selectedView?.builtin ? "内置视图" : selectedView?.visibility === "project" ? "项目共享" : "私有视图"}
                  <span>·</span>
                  {total.toLocaleString()} 条匹配
                </div>
              </div>
              <Badge variant={isDirty ? "warning" : canEditSelected ? "accent" : "outline"}>
                {isDirty ? "未保存" : canEditSelected ? "可编辑" : "只读"}
              </Badge>
            </div>
            <div className="flex gap-2 max-sm:flex-col">
              <div className="relative min-w-0 flex-1">
                <Icon name="search" size={14} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted-foreground" />
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
                      <SelectItem key={field.value} value={field.value}>{field.label}</SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              <Button
                onClick={() => {
                  const current = sort[0] ?? { field: "task.created_at", direction: "asc" as const };
                  setSort([{ ...current, direction: current.direction === "asc" ? "desc" : "asc" }]);
                  setPage(0);
                }}
              >
                {sort[0]?.direction === "desc" ? "降序" : "升序"}
              </Button>
            </div>
            <div className="flex flex-col gap-1.5">
              {rules.map((rule, index) => (
                <div
                  key={`${index}-${rule.field}`}
                  className="grid grid-cols-[minmax(180px,1fr)_90px_minmax(220px,1.2fr)_32px] items-center gap-2 max-sm:grid-cols-1"
                >
                  <select
                    className={FIELD_CLASS}
                    value={rule.field}
                    onChange={(event) => {
                      const next = [...rules];
                      const nextField = filterFields.find((field) => field.key === event.target.value);
                      next[index] = {
                        field: event.target.value,
                        op: nextField?.operators[0] ?? "eq",
                        value: "",
                      };
                      setRules(next);
                    }}
                  >
                    {!filterFields.some((field) => field.key === rule.field) && (
                      <option value={rule.field}>字段已失效：{rule.field}</option>
                    )}
                    {filterFields.map((field) => (
                      <option key={field.key} value={field.key}>{field.label}</option>
                    ))}
                  </select>
                  <select
                    className={FIELD_CLASS}
                    value={rule.op}
                    onChange={(event) => {
                      const next = [...rules];
                      next[index] = { ...rule, op: event.target.value as TaskFilterOp };
                      setRules(next);
                    }}
                  >
                    {(filterFields.find((field) => field.key === rule.field)?.operators ?? [rule.op]).map((operator) => (
                      <option key={operator} value={operator}>{operatorLabel(operator)}</option>
                    ))}
                  </select>
                  {renderRuleValueControl(rule, index, rules, setRules, filterFields)}
                  <button
                    type="button"
                    className="inline-flex h-8 w-8 cursor-pointer appearance-none items-center justify-center rounded-sm border border-border bg-transparent text-muted-foreground disabled:cursor-default disabled:bg-muted disabled:text-muted-foreground max-sm:w-full"
                    onClick={() => setRules(rules.filter((_, i) => i !== index))}
                    title="移除"
                  >
                    <Icon name="x" size={14} />
                  </button>
                </div>
              ))}
              <Button size="sm" className="w-fit min-w-[112px] justify-start" onClick={() => {
                const field = filterFields[0];
                setRules([...rules, field ? { field: field.key, op: field.operators[0] ?? "eq", value: "" } : { ...EMPTY_RULE }]);
              }}>
                <Icon name="plus" size={12} />条件
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-1.5 border-t border-border pt-2">
              <div className="mr-1 text-xs font-semibold text-muted-foreground">显示列</div>
              {columnOptions.map((column) => (
                <label
                  key={column.key}
                  className="flex min-h-7 min-w-0 items-center gap-1.5 rounded-full border border-border bg-background px-2 py-1 text-xs whitespace-nowrap text-muted-foreground hover:border-border hover:text-foreground"
                >
                  <input
                    type="checkbox"
                    className="cursor-pointer"
                    checked={visibleColumnSet.has(column.key)}
                    disabled={column.key === "display_id"}
                    onChange={(event) => {
                      if (event.target.checked) {
                        setColumns([...columns, column.key]);
                      } else {
                        setColumns(columns.filter((item) => item !== column.key));
                      }
                    }}
                  />
                  {column.label}
                </label>
              ))}
            </div>
          </section>

          <div className="overflow-x-auto rounded-md border border-border bg-card shadow-sm">
            <table className="w-full min-w-[980px] table-fixed border-collapse [&_td]:overflow-hidden [&_td]:border-b [&_td]:border-border [&_td]:px-3 [&_td]:py-2.5 [&_td]:text-left [&_td]:align-middle [&_td]:text-ellipsis [&_td]:whitespace-nowrap [&_th]:overflow-hidden [&_th]:border-b [&_th]:border-border [&_th]:bg-muted [&_th]:px-3 [&_th]:py-2.5 [&_th]:text-left [&_th]:align-middle [&_th]:text-xs [&_th]:font-semibold [&_th]:text-ellipsis [&_th]:whitespace-nowrap [&_th]:text-muted-foreground [&_td:first-child]:w-[140px] [&_th:first-child]:w-[140px] [&_tbody_tr:hover]:bg-muted [&_tr:last-child_td]:border-b-0">
              <thead>
                <tr>
                  {columns.map((column) => (
                    <th key={column}>{columnOptions.find((item) => item.key === column)?.label ?? column}</th>
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
                {tasksQ.isLoading && Array.from({ length: 6 }, (_, rowIndex) => (
                  <tr key={`loading-${rowIndex}`}>
                    {columns.map((column) => (
                      <td key={`loading-${rowIndex}-${column}`}><Skeleton className="h-4 w-full" /></td>
                    ))}
                  </tr>
                ))}
                {tasksQ.isError && (
                  <tr>
                    <td colSpan={Math.max(1, columns.length)} className="text-center text-destructive">
                      无法加载任务，请刷新重试
                    </td>
                  </tr>
                )}
                {!tasksQ.isLoading && !tasksQ.isError && !tasksQ.data?.items.length && (
                  <tr>
                    <td colSpan={Math.max(1, columns.length)} className="text-center text-muted-foreground">无匹配任务</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <footer className="flex items-center justify-between gap-3 px-0.5 pt-2.5 text-xs text-muted-foreground max-sm:flex-col max-sm:items-start">
            <div>
              {[
                ...(debouncedKeyword ? [`关键词 “${debouncedKeyword}”`] : []),
                ...rules
                  .filter((rule) => rule.value.trim() || ["exists", "missing"].includes(rule.op))
                  .map((rule) => `${fieldLabel.get(rule.field) ?? rule.field} ${operatorLabel(rule.op)}`),
              ].join(" / ") || "全部任务"}
            </div>
            <div className="flex items-center gap-2 whitespace-nowrap">
              <Button size="sm" disabled={page <= 0} onClick={() => setPage(page - 1)}>
                <Icon name="chevLeft" size={12} />上一页
              </Button>
              <span>{page + 1} / {totalPages}</span>
              <Button size="sm" disabled={page + 1 >= totalPages} onClick={() => setPage(page + 1)}>
                下一页<Icon name="chevRight" size={12} />
              </Button>
            </div>
          </footer>
        </main>
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
              <Input value={saveName} onChange={(event) => setSaveName(event.target.value)} autoFocus />
            </label>
            <label className="flex flex-col gap-1.5 text-sm">
              可见性
              <select
                className={FIELD_CLASS}
                value={saveVisibility}
                onChange={(event) => setSaveVisibility(event.target.value as "private" | "project")}
              >
                <option value="private">仅自己</option>
                {canManageProject && <option value="project">项目共享</option>}
              </select>
            </label>
          </div>
          <DialogFooter>
            <Button onClick={() => setSaveDialogOpen(false)}>取消</Button>
            <Button variant="primary" onClick={createSavedView} disabled={!saveName.trim() || createView.isPending}>
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <TaskMatchesSheet
        projectId={id}
        task={selectedTask}
        filterJson={filterJson}
        open={Boolean(selectedTask)}
        onOpenChange={(open) => !open && setSelectedTask(null)}
      />
      <AlertDialog open={Boolean(pendingViewKey)} onOpenChange={(open) => !open && setPendingViewKey(null)}>
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
                if (pendingViewKey) setSelectedKey(pendingViewKey);
                setPendingViewKey(null);
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
      return <Badge variant={task.status === "completed" ? "success" : task.status === "review" ? "warning" : "default"}>{statusLabel(task.status)}</Badge>;
    case "annotation_count":
      return task.annotation_count.toLocaleString();
    case "pending_prediction_shape_count":
      return task.pending_prediction_shape_count
        ? <Badge variant="warning">{task.pending_prediction_shape_count}</Badge>
        : "0";
    case "pending_tracker_job_count":
      return task.pending_tracker_job_count
        ? <Badge variant="warning">{task.pending_tracker_job_count}</Badge>
        : "0";
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
    case "avg_prediction_confidence":
      return task.avg_prediction_confidence === null ? "—" : task.avg_prediction_confidence.toFixed(3);
    case "unresolved_feedback_count":
      return task.unresolved_feedback_count ? <Badge variant="warning">{task.unresolved_feedback_count}</Badge> : "0";
    case "model_versions":
      return task.model_versions.length ? task.model_versions.join(", ") : "—";
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
      return task.video_metadata?.duration_ms === null || task.video_metadata?.duration_ms === undefined
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
      return task.calibration_issue_count
        ? <Badge variant="warning">{task.calibration_issue_count}</Badge>
        : "0";
    case "scene_total_frames":
      return task.scene_total_frames ?? "—";
    default:
      return "—";
  }
}
