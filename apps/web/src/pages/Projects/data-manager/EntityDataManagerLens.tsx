import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { useSearchParams } from "react-router-dom";
import { useVirtualizer } from "@tanstack/react-virtual";

import type {
  DataManagerEntityScope,
  DataManagerFilterField,
  DataManagerObject,
  DataManagerTrack,
  TaskFilterOp,
  TaskSortItem,
} from "@/api/taskViews";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { useToastStore } from "@/components/ui/Toast";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/shadcn/ui/dialog";
import { Input } from "@/components/shadcn/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/shadcn/ui/popover";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/shadcn/ui/select";
import { Skeleton } from "@/components/shadcn/ui/skeleton";
import { useAuthStore } from "@/stores/authStore";
import { usePermissions } from "@/hooks/usePermissions";
import {
  useCreateTaskView,
  useDataManagerObjects,
  useDataManagerSchema,
  useDataManagerTracks,
  useDeleteTaskView,
  useTaskViews,
  useUpdateTaskView,
} from "@/hooks/useTaskViews";
import { cn } from "@/lib/utils";
import { DataManagerCharts } from "./DataManagerCharts";
import { DataManagerLensTabs } from "./DataManagerLensTabs";
import { EntityDetailSheet } from "./EntityDetailSheet";
import styles from "./EntityDataManagerLens.module.css";
import {
  parseDataManagerUrl,
  resolveDataManagerSort,
  updateDataManagerUrl,
} from "./dataManagerUrlState";

const PAGE_SIZE = 100;
const FIELD_CLASS =
  "h-8 w-full appearance-none rounded-sm border border-border bg-background px-2 py-1.5 text-foreground disabled:bg-muted disabled:text-muted-foreground";

type EntityScope = Exclude<DataManagerEntityScope, "tasks">;
type FilterNode = Record<string, unknown>;
type EntityRow = DataManagerObject | DataManagerTrack;

function isRule(node: unknown): node is FilterNode & { field: string; op: TaskFilterOp } {
  return Boolean(
    node
      && typeof node === "object"
      && "field" in node
      && typeof (node as { field?: unknown }).field === "string"
      && "op" in node,
  );
}

function splitKeyword(filter: FilterNode): { query: string; filter: FilterNode } {
  if (!filter || !Object.keys(filter).length) return { query: "", filter: {} };
  if (isRule(filter) && filter.field === "task.keyword") {
    return { query: String(filter.value ?? ""), filter: {} };
  }
  if (filter.op === "and" && Array.isArray(filter.rules)) {
    const rules = filter.rules.filter((node) => node && typeof node === "object") as FilterNode[];
    const keyword = rules.find(
      (node) => isRule(node) && node.field === "task.keyword",
    );
    const rest = rules.filter((node) => node !== keyword);
    return {
      query: keyword ? String(keyword.value ?? "") : "",
      filter: rest.length ? { op: "and", rules: rest } : {},
    };
  }
  return { query: "", filter };
}

function combineFilter(query: string, filter: FilterNode): FilterNode {
  const rules: FilterNode[] = [];
  if (query.trim()) {
    rules.push({ field: "task.keyword", op: "contains", value: query.trim() });
  }
  if (filter && Object.keys(filter).length) {
    if (filter.op === "and" && Array.isArray(filter.rules)) {
      rules.push(...(filter.rules as FilterNode[]));
    } else {
      rules.push(filter);
    }
  }
  if (!rules.length) return {};
  return { op: "and", rules };
}

function topLevelRules(filter: FilterNode) {
  if (isRule(filter)) return [{ index: 0, rule: filter }];
  if (!Array.isArray(filter.rules)) return [];
  return (filter.rules as FilterNode[])
    .map((rule, index) => ({ index, rule }))
    .filter((entry) => isRule(entry.rule)) as Array<{
      index: number;
      rule: FilterNode & { field: string; op: TaskFilterOp };
    }>;
}

