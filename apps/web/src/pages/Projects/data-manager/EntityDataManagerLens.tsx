import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useSearchParams } from "react-router-dom";
import { useVirtualizer } from "@tanstack/react-virtual";

import type {
  DataManagerEntityScope,
  DataManagerFilterField,
  DataManagerObject,
  DataManagerTrack,
  TaskFilterOp,
  TaskFilterRule,
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
import { FilterValueEditor } from "@/components/filters/FilterValueEditor";
import { useFilterDraftValidity } from "@/components/filters/useFilterDraftValidity";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/shadcn/ui/popover";
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
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { filterOperatorLabel } from "@/lib/filters/types";
import {
  combineKeyword,
  collapseEmptyGroups,
  hasNestedGroups,
  isExpressionValid,
  isEmptyFilter,
  isFilterGroup,
  isFilterRule,
  removeAtPath,
  splitKeyword,
  updateRuleAtPath,
  validateFilterStructure,
  type DataManagerFilterExpression,
} from "./dataManagerFilterExpression";
import { DataManagerExpressionEditor } from "./DataManagerExpressionEditor";
import { DataManagerAnalyticsPanel } from "./DataManagerAnalyticsPanel";
import { DataManagerFilterBar, type DataManagerFilterChip } from "./DataManagerFilterBar";
import { DataManagerLensTabs } from "./DataManagerLensTabs";
import { EntityDetailSheet } from "./EntityDetailSheet";
import styles from "./EntityDataManagerLens.module.css";
import {
  DATA_MANAGER_FILTER_KEYS,
  dataManagerUrlCodec,
  hasFilterUrlOverrides,
  resolveDataManagerSort,
  updateDataManagerUrl,
} from "./dataManagerUrlState";
import { useUrlFilterState } from "@/hooks/useUrlFilterState";

const PAGE_SIZE = 100;
const FIELD_CLASS =
  "h-8 w-full appearance-none rounded-sm border border-border bg-background px-2 py-1.5 text-foreground disabled:bg-muted disabled:text-muted-foreground";

type EntityScope = Exclude<DataManagerEntityScope, "tasks">;
type FilterNode = DataManagerFilterExpression;
type EntityRow = DataManagerObject | DataManagerTrack;

function displayValue(value: unknown) {
  return Array.isArray(value) ? value.join(", ") : String(value ?? "");
}

function entityRuleSummary(
  rule: FilterNode & { field: string; op: TaskFilterOp },
  field: DataManagerFilterField | undefined,
) {
  if (rule.op === "exists" || rule.op === "missing") return filterOperatorLabel(rule.op);
  if (rule.value === null) return `${filterOperatorLabel(rule.op)} 空值`;
  const raw = displayValue(rule.value);
  const option = field?.options.find((item) => item.value === raw);
  return `${filterOperatorLabel(rule.op)} ${(option?.label ?? raw) || "未填写"}`;
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
  return items.length ? items.map(([key, value]) => `${key}=${String(value)}`).join(" / ") : "无";
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
    case "class_name":
      return <span className="font-medium">{row.class_name}</span>;
    case "source":
      return <Badge variant="outline">{SOURCE_LABELS[row.source] ?? row.source}</Badge>;
    case "tool_geometry":
      return `${row.tool_unit_id} / ${row.annotation_type}`;
    case "track_id":
      return row.track_id ? <span className="font-mono">{row.track_id}</span> : "无";
    case "attributes":
      return attributeSummary(row.attributes);
    case "task_location":
      return `${row.task_display_id}${row.location.scene_name ? ` / ${row.location.scene_name}` : ""}${row.location.scene_frame_index !== null ? ` / F${row.location.scene_frame_index}` : row.location.video_frame_index !== null ? ` / F${row.location.video_frame_index}` : ""}`;
    case "feedback":
      return row.unresolved_feedback_count ? (
        <Badge variant="warning">{row.unresolved_feedback_count}</Badge>
      ) : (
        "0"
      );
    case "updated_at":
      return formatDate(row.updated_at);
    case "confidence":
      return row.confidence === null ? "无" : row.confidence.toFixed(3);
    case "created_by":
      return row.created_by_name ?? "未知";
    case "annotation_id":
      return <span className="font-mono">{row.annotation_id}</span>;
    default:
      return "无";
  }
}