function normalizeValue(
  value: string,
  op: TaskFilterOp,
  field: DataManagerFilterField | undefined,
) {
  if (op === "exists" || op === "missing") return true;
  if (["in", "between", "contains_any", "contains_all"].includes(op)) {
    const values = value.split(",").map((item) => item.trim()).filter(Boolean);
    return field?.value_type === "number"
      ? values.map(Number).filter(Number.isFinite)
      : values;
  }
  if (field?.value_type === "number") {
    const number = Number(value);
    return Number.isFinite(number) ? number : value;
  }
  if (field?.value_type === "boolean") return value === "true";
  return value.trim();
}

function displayValue(value: unknown) {
  return Array.isArray(value) ? value.join(", ") : String(value ?? "");
}

const SOURCE_LABELS: Record<string, string> = {
  manual: "人工",
  prediction_based: "接受 AI",
  ai_tracker: "AI 追踪",
  interpolated: "插值",
};

function sourceSummary(values: Record<string, number>) {
  const items = Object.entries(values).filter(([, count]) => count > 0);
  return items.length
    ? items.map(([key, count]) => `${SOURCE_LABELS[key] ?? key} ${count}`).join(" / ")
    : "无";
}

function attributeSummary(values: Record<string, unknown>) {
  const items = Object.entries(values).slice(0, 3);
  return items.length
    ? items.map(([key, value]) => `${key}=${String(value)}`).join(" / ")
    : "无";
}

function formatDate(value: string | null) {
  if (!value) return "无";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

const COLUMN_WIDTHS: Record<string, number> = {
  class_name: 150,
  source: 110,
  tool_geometry: 170,
  track_id: 210,
  attributes: 260,
  task_location: 210,
  feedback: 90,
  updated_at: 150,
  confidence: 100,
  created_by: 140,
  annotation_id: 240,
  track_kind: 120,
  range: 150,
  coverage: 150,
  visibility: 150,
  sources: 220,
  quality: 220,
};

function objectCell(row: DataManagerObject, column: string) {
  switch (column) {
    case "class_name": return <span className="font-medium">{row.class_name}</span>;
    case "source": return <Badge variant="outline">{SOURCE_LABELS[row.source] ?? row.source}</Badge>;
    case "tool_geometry": return `${row.tool_unit_id} / ${row.annotation_type}`;
    case "track_id": return row.track_id ? <span className="font-mono">{row.track_id}</span> : "无";
    case "attributes": return attributeSummary(row.attributes);
    case "task_location": return `${row.task_display_id}${row.location.scene_name ? ` / ${row.location.scene_name}` : ""}${row.location.scene_frame_index !== null ? ` / F${row.location.scene_frame_index}` : row.location.video_frame_index !== null ? ` / F${row.location.video_frame_index}` : ""}`;
    case "feedback": return row.unresolved_feedback_count ? <Badge variant="warning">{row.unresolved_feedback_count}</Badge> : "0";
    case "updated_at": return formatDate(row.updated_at);
    case "confidence": return row.confidence === null ? "无" : row.confidence.toFixed(3);
    case "created_by": return row.created_by_name ?? "未知";
    case "annotation_id": return <span className="font-mono">{row.annotation_id}</span>;
    default: return "无";
  }
}

function trackCell(row: DataManagerTrack, column: string) {
  switch (column) {
    case "track_id": return <span className="font-mono">{row.track_id}</span>;
    case "class_name": return row.class_name ?? "不一致";
    case "track_kind": return row.track_kind === "compact_video" ? "视频轨迹" : "Scene 轨迹";
    case "range": return row.start_frame === null ? "跨多个 Scene" : `F${row.start_frame} - F${row.end_frame}`;
    case "coverage": return row.track_kind === "compact_video" ? `${row.keyframe_count} 关键帧` : `${row.occurrence_count} 实例 / ${row.distinct_frame_count} 帧`;
    case "visibility": return `${row.outside_range_count} 不可见 / ${row.occluded_count} 遮挡`;
    case "sources": return sourceSummary(row.sources.annotation_sources);
    case "attributes": return attributeSummary(row.attributes);
    case "quality": return row.quality_issues.length ? row.quality_issues.join(" / ") : "正常";
    default: return "无";
  }
}

function signature(filter: FilterNode, sort: TaskSortItem[], columns: string[]) {
  return JSON.stringify({ filter_json: filter, sort_json: sort, columns_json: columns });
}

export function EntityDataManagerLens({
  projectId,
  projectName,
  projectDisplayId,
  projectOwnerId,
  scope,
  availableScopes,
  onScopeChange,
}: {
  projectId: string;
  projectName: string;
  projectDisplayId: string;
  projectOwnerId: string;
  scope: EntityScope;
  availableScopes: DataManagerEntityScope[];
  onScopeChange: (scope: DataManagerEntityScope) => void;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [initialUrl] = useState(() => parseDataManagerUrl(searchParams));
  const { role } = usePermissions();
  const user = useAuthStore((state) => state.user);
  const pushToast = useToastStore((state) => state.push);
  const viewsQ = useTaskViews(projectId, scope);
  const schemaQ = useDataManagerSchema(projectId, scope);
  const createView = useCreateTaskView(projectId);
  const updateView = useUpdateTaskView(projectId);
  const deleteView = useDeleteTaskView(projectId);
  const [selectedKey, setSelectedKey] = useState(
    initialUrl.lens === scope && initialUrl.view ? initialUrl.view : "builtin:all",
  );
  const [keyword, setKeyword] = useState("");
  const [debouncedKeyword, setDebouncedKeyword] = useState("");
  const [filter, setFilter] = useState<FilterNode>({});
  const [sort, setSort] = useState<TaskSortItem[]>([]);
  const [columns, setColumns] = useState<string[]>([]);
  const [baseline, setBaseline] = useState("");
  const [selected, setSelected] = useState(
    initialUrl.lens === scope ? initialUrl.selected : null,
  );
  const [pendingViewKey, setPendingViewKey] = useState<string | null>(null);
  const [pendingScope, setPendingScope] = useState<DataManagerEntityScope | null>(null);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [saveName, setSaveName] = useState(scope === "objects" ? "对象视图" : "轨迹视图");
  const [saveVisibility, setSaveVisibility] = useState<"private" | "project">("private");
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const hydrationRef = useRef<string | null>(null);
  const tableRef = useRef<HTMLDivElement>(null);

  const views = useMemo(() => viewsQ.data?.items ?? [], [viewsQ.data?.items]);
  const selectedView = useMemo(
    () => views.find((view) => (view.id ? `saved:${view.id}` : `builtin:${view.key}`) === selectedKey) ?? null,
    [selectedKey, views],
  );
  const fields = useMemo(
    () => (schemaQ.data?.filter_fields ?? []).filter((field) => field.key !== "task.keyword"),
    [schemaQ.data?.filter_fields],
  );
  const columnOptions = schemaQ.data?.columns ?? [];
  const defaultColumns = useMemo(
    () => schemaQ.data?.default_columns ?? [],
    [schemaQ.data?.default_columns],
  );

  useEffect(() => {
    if (!views.length) return;
    if (!selectedView) {
      const first = views[0];
      setSelectedKey(first.id ? `saved:${first.id}` : `builtin:${first.key}`);
    }
  }, [selectedView, views]);

  useEffect(() => {
    if (!selectedView || !schemaQ.data) return;
    const hydrationKey = `${scope}:${selectedKey}:${selectedView.updated_at ?? "builtin"}`;
    if (hydrationRef.current === hydrationKey) return;
    const split = splitKeyword(selectedView.filter_json);
    const url = parseDataManagerUrl(searchParams);
    const useUrl = url.lens === scope && (!url.view || url.view === selectedKey);
    const nextFilter = useUrl && url.filter ? url.filter : split.filter;
    const nextKeyword = useUrl && url.query ? url.query : split.query;
    const allowedColumns = new Set(schemaQ.data.columns.map((column) => column.key));
    const restoredColumns = (
      useUrl && url.columns?.length
        ? url.columns
        : selectedView.columns_json.length
          ? selectedView.columns_json
          : defaultColumns
    ).filter((column) => allowedColumns.has(column));
    const nextColumns = restoredColumns.length ? restoredColumns : defaultColumns;
    const nextSort = resolveDataManagerSort(
      useUrl ? url.sort : null,
      selectedView.sort_json,
      schemaQ.data.sort_fields.map((field) => field.value),
      schemaQ.data.sort_fields[0]?.value ?? "track.track_id",
    );
    setFilter(nextFilter);
    setKeyword(nextKeyword);
    setDebouncedKeyword(nextKeyword);
    setColumns(nextColumns);
    setSort(nextSort);
    setBaseline(signature(combineFilter(nextKeyword, nextFilter), nextSort, nextColumns));
    hydrationRef.current = hydrationKey;
  }, [defaultColumns, schemaQ.data, scope, searchParams, selectedKey, selectedView]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedKeyword(keyword), 250);
    return () => window.clearTimeout(timer);
  }, [keyword]);

  const filterJson = useMemo(
    () => combineFilter(debouncedKeyword, filter),
    [debouncedKeyword, filter],
  );
  const currentSignature = useMemo(
    () => signature(filterJson, sort, columns),
    [columns, filterJson, sort],
  );
  const isDirty = Boolean(baseline && baseline !== currentSignature);
  const queryPayload = useMemo(
    () => ({
      filter_json: filterJson,
      sort_json: sort,
      columns_json: columns,
      limit: PAGE_SIZE,
    }),
    [columns, filterJson, sort],
  );
  const queryReady = Boolean(
    selectedView
      && schemaQ.data
      && sort.length
      && sort.every((item) => schemaQ.data?.sort_fields.some((field) => field.value === item.field))
      && columns.length,
  );
  const objectsQ = useDataManagerObjects(projectId, queryPayload, queryReady && scope === "objects");
  const tracksQ = useDataManagerTracks(projectId, queryPayload, queryReady && scope === "tracks");
  const rows = useMemo<EntityRow[]>(
    () => scope === "objects"
      ? objectsQ.data?.pages.flatMap((page) => page.items) ?? []
      : tracksQ.data?.pages.flatMap((page) => page.items) ?? [],
    [objectsQ.data?.pages, scope, tracksQ.data?.pages],
  );
  const activeQ = scope === "objects" ? objectsQ : tracksQ;
  const total = activeQ.data?.pages[0]?.total ?? 0;
  const facets = activeQ.data?.pages[0]?.facets;

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => tableRef.current,
    estimateSize: () => 46,
    overscan: 10,
    getItemKey: (index) => rows[index]?.entity_key ?? index,
  });
  const virtualRows = virtualizer.getVirtualItems();
  const lastVirtualIndex = virtualRows[virtualRows.length - 1]?.index ?? -1;
  const hasNextPage = activeQ.hasNextPage;
  const isFetchingNextPage = activeQ.isFetchingNextPage;
  const fetchNextPage = activeQ.fetchNextPage;
  useEffect(() => {
    if (
      lastVirtualIndex >= rows.length - 10
      && hasNextPage
      && !isFetchingNextPage
    ) {
      void fetchNextPage();
    }
  }, [fetchNextPage, hasNextPage, isFetchingNextPage, lastVirtualIndex, rows.length]);
  useEffect(() => {
    tableRef.current?.scrollTo({ top: 0 });
  }, [filterJson, sort, columns]);

  useEffect(() => {
    if (!hydrationRef.current) return;
    const next = updateDataManagerUrl(searchParams, {
      lens: scope,
      view: selectedKey,
      query: keyword,
      filter,
      sort,
      columns,
      selected,
    });
    if (next.toString() !== searchParams.toString()) {
      setSearchParams(next, { replace: true });
    }
  }, [columns, filter, keyword, scope, searchParams, selected, selectedKey, setSearchParams, sort]);

  const canManageProject = role === "super_admin" || user?.id === projectOwnerId;
  const canEditSelected = Boolean(
    selectedView?.id
      && (selectedView.visibility === "private"
        ? selectedView.owner_id === user?.id || role === "super_admin"
        : canManageProject),
  );

  const saveCurrent = async () => {
    const payload = {
      name: selectedView?.name ?? (scope === "objects" ? "对象视图" : "轨迹视图"),
      visibility: selectedView?.visibility ?? ("private" as const),
      filter_json: filterJson,
      sort_json: sort,
      columns_json: columns,
    };
    if (canEditSelected && selectedView?.id) {
      try {
        await updateView.mutateAsync({ viewId: selectedView.id, payload });
        setBaseline(currentSignature);
        pushToast({ msg: "视图已保存", kind: "success" });
      } catch {
        pushToast({ msg: "无法保存视图", kind: "error" });
      }
      return;
    }
    setSaveName(`${selectedView?.name ?? (scope === "objects" ? "对象视图" : "轨迹视图")} 副本`);
    setSaveVisibility("private");
    setSaveDialogOpen(true);
  };

  const createSavedView = async () => {
    if (!saveName.trim()) return;
    try {
      const created = await createView.mutateAsync({
        name: saveName.trim(),
        visibility: saveVisibility,
        entity_scope: scope,
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

  const deleteCurrent = async () => {
    if (!selectedView?.id || !canEditSelected) return;
    try {
      await deleteView.mutateAsync(selectedView.id);
      setSelectedKey("builtin:all");
      setDeleteDialogOpen(false);
      pushToast({ msg: "视图已删除", kind: "success" });
    } catch {
      pushToast({ msg: "无法删除视图", kind: "error" });
    }
  };

  const gridTemplate = columns
    .map((column) => `${COLUMN_WIDTHS[column] ?? 150}px`)
    .join(" ");
  const topRules = topLevelRules(filter);
  const hasNestedRules = Boolean(
    Array.isArray(filter.rules)
      && (filter.rules as FilterNode[]).some((node) => !isRule(node)),
  );

  const updateRule = (index: number, patch: FilterNode) => {
    const rules = Array.isArray(filter.rules) ? [...(filter.rules as FilterNode[])] : [filter];
    rules[index] = { ...rules[index], ...patch };
    setFilter({ op: "and", rules });
  };

  return (
    <div className="mx-auto max-w-[1800px] px-4 pt-4 pb-8 text-foreground md:px-7">
      <DataManagerLensTabs
        scope={scope}
        availableScopes={availableScopes}
        onScopeChange={(nextScope) => {
          if (nextScope === scope) return;
          if (isDirty) setPendingScope(nextScope);
          else onScopeChange(nextScope);
        }}
      >
        <header className="mb-4 flex items-start justify-between gap-4 max-md:flex-col">
          <div>
            <h1 className="text-xl font-semibold">{projectName} / Data Manager</h1>
            <p className="mt-1 text-xs text-muted-foreground">
              <span className="font-mono">{projectDisplayId}</span>
              {` / ${facets?.task_total ?? 0} 个可见任务 / ${total} 条${scope === "objects" ? "对象" : "轨迹"}`}
            </p>
          </div>
          <div className="flex gap-2">
            <Button onClick={() => activeQ.refetch()} disabled={activeQ.isFetching}>
              <Icon name="refresh" size={12} />刷新
            </Button>
            <Button variant="primary" onClick={saveCurrent} disabled={createView.isPending || updateView.isPending}>
              <Icon name="save" size={12} />保存视图
            </Button>
          </div>
        </header>

        <div className="mb-5 border-y border-border py-4">
          <DataManagerCharts
            scope={scope}
            facets={facets}
            isLoading={activeQ.isLoading}
          />
        </div>

        <div className="grid grid-cols-[210px_minmax(0,1fr)] gap-4 max-lg:grid-cols-1">
          <aside className="self-start rounded-md border border-border bg-card p-2 lg:sticky lg:top-4">
            <div className="px-1 pb-2 text-xs font-semibold text-muted-foreground">{scope === "objects" ? "对象视图" : "轨迹视图"}</div>
            <div className="flex flex-col gap-0.5 max-lg:grid max-lg:grid-cols-2 max-sm:grid-cols-1">
              {views.map((view) => {
                const key = view.id ? `saved:${view.id}` : `builtin:${view.key}`;
                return (
                  <button
                    key={`${scope}:${key}`}
                    type="button"
                    className={cn(
                      "flex min-h-9 items-center justify-between gap-2 rounded-sm px-2 text-left text-sm text-muted-foreground hover:bg-muted hover:text-foreground",
                      key === selectedKey && "bg-muted text-foreground",
                    )}
                    onClick={() => {
                      if (key === selectedKey) return;
                      if (isDirty) setPendingViewKey(key);
                      else setSelectedKey(key);
                    }}
                  >
                    <span className="truncate">{view.name}</span>
                    <Badge variant={view.invalid_fields.length ? "warning" : "outline"}>
                      {view.invalid_fields.length ? "失效" : view.result_count ?? "无"}
                    </Badge>
                  </button>
                );
              })}
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="mt-2 w-full justify-start"
              disabled={!canEditSelected || deleteView.isPending}
              onClick={() => setDeleteDialogOpen(true)}
            >
              <Icon name="trash" size={12} />删除视图
            </Button>
          </aside>

          <main className="min-w-0">
            <section className="mb-3 flex flex-col gap-3 rounded-md border border-border bg-card p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold">{selectedView?.name ?? "视图"}</h2>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    已加载 {rows.length.toLocaleString()} / {total.toLocaleString()}
                  </p>
                </div>
                <Badge variant={isDirty ? "warning" : canEditSelected ? "accent" : "outline"}>
                  {isDirty ? "未保存" : canEditSelected ? "可编辑" : "只读"}
                </Badge>
              </div>
              <div className="flex gap-2 max-md:flex-col">
                <div className="relative min-w-0 flex-1">
                  <Icon name="search" size={14} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={keyword}
                    onChange={(event) => setKeyword(event.target.value)}
                    placeholder="搜索任务、文件或 Scene"
                    aria-label="搜索任务、文件或 Scene"
                    className="h-9 pl-8"
                  />
                </div>
                <Select
                  value={sort[0]?.field}
                  onValueChange={(field) => setSort([{ field, direction: sort[0]?.direction ?? "asc" }])}
                >
                  <SelectTrigger className="w-44"><SelectValue placeholder="排序字段" /></SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {(schemaQ.data?.sort_fields ?? []).map((item) => (
                        <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <Button onClick={() => {
                  const current = sort[0];
                  if (current) setSort([{ ...current, direction: current.direction === "asc" ? "desc" : "asc" }]);
                }}>
                  {sort[0]?.direction === "desc" ? "降序" : "升序"}
                </Button>
                <Popover>
                  <PopoverTrigger asChild><Button>列设置</Button></PopoverTrigger>
                  <PopoverContent align="end" className="w-64">
                    <div className="flex flex-col gap-2">
                      <div className="text-sm font-medium">显示列</div>
                      {columnOptions.map((column) => (
                        <label key={column.key} className="flex min-h-8 items-center gap-2 text-xs">
                          <input
                            type="checkbox"
                            checked={columns.includes(column.key)}
                            disabled={columns.length === 1 && columns.includes(column.key)}
                            onChange={(event) => setColumns(
                              event.target.checked
                                ? [...columns, column.key]
                                : columns.filter((item) => item !== column.key),
                            )}
                          />
                          <span>{column.label}</span>
                        </label>
                      ))}
                    </div>
                  </PopoverContent>
                </Popover>
              </div>

              {topRules.map(({ index, rule }) => {
                const field = fields.find((item) => item.key === rule.field);
                const rawValue = displayValue(rule.value);
                return (
                  <div key={`${index}:${rule.field}`} className="grid grid-cols-[minmax(180px,1fr)_100px_minmax(180px,1fr)_32px] gap-2 max-md:grid-cols-1">
                    <select
                      className={FIELD_CLASS}
                      value={rule.field}
                      onChange={(event) => {
                        const nextField = fields.find((item) => item.key === event.target.value);
                        updateRule(index, { field: event.target.value, op: nextField?.operators[0] ?? "eq", value: "" });
                      }}
                    >
                      {!field && <option value={rule.field}>字段已失效：{rule.field}</option>}
                      {fields.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
                    </select>
                    <select
                      className={FIELD_CLASS}
                      value={rule.op}
                      onChange={(event) => updateRule(index, { op: event.target.value })}
                    >
                      {(field?.operators ?? [rule.op]).map((op) => <option key={op} value={op}>{op}</option>)}
                    </select>
                    {rule.op === "exists" || rule.op === "missing" ? (
                      <input className={FIELD_CLASS} value="无需填写" readOnly disabled />
                    ) : field?.value_type === "boolean" ? (
                      <select className={FIELD_CLASS} value={rawValue || "true"} onChange={(event) => updateRule(index, { value: event.target.value === "true" })}>
                        <option value="true">是</option><option value="false">否</option>
                      </select>
                    ) : (
                      <input
                        className={FIELD_CLASS}
                        value={rawValue}
                        onChange={(event) => updateRule(index, { value: normalizeValue(event.target.value, rule.op, field) })}
                        placeholder={["in", "between", "contains_any", "contains_all"].includes(rule.op) ? "多个值用逗号分隔" : undefined}
                      />
                    )}
                    <button
                      type="button"
                      aria-label="移除筛选条件"
                      className="flex size-8 items-center justify-center rounded-sm border border-border text-muted-foreground hover:bg-muted max-md:w-full"
                      onClick={() => {
                        const rules = Array.isArray(filter.rules) ? [...(filter.rules as FilterNode[])] : [];
                        rules.splice(index, 1);
                        setFilter(rules.length ? { op: "and", rules } : {});
                      }}
                    >
                      <Icon name="x" size={14} />
                    </button>
                  </div>
                );
              })}
              {hasNestedRules && (
                <div className="text-xs text-muted-foreground">
                  当前视图包含高级组合条件。系统会原样保留，未在这里静默改写。
                </div>
              )}
              <Button
                size="sm"
                className="w-fit"
                disabled={!fields.length}
                onClick={() => {
                  const field = fields[0];
                  const nextRule = { field: field.key, op: field.operators[0] ?? "eq", value: "" };
                  const rules = Array.isArray(filter.rules)
                    ? [...(filter.rules as FilterNode[]), nextRule]
                    : Object.keys(filter).length ? [filter, nextRule] : [nextRule];
                  setFilter({ op: "and", rules });
                }}
              >
                <Icon name="plus" size={12} />添加筛选
              </Button>
            </section>

            <div
              ref={tableRef}
              role="table"
              aria-rowcount={total}
              className="relative h-[60dvh] min-h-[420px] overflow-auto rounded-md border border-border bg-card"
            >
              <div
                role="row"
                className={cn(
                  styles.entityGrid,
                  "sticky top-0 z-base min-w-max border-b border-border bg-muted",
                )}
                // eslint-disable-next-line no-restricted-syntax -- schema columns determine the grid at runtime.
                style={{ "--dm-grid-columns": gridTemplate } as CSSProperties}
              >
                {columns.map((column) => {
                  const schemaColumn = columnOptions.find((item) => item.key === column);
                  const activeSort = schemaColumn?.sort_field === sort[0]?.field;
                  return (
                    <button
                      key={column}
                      type="button"
                      role="columnheader"
                      aria-sort={activeSort ? (sort[0]?.direction === "desc" ? "descending" : "ascending") : "none"}
                      disabled={!schemaColumn?.sortable}
                      className="flex h-10 items-center gap-1 px-3 text-left text-xs font-semibold text-muted-foreground disabled:cursor-default"
                      onClick={() => {
                        if (!schemaColumn?.sort_field) return;
                        setSort([{ field: schemaColumn.sort_field, direction: activeSort && sort[0]?.direction === "asc" ? "desc" : "asc" }]);
                      }}
                    >
                      {schemaColumn?.label ?? column}
                      {activeSort && <span aria-hidden="true">{sort[0]?.direction === "desc" ? "↓" : "↑"}</span>}
                    </button>
                  );
                })}
              </div>
              {activeQ.isLoading && (
                <div className="flex flex-col gap-2 p-3">
                  {Array.from({ length: 8 }, (_, index) => <Skeleton key={index} className="h-10 w-full" />)}
                </div>
              )}
              {activeQ.isError && (
                <div className="flex h-64 items-center justify-center text-sm text-destructive">无法加载当前视图</div>
              )}
              {!activeQ.isLoading && !activeQ.isError && !rows.length && (
                <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">当前条件没有匹配结果</div>
              )}
              {!!rows.length && (
                <div
                  className={cn(styles.virtualCanvas, "relative min-w-max")}
                  // eslint-disable-next-line no-restricted-syntax -- virtualizer computes the scroll canvas height.
                  style={{ "--dm-virtual-height": `${virtualizer.getTotalSize()}px` } as CSSProperties}
                >
                  {virtualRows.map((virtualRow) => {
                    const row = rows[virtualRow.index];
                    const entitySelected = selected === (scope === "objects" ? (row as DataManagerObject).annotation_id : (row as DataManagerTrack).track_ref);
                    return (
                      <button
                        key={row.entity_key}
                        type="button"
                        role="row"
                        aria-selected={entitySelected}
                        className={cn(
                          styles.virtualRow,
                          "absolute left-0 grid h-[46px] min-w-max border-b border-border text-left text-xs hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                          entitySelected && "bg-muted",
                        )}
                        // eslint-disable-next-line no-restricted-syntax -- virtualizer provides each row offset at runtime.
                        style={{
                          "--dm-grid-columns": gridTemplate,
                          "--dm-row-offset": `${virtualRow.start}px`,
                        } as CSSProperties}
                        onClick={() => setSelected(
                          scope === "objects"
                            ? (row as DataManagerObject).annotation_id
                            : (row as DataManagerTrack).track_ref,
                        )}
                      >
                        {columns.map((column) => {
                          const content = scope === "objects"
                            ? objectCell(row as DataManagerObject, column)
                            : trackCell(row as DataManagerTrack, column);
                          return (
                            <span
                              key={`${row.entity_key}:${column}`}
                              role="cell"
                              className="flex min-w-0 items-center overflow-hidden px-3 text-ellipsis whitespace-nowrap"
                              title={typeof content === "string" ? content : undefined}
                            >
                              {content}
                            </span>
                          );
                        })}
                      </button>
                    );
                  })}
                </div>
              )}
              {activeQ.isFetchingNextPage && (
                <div className="sticky bottom-0 bg-card py-2 text-center text-xs text-muted-foreground">正在加载更多</div>
              )}
            </div>
          </main>
        </div>
      </DataManagerLensTabs>

      <EntityDetailSheet
        projectId={projectId}
        scope={scope}
        selected={selected}
        onOpenChange={(open) => !open && setSelected(null)}
      />

      <Dialog open={saveDialogOpen} onOpenChange={setSaveDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>保存{scope === "objects" ? "对象" : "轨迹"}视图</DialogTitle>
            <DialogDescription>保存当前筛选、排序和列设置。</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1.5 text-sm">
              视图名称
              <Input value={saveName} onChange={(event) => setSaveName(event.target.value)} autoFocus />
            </label>
            <label className="flex flex-col gap-1.5 text-sm">
              可见性
              <select className={FIELD_CLASS} value={saveVisibility} onChange={(event) => setSaveVisibility(event.target.value as "private" | "project")}>
                <option value="private">仅自己</option>
                {canManageProject && <option value="project">项目共享</option>}
              </select>
            </label>
          </div>
          <DialogFooter>
            <Button onClick={() => setSaveDialogOpen(false)}>取消</Button>
            <Button variant="primary" onClick={createSavedView} disabled={!saveName.trim() || createView.isPending}>保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(pendingViewKey || pendingScope)} onOpenChange={(open) => {
        if (!open) { setPendingViewKey(null); setPendingScope(null); }
      }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>放弃未保存的修改？</AlertDialogTitle>
            <AlertDialogDescription>切换后，当前筛选、排序或列设置的未保存修改会丢失。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>继续编辑</AlertDialogCancel>
            <AlertDialogAction onClick={() => {
              if (pendingViewKey) setSelectedKey(pendingViewKey);
              if (pendingScope) onScopeChange(pendingScope);
              setPendingViewKey(null);
              setPendingScope(null);
            }}>放弃并切换</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除“{selectedView?.name}”？</AlertDialogTitle>
            <AlertDialogDescription>只删除保存的视图配置，不会删除任何标注或轨迹。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={deleteCurrent}>确认删除</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