function trackCell(row: DataManagerTrack, column: string) {
  switch (column) {
    case "track_id":
      return <span className="font-mono">{row.track_id}</span>;
    case "class_name":
      return row.class_name ?? "不一致";
    case "track_kind":
      return row.track_kind === "compact_video" ? "视频轨迹" : "Scene 轨迹";
    case "range":
      return row.start_frame === null ? "跨多个 Scene" : `F${row.start_frame} - F${row.end_frame}`;
    case "coverage":
      return row.track_kind === "compact_video"
        ? `${row.keyframe_count} 关键帧`
        : `${row.occurrence_count} 实例 / ${row.distinct_frame_count} 帧`;
    case "visibility":
      return `${row.outside_range_count} 不可见 / ${row.occluded_count} 遮挡`;
    case "sources":
      return sourceSummary(row.sources.annotation_sources);
    case "attributes":
      return attributeSummary(row.attributes);
    case "quality":
      return row.quality_issues.length ? row.quality_issues.join(" / ") : "正常";
    default:
      return "无";
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
  const urlState = useUrlFilterState({
    codec: dataManagerUrlCodec,
    ownedKeys: DATA_MANAGER_FILTER_KEYS,
    defaults: {
      lens: scope,
      view: null,
      query: "",
      filter: null,
      sort: null,
      columns: null,
      selected: null,
    },
  });
  const currentUrl = urlState.state;
  const { role } = usePermissions();
  const user = useAuthStore((state) => state.user);
  const pushToast = useToastStore((state) => state.push);
  const viewsQ = useTaskViews(projectId, scope);
  const schemaQ = useDataManagerSchema(projectId, scope);
  const createView = useCreateTaskView(projectId);
  const updateView = useUpdateTaskView(projectId);
  const deleteView = useDeleteTaskView(projectId);
  const [selectedKey, setSelectedKey] = useState(
    currentUrl.lens === scope && currentUrl.view ? currentUrl.view : "builtin:all",
  );
  const draftOwner = `${projectId}:${user?.id ?? "anonymous"}:${scope}:${selectedKey}`;
  const mutationOwnerRef = useRef(draftOwner);
  mutationOwnerRef.current = draftOwner;
  const { hasInvalidDraft, onDraftValidityChange } = useFilterDraftValidity(draftOwner);
  const [keyword, setKeyword] = useState("");
  const [keywordFlushKey, setKeywordFlushKey] = useState(0);
  const debouncedKeyword = useDebouncedValue(keyword, 250, keywordFlushKey);
  const [filter, setFilter] = useState<FilterNode>({});
  const [appliedFilter, setAppliedFilter] = useState<FilterNode>({});
  const [sort, setSort] = useState<TaskSortItem[]>([]);
  const [columns, setColumns] = useState<string[]>([]);
  const [baseline, setBaseline] = useState("");
  const [selected, setSelected] = useState(currentUrl.lens === scope ? currentUrl.selected : null);
  const [pendingViewKey, setPendingViewKey] = useState<string | null>(null);
  const [pendingScope, setPendingScope] = useState<DataManagerEntityScope | null>(null);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [saveName, setSaveName] = useState(scope === "objects" ? "对象视图" : "轨迹视图");
  const [saveVisibility, setSaveVisibility] = useState<"private" | "project">("private");
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [analyticsOpen, setAnalyticsOpen] = useState(
    () => typeof window !== "undefined" && localStorage.getItem("dm-analytics-open") === "1",
  );
  const hydrationRef = useRef<string | null>(null);
  const lastWrittenUrlRef = useRef<string | null>(null);
  const pendingViewKeyRef = useRef<string | null>(null);
  const mountedRef = useRef(false);
  const skipUrlSyncRef = useRef(false);
  const previousUrlRef = useRef(searchParams.toString());
  const tableRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const views = useMemo(() => viewsQ.data?.items ?? [], [viewsQ.data?.items]);
  const selectedView = useMemo(
    () =>
      views.find(
        (view) => (view.id ? `saved:${view.id}` : `builtin:${view.key}`) === selectedKey,
      ) ?? null,
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
    if (lastWrittenUrlRef.current === searchParams.toString()) return;
    if (pendingViewKeyRef.current === selectedKey) return;
    const requestedKey =
      currentUrl.lens === scope && currentUrl.view ? currentUrl.view : "builtin:all";
    if (requestedKey !== selectedKey) {
      hydrationRef.current = null;
      setSelectedKey(requestedKey);
    }
  }, [currentUrl.lens, currentUrl.view, scope, searchParams, selectedKey]);

  useEffect(() => {
    const urlString = searchParams.toString();
    if (previousUrlRef.current === urlString) return;
    previousUrlRef.current = urlString;
    if (lastWrittenUrlRef.current === urlString) return;
    const nextSelected = currentUrl.lens === scope ? currentUrl.selected : null;
    if (nextSelected !== selected) setSelected(nextSelected);
  }, [currentUrl.lens, currentUrl.selected, scope, searchParams, selected]);

  useEffect(() => {
    if (!views.length) return;
    if (!selectedView) {
      const first = views[0];
      const firstKey = first.id ? `saved:${first.id}` : `builtin:${first.key}`;
      hydrationRef.current = null;
      setSelectedKey(firstKey);
      setSearchParams(
        updateDataManagerUrl(searchParams, {
          lens: scope,
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
  }, [currentUrl, searchParams, scope, selectedView, setSearchParams, views]);

  useEffect(() => {
    if (!selectedView || !schemaQ.data) return;
    const url = currentUrl;
    const useUrl =
      url.lens === scope &&
      (!url.view || url.view === selectedKey) &&
      hasFilterUrlOverrides(searchParams);
    if (lastWrittenUrlRef.current === searchParams.toString()) {
      lastWrittenUrlRef.current = null;
      if (pendingViewKeyRef.current !== selectedKey) return;
      pendingViewKeyRef.current = null;
    }
    const hydrationKey = `${scope}:${selectedKey}:${selectedView.updated_at ?? "builtin"}:${useUrl ? searchParams.toString() : "view"}`;
    if (hydrationRef.current === hydrationKey) return;
    const source = (useUrl && url.filter ? url.filter : selectedView.filter_json) as
      | DataManagerFilterExpression
      | Record<string, unknown>;
    const structureIssue = validateFilterStructure(source);
    const restored = structureIssue ? source : collapseEmptyGroups(source);
    const split = structureIssue ? { query: "", filter: restored } : splitKeyword(restored);
    const nextFilter = split.filter;
    const nextKeyword = useUrl ? url.query : split.query;
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
    setAppliedFilter(nextFilter);
    setKeyword(nextKeyword);
    setKeywordFlushKey((value) => value + 1);
    setColumns(nextColumns);
    setSort(nextSort);
    setBaseline(
      structureIssue
        ? ""
        : signature(combineKeyword(nextKeyword, nextFilter), nextSort, nextColumns),
    );
    hydrationRef.current = hydrationKey;
    skipUrlSyncRef.current = true;
  }, [currentUrl, defaultColumns, schemaQ.data, scope, searchParams, selectedKey, selectedView]);

  const expressionValid = useMemo(() => isExpressionValid(filter, fields), [fields, filter]);
  const filterStructureIssue = useMemo(() => validateFilterStructure(filter), [filter]);
  const filterReady = expressionValid && !hasInvalidDraft;
  useEffect(() => {
    if (expressionValid) setAppliedFilter(filter);
  }, [expressionValid, filter]);
  const queryFilter = useMemo(
    () => (filterReady ? filter : filterStructureIssue ? {} : appliedFilter),
    [appliedFilter, filter, filterReady, filterStructureIssue],
  );
  const filterJson = useMemo(
    () => combineKeyword(debouncedKeyword, queryFilter),
    [debouncedKeyword, queryFilter],
  );
  const currentSignature = useMemo(
    () => signature(filterJson, sort, columns),
    [columns, filterJson, sort],
  );
  const isDirty = Boolean(baseline && (!filterReady || baseline !== currentSignature));
  const selectionFilterSignatureRef = useRef<string | null>(null);
  useEffect(() => {
    if (!hydrationRef.current) return;
    if (selectionFilterSignatureRef.current === null) {
      selectionFilterSignatureRef.current = currentSignature;
      return;
    }
    if (selectionFilterSignatureRef.current !== currentSignature) {
      selectionFilterSignatureRef.current = currentSignature;
      setSelected(null);
    }
  }, [currentSignature]);
  const queryPayload = useMemo(
    () => ({
      filter_json: filterJson as Record<string, unknown>,
      sort_json: sort,
      columns_json: columns,
      limit: PAGE_SIZE,
    }),
    [columns, filterJson, sort],
  );
  const queryReady = Boolean(
    selectedView &&
    schemaQ.data &&
    hydrationRef.current &&
    expressionValid &&
    sort.length &&
    sort.every((item) => schemaQ.data?.sort_fields.some((field) => field.value === item.field)) &&
    columns.length,
  );
  const objectsQ = useDataManagerObjects(
    projectId,
    queryPayload,
    queryReady && scope === "objects",
  );
  const tracksQ = useDataManagerTracks(projectId, queryPayload, queryReady && scope === "tracks");
  const rows = useMemo<EntityRow[]>(
    () =>
      scope === "objects"
        ? (objectsQ.data?.pages.flatMap((page) => page.items) ?? [])
        : (tracksQ.data?.pages.flatMap((page) => page.items) ?? []),
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
    if (lastVirtualIndex >= rows.length - 10 && hasNextPage && !isFetchingNextPage) {
      void fetchNextPage();
    }
  }, [fetchNextPage, hasNextPage, isFetchingNextPage, lastVirtualIndex, rows.length]);
  useEffect(() => {
    const table = tableRef.current;
    if (table && typeof table.scrollTo === "function") table.scrollTo({ top: 0 });
  }, [filterJson, sort, columns]);

  useEffect(() => {
    if (!hydrationRef.current || skipUrlSyncRef.current || !filterReady) {
      skipUrlSyncRef.current = false;
      return;
    }
    const next = updateDataManagerUrl(searchParams, {
      lens: scope,
      view: selectedKey,
      query: keyword,
      filter: queryFilter as Record<string, unknown>,
      sort,
      columns,
      selected,
    });
    if (next.toString() !== searchParams.toString()) {
      lastWrittenUrlRef.current = next.toString();
      setSearchParams(next, { replace: true });
    }
  }, [
    columns,
    keyword,
    queryFilter,
    scope,
    searchParams,
    selected,
    selectedKey,
    setSearchParams,
    sort,
    filterReady,
  ]);

  const canManageProject = role === "super_admin" || user?.id === projectOwnerId;
  const canEditSelected = Boolean(
    selectedView?.id &&
    (selectedView.visibility === "private"
      ? selectedView.owner_id === user?.id || role === "super_admin"
      : canManageProject),
  );

  const switchView = (key: string) => {
    const next = updateDataManagerUrl(searchParams, {
      lens: scope,
      view: key,
      query: "",
      filter: null,
      sort: null,
      columns: null,
      selected: null,
    });
    hydrationRef.current = null;
    skipUrlSyncRef.current = false;
    pendingViewKeyRef.current = key;
    lastWrittenUrlRef.current = next.toString();
    setSelectedKey(key);
    setSearchParams(next);
  };

  const saveCurrent = async () => {
    if (!filterReady) {
      pushToast({ msg: "请先完成筛选条件", kind: "warning" });
      return;
    }
    const ownerAtStart = draftOwner;
    const payload = {
      name: selectedView?.name ?? (scope === "objects" ? "对象视图" : "轨迹视图"),
      visibility: selectedView?.visibility ?? ("private" as const),
      filter_json: filterJson as Record<string, unknown>,
      sort_json: sort,
      columns_json: columns,
    };
    if (canEditSelected && selectedView?.id) {
      try {
        await updateView.mutateAsync({ viewId: selectedView.id, payload });
        if (!mountedRef.current || mutationOwnerRef.current !== ownerAtStart) return;
        setBaseline(currentSignature);
        pushToast({ msg: "视图已保存", kind: "success" });
      } catch {
        if (!mountedRef.current || mutationOwnerRef.current !== ownerAtStart) return;
        pushToast({ msg: "无法保存视图", kind: "error" });
      }
      return;
    }
    setSaveName(`${selectedView?.name ?? (scope === "objects" ? "对象视图" : "轨迹视图")} 副本`);
    setSaveVisibility("private");
    setSaveDialogOpen(true);
  };

  const createSavedView = async () => {
    if (!saveName.trim() || !filterReady) return;
    const ownerAtStart = draftOwner;
    try {
      const created = await createView.mutateAsync({
        name: saveName.trim(),
        visibility: saveVisibility,
        entity_scope: scope,
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

  const deleteCurrent = async () => {
    if (!selectedView?.id || !canEditSelected) return;
    try {
      await deleteView.mutateAsync(selectedView.id);
      switchView("builtin:all");
      setDeleteDialogOpen(false);
      pushToast({ msg: "视图已删除", kind: "success" });
    } catch {
      pushToast({ msg: "无法删除视图", kind: "error" });
    }
  };

  const gridTemplate = columns.map((column) => `${COLUMN_WIDTHS[column] ?? 150}px`).join(" ");
  const expressionRuleEntries = isFilterGroup(filter)
    ? (filter.rules
        .map((rule, index) => ({ rule, path: [index] }))
        .filter(({ rule }) => isFilterRule(rule)) as Array<{
        rule: FilterNode & { field: string; op: TaskFilterOp };
        path: number[];
      }>)
    : isFilterRule(filter)
      ? [{ rule: filter, path: [] }]
      : [];
  const topRuleEntries = expressionRuleEntries;
  // 图表交叉筛选：点柱子 → 切换一条 `field eq value`（已存在则移除，实现 toggle）。
  const toggleFacetRule = (field: string, value: string) => {
    if (!fields.some((item) => item.key === field)) return;
    const existing =
      !isFilterGroup(filter) || filter.op === "and"
        ? expressionRuleEntries.find(
            ({ rule }) => rule.field === field && rule.op === "eq" && String(rule.value) === value,
          )
        : undefined;
    if (existing) {
      setFilter(removeAtPath(filter, existing.path));
      return;
    }
    const nextRule: TaskFilterRule = { field, op: "eq", value };
    setFilter(isEmptyFilter(filter) ? nextRule : { op: "and", rules: [filter, nextRule] });
  };
  const toggleAnalytics = () => {
    setAnalyticsOpen((value) => {
      const next = !value;
      localStorage.setItem("dm-analytics-open", next ? "1" : "0");
      return next;
    });
  };
  const filterChips: DataManagerFilterChip[] = topRuleEntries.map(({ rule, path }) => {
    const field = fields.find((item) => item.key === rule.field);
    return {
      id: `${path.join(".")}:${rule.field}`,
      label: field?.label ?? rule.field,
      value: entityRuleSummary(rule, field),
      editor: (
        <div className="flex flex-col gap-2">
          <select
            className={FIELD_CLASS}
            value={rule.op}
            onChange={(event) =>
              setFilter(
                updateRuleAtPath(filter, path, (item) => ({
                  ...item,
                  op: event.target.value as TaskFilterOp,
                })),
              )
            }
          >
            {(field?.operators ?? [rule.op]).map((op) => (
              <option key={op} value={op}>
                {filterOperatorLabel(op)}
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
                setFilter(updateRuleAtPath(filter, path, (item) => ({ ...item, value })))
              }
            />
          ) : (
            <div role="alert" className="text-xs text-destructive">
              当前字段不在 schema 中，无法执行条件
            </div>
          )}
          <Button variant="ghost" size="sm" onClick={() => setFilter(removeAtPath(filter, path))}>
            <Icon name="trash" size={12} />
            移除条件
          </Button>
        </div>
      ),
    };
  });

  if (schemaQ.isError) {
    return (
      <div role="alert" className="p-6 text-center text-sm text-destructive">
        无法加载 Data Manager 筛选字段，请刷新重试。
      </div>
    );
  }

  return (
    <div className="mx-auto h-full min-h-0 max-w-[1800px] overflow-hidden px-4 pt-2 pb-3 text-foreground md:px-6">
      <DataManagerLensTabs
        scope={scope}
        availableScopes={availableScopes}
        onScopeChange={(nextScope) => {
          if (nextScope === scope) return;
          if (isDirty) setPendingScope(nextScope);
          else onScopeChange(nextScope);
        }}
      >
        <div className="flex h-full min-h-0 flex-col gap-2">
          <header className="flex shrink-0 items-center justify-between gap-4 max-md:flex-col max-md:items-start">
            <div className="min-w-0">
              <h1 className="truncate text-lg font-semibold tracking-tight">
                {projectName} · Data Manager
              </h1>
              {!!urlState.issues.length && (
                <div role="alert" className="mt-1 text-xs text-status-caution">
                  URL 筛选状态无法完整恢复，已使用安全默认值。
                </div>
              )}
              <p className="mt-1 text-xs text-muted-foreground">
                <span className="font-mono">{projectDisplayId}</span>
                {` / ${facets?.task_total ?? 0} 个可见任务 / ${total} 条${scope === "objects" ? "对象" : "轨迹"}`}
              </p>
            </div>
            <div className="flex shrink-0 gap-2">
              <Button variant={analyticsOpen ? "primary" : undefined} onClick={toggleAnalytics}>
                <Icon name="activity" size={12} />
                统计
              </Button>
              <Button
                onClick={() => {
                  if (!queryReady || !filterReady) return;
                  activeQ.refetch();
                }}
                disabled={!queryReady || !filterReady || activeQ.isFetching}
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

          {analyticsOpen && (
            <DataManagerAnalyticsPanel
              scope={scope}
              facets={facets}
              isLoading={activeQ.isLoading}
              onSelect={toggleFacetRule}
            />
          )}

          <div className="grid min-h-0 flex-1 grid-cols-[210px_minmax(0,1fr)] gap-3 max-lg:grid-cols-1">
            <aside className="min-h-0 overflow-y-auto rounded-md border border-border bg-card p-2 max-lg:hidden">
              <div className="px-1 pb-2 text-xs font-semibold text-muted-foreground">
                {scope === "objects" ? "对象视图" : "轨迹视图"}
              </div>
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
                        else switchView(key);
                      }}
                    >
                      <span className="truncate">{view.name}</span>
                      <Badge variant={view.invalid_fields.length ? "warning" : "outline"}>
                        {view.invalid_fields.length ? "失效" : (view.result_count ?? "无")}
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
                <Icon name="trash" size={12} />
                删除视图
              </Button>
            </aside>

            <main className="flex min-h-0 min-w-0 flex-col gap-2">
              <section className="flex shrink-0 flex-col gap-2 rounded-md border border-border bg-card p-2.5">
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
                      placeholder="搜索任务、文件或 Scene"
                      aria-label="搜索任务、文件或 Scene"
                      className="h-9 pl-8"
                    />
                  </div>
                  <Select
                    value={sort[0]?.field ?? ""}
                    onValueChange={(field) =>
                      setSort([{ field, direction: sort[0]?.direction ?? "asc" }])
                    }
                  >
                    <SelectTrigger className="w-44">
                      <SelectValue placeholder="排序字段" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {(schemaQ.data?.sort_fields ?? []).map((item) => (
                          <SelectItem key={item.value} value={item.value}>
                            {item.label}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  <Button
                    onClick={() => {
                      const current = sort[0];
                      if (current)
                        setSort([
                          { ...current, direction: current.direction === "asc" ? "desc" : "asc" },
                        ]);
                    }}
                  >
                    {sort[0]?.direction === "desc" ? "降序" : "升序"}
                  </Button>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button>列设置</Button>
                    </PopoverTrigger>
                    <PopoverContent align="end" className="w-64">
                      <div className="flex flex-col gap-2">
                        <div className="text-sm font-medium">显示列</div>
                        {columnOptions.map((column) => (
                          <label
                            key={column.key}
                            className="flex min-h-8 items-center gap-2 text-xs"
                          >
                            <input
                              type="checkbox"
                              checked={columns.includes(column.key)}
                              disabled={columns.length === 1 && columns.includes(column.key)}
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
                  fields={fields}
                  chips={filterChips}
                  hasConditions={!isEmptyFilter(filter)}
                  onAdd={(field) => {
                    const nextRule = {
                      field: field.key,
                      op: field.operators[0] ?? "eq",
                    };
                    setFilter(
                      isEmptyFilter(filter) ? nextRule : { op: "and", rules: [filter, nextRule] },
                    );
                  }}
                  onClear={() => setFilter({})}
                />
                {isFilterGroup(filter) &&
                  (!expressionValid || filter.op === "or" || hasNestedGroups(filter)) && (
                    <DataManagerExpressionEditor
                      expression={filter}
                      fields={fields}
                      onChange={setFilter}
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

              <div
                ref={tableRef}
                role="table"
                aria-rowcount={total}
                className="relative min-h-0 flex-1 overflow-auto rounded-md border border-border bg-card"
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
                        aria-sort={
                          activeSort
                            ? sort[0]?.direction === "desc"
                              ? "descending"
                              : "ascending"
                            : "none"
                        }
                        disabled={!schemaColumn?.sortable}
                        className="flex h-10 items-center gap-1 px-3 text-left text-xs font-semibold text-muted-foreground disabled:cursor-default"
                        onClick={() => {
                          if (!schemaColumn?.sort_field) return;
                          setSort([
                            {
                              field: schemaColumn.sort_field,
                              direction:
                                activeSort && sort[0]?.direction === "asc" ? "desc" : "asc",
                            },
                          ]);
                        }}
                      >
                        {schemaColumn?.label ?? column}
                        {activeSort && (
                          <span aria-hidden="true">
                            {sort[0]?.direction === "desc" ? "↓" : "↑"}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
                {activeQ.isLoading && (
                  <div className="flex flex-col gap-2 p-3">
                    {Array.from({ length: 8 }, (_, index) => (
                      <Skeleton key={index} className="h-10 w-full" />
                    ))}
                  </div>
                )}
                {activeQ.isError && (
                  <div className="flex h-64 items-center justify-center text-sm text-destructive">
                    无法加载当前视图
                  </div>
                )}
                {!activeQ.isLoading && !activeQ.isError && !rows.length && (
                  <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
                    当前条件没有匹配结果
                  </div>
                )}
                {!!rows.length && (
                  <div
                    className={cn(styles.virtualCanvas, "relative min-w-max")}
                    // eslint-disable-next-line no-restricted-syntax -- virtualizer computes the scroll canvas height.
                    style={
                      { "--dm-virtual-height": `${virtualizer.getTotalSize()}px` } as CSSProperties
                    }
                  >
                    {virtualRows.map((virtualRow) => {
                      const row = rows[virtualRow.index];
                      const entitySelected =
                        selected ===
                        (scope === "objects"
                          ? (row as DataManagerObject).annotation_id
                          : (row as DataManagerTrack).track_ref);
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
                          style={
                            {
                              "--dm-grid-columns": gridTemplate,
                              "--dm-row-offset": `${virtualRow.start}px`,
                            } as CSSProperties
                          }
                          onClick={() =>
                            setSelected(
                              scope === "objects"
                                ? (row as DataManagerObject).annotation_id
                                : (row as DataManagerTrack).track_ref,
                            )
                          }
                        >
                          {columns.map((column) => {
                            const content =
                              scope === "objects"
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
                  <div className="sticky bottom-0 bg-card py-2 text-center text-xs text-muted-foreground">
                    正在加载更多
                  </div>
                )}
              </div>
            </main>
          </div>
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
                onChange={(event) => setSaveVisibility(event.target.value as "private" | "project")}
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
            <AlertDialogTitle>放弃未保存的修改？</AlertDialogTitle>
            <AlertDialogDescription>
              切换后，当前筛选、排序或列设置的未保存修改会丢失。
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

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除“{selectedView?.name}”？</AlertDialogTitle>
            <AlertDialogDescription>
              只删除保存的视图配置，不会删除任何标注或轨迹。
            </AlertDialogDescription>
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
