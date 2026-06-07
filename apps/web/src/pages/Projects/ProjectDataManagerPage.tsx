import { useEffect, useMemo, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { useProject } from "@/hooks/useProjects";
import {
  useCreateTaskView,
  useDeleteTaskView,
  useProjectTaskQuery,
  useTaskViews,
  useUpdateTaskView,
} from "@/hooks/useTaskViews";
import type { DataManagerTask, ProjectTaskView, TaskFilterOp, TaskFilterRule, TaskSortItem } from "@/api/taskViews";
import { useAuthStore } from "@/stores/authStore";
import { usePermissions } from "@/hooks/usePermissions";
import styles from "./ProjectDataManagerPage.module.css";

const PAGE_SIZE = 50;

const FILTER_FIELDS = [
  { value: "task.status", label: "任务状态", type: "text" },
  { value: "task.assignee", label: "标注员", type: "text" },
  { value: "task.reviewer", label: "审核员", type: "text" },
  { value: "task.batch_id", label: "批次", type: "text" },
  { value: "annotation.annotation_count", label: "标注数", type: "number" },
  { value: "annotation.class_name", label: "标注类别", type: "text" },
  { value: "prediction.prediction_count", label: "预测数", type: "number" },
  { value: "prediction.model_version", label: "模型版本", type: "text" },
  { value: "prediction.avg_confidence", label: "平均置信度", type: "number" },
  { value: "prediction.source", label: "预测来源", type: "text" },
  { value: "feedback.unresolved_count", label: "未解决反馈", type: "number" },
  { value: "feedback.kind", label: "反馈类型", type: "text" },
  { value: "feedback.severity", label: "反馈级别", type: "text" },
  { value: "scene.scene_name", label: "Scene", type: "text" },
  { value: "scene.frame_index", label: "帧序号", type: "number" },
] as const;

const FIELD_LABEL: Map<string, string> = new Map(FILTER_FIELDS.map((field) => [field.value, field.label]));

const COLUMN_OPTIONS = [
  { key: "display_id", label: "任务" },
  { key: "status", label: "状态" },
  { key: "annotation_count", label: "标注" },
  { key: "prediction_count", label: "预测" },
  { key: "avg_prediction_confidence", label: "置信度" },
  { key: "unresolved_feedback_count", label: "反馈" },
  { key: "model_versions", label: "模型版本" },
  { key: "scene_name", label: "Scene" },
  { key: "frame_index", label: "帧" },
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

function editableRulesFromView(view: ProjectTaskView | null): EditableRule[] {
  const raw = view?.filter_json;
  if (!raw || !("rules" in raw) || !Array.isArray(raw.rules)) return [{ ...EMPTY_RULE }];
  const rules = raw.rules
    .filter(isFilterRule)
    .map((rule) => ({
      field: rule.field,
      op: rule.op,
      value: Array.isArray(rule.value) ? rule.value.join(", ") : String(rule.value ?? ""),
    }));
  return rules.length ? rules : [{ ...EMPTY_RULE }];
}

function normalizeRuleValue(rule: EditableRule): unknown {
  const field = FILTER_FIELDS.find((item) => item.value === rule.field);
  if (rule.op === "exists") return true;
  if (rule.op === "in") {
    return rule.value.split(",").map((item) => item.trim()).filter(Boolean);
  }
  if (field?.type === "number") {
    const n = Number(rule.value);
    return Number.isFinite(n) ? n : rule.value;
  }
  return rule.value.trim();
}

function buildFilterJson(rules: EditableRule[]): Record<string, unknown> {
  const clean = rules
    .filter((rule) => rule.field && rule.op && (rule.op === "exists" || rule.value.trim()))
    .map((rule) => ({
      field: rule.field,
      op: rule.op,
      value: normalizeRuleValue(rule),
    }));
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

export function ProjectDataManagerPage() {
  const { id = "" } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { role } = usePermissions();
  const user = useAuthStore((s) => s.user);
  const { data: project, isLoading: projectLoading, error } = useProject(id);
  const viewsQ = useTaskViews(id);
  const createView = useCreateTaskView(id);
  const updateView = useUpdateTaskView(id);
  const deleteView = useDeleteTaskView(id);
  const [selectedKey, setSelectedKey] = useState<string>("builtin:all");
  const [rules, setRules] = useState<EditableRule[]>([{ ...EMPTY_RULE }]);
  const [columns, setColumns] = useState<string[]>(DEFAULT_COLUMNS);
  const [sort, setSort] = useState<TaskSortItem[]>([{ field: "task.created_at", direction: "asc" }]);
  const [page, setPage] = useState(0);

  const views = viewsQ.data?.items ?? [];
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
    setRules(editableRulesFromView(selectedView));
    setColumns(selectedView.columns_json?.length ? selectedView.columns_json : DEFAULT_COLUMNS);
    setSort(defaultSortForView(selectedView));
    setPage(0);
  }, [selectedView]);

  const filterJson = useMemo(() => buildFilterJson(rules), [rules]);
  const queryPayload = useMemo(() => ({
    filter_json: filterJson,
    sort_json: sort,
    columns_json: columns,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  }), [columns, filterJson, page, sort]);
  const tasksQ = useProjectTaskQuery(id, queryPayload);
  const total = tasksQ.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const canManageProject = role === "super_admin" || Boolean(project && user?.id === project.owner_id);
  const canEditSelected = Boolean(
    selectedView?.id
      && (selectedView.visibility === "private"
        ? selectedView.owner_id === user?.id || role === "super_admin"
        : canManageProject),
  );

  if (projectLoading) return <div className={styles.loading}>加载中...</div>;
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
      await updateView.mutateAsync({ viewId: selectedView.id, payload });
      return;
    }
    const name = window.prompt("视图名称", selectedView ? `${selectedView.name} 副本` : "任务视图");
    if (!name) return;
    const created = await createView.mutateAsync({ ...payload, name, visibility: "private" });
    setSelectedKey(`saved:${created.id}`);
  };

  const removeCurrent = async () => {
    if (!selectedView?.id || !canEditSelected) return;
    await deleteView.mutateAsync(selectedView.id);
    setSelectedKey("builtin:all");
  };

  const visibleColumnSet = new Set(columns);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <button type="button" className={styles.backButton} onClick={() => navigate(`/projects/${id}/settings`)}>
          <Icon name="chevLeft" size={12} />返回项目设置
        </button>
        <div className={styles.titleRow}>
          <div>
            <h1 className={styles.title}>{project.name} · Data Manager</h1>
            <div className={styles.meta}>
              <span className="mono">{project.display_id}</span>
              <span>{total.toLocaleString()} 任务</span>
              <span>{views.length.toLocaleString()} 视图</span>
            </div>
          </div>
          <div className={styles.actions}>
            <Button onClick={() => tasksQ.refetch()} disabled={tasksQ.isFetching}>
              <Icon name="refresh" size={12} />刷新
            </Button>
            <Button variant="primary" onClick={saveCurrent} disabled={createView.isPending || updateView.isPending}>
              <Icon name="save" size={12} />保存视图
            </Button>
          </div>
        </div>
      </header>

      <div className={styles.layout}>
        <aside className={styles.viewsPane}>
          <div className={styles.paneTitle}>视图</div>
          <div className={styles.viewList}>
            {views.map((view) => {
              const key = view.id ? `saved:${view.id}` : `builtin:${view.key}`;
              const active = key === selectedKey;
              return (
                <button
                  key={key}
                  type="button"
                  className={active ? `${styles.viewButton} ${styles.viewButtonActive}` : styles.viewButton}
                  onClick={() => setSelectedKey(key)}
                >
                  <span>{view.name}</span>
                  <Badge variant={view.builtin ? "outline" : view.visibility === "project" ? "accent" : "default"}>
                    {view.task_count ?? "—"}
                  </Badge>
                </button>
              );
            })}
          </div>
          <Button
            variant="danger"
            size="sm"
            onClick={removeCurrent}
            disabled={!canEditSelected || deleteView.isPending}
            className={styles.fullButton}
          >
            <Icon name="trash" size={12} />删除
          </Button>
        </aside>

        <main className={styles.main}>
          <section className={styles.toolbar}>
            <div className={styles.rules}>
              {rules.map((rule, index) => (
                <div key={`${index}-${rule.field}`} className={styles.ruleRow}>
                  <select
                    value={rule.field}
                    onChange={(event) => {
                      const next = [...rules];
                      next[index] = { ...rule, field: event.target.value };
                      setRules(next);
                    }}
                  >
                    {FILTER_FIELDS.map((field) => (
                      <option key={field.value} value={field.value}>{field.label}</option>
                    ))}
                  </select>
                  <select
                    value={rule.op}
                    onChange={(event) => {
                      const next = [...rules];
                      next[index] = { ...rule, op: event.target.value as TaskFilterOp };
                      setRules(next);
                    }}
                  >
                    <option value="eq">=</option>
                    <option value="ne">!=</option>
                    <option value="in">in</option>
                    <option value="gt">&gt;</option>
                    <option value="gte">&gt;=</option>
                    <option value="lt">&lt;</option>
                    <option value="lte">&lt;=</option>
                    <option value="exists">exists</option>
                  </select>
                  <input
                    value={rule.value}
                    disabled={rule.op === "exists"}
                    onChange={(event) => {
                      const next = [...rules];
                      next[index] = { ...rule, value: event.target.value };
                      setRules(next);
                    }}
                  />
                  <button
                    type="button"
                    className={styles.iconButton}
                    onClick={() => setRules(rules.filter((_, i) => i !== index))}
                    disabled={rules.length <= 1}
                    title="移除"
                  >
                    <Icon name="x" size={14} />
                  </button>
                </div>
              ))}
              <Button size="sm" onClick={() => setRules([...rules, { ...EMPTY_RULE }])}>
                <Icon name="plus" size={12} />条件
              </Button>
            </div>
            <div className={styles.columnPanel}>
              {COLUMN_OPTIONS.map((column) => (
                <label key={column.key} className={styles.columnToggle}>
                  <input
                    type="checkbox"
                    checked={visibleColumnSet.has(column.key)}
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

          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  {columns.map((column) => (
                    <th key={column}>{COLUMN_OPTIONS.find((item) => item.key === column)?.label ?? column}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tasksQ.data?.items.map((task) => (
                  <tr key={task.id}>
                    {columns.map((column) => (
                      <td key={`${task.id}-${column}`}>{renderCell(task, column)}</td>
                    ))}
                  </tr>
                ))}
                {!tasksQ.isLoading && !tasksQ.data?.items.length && (
                  <tr>
                    <td colSpan={Math.max(1, columns.length)} className={styles.empty}>无匹配任务</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <footer className={styles.footer}>
            <div>
              {rules
                .filter((rule) => rule.value.trim() || rule.op === "exists")
                .map((rule) => `${FIELD_LABEL.get(rule.field) ?? rule.field} ${rule.op}`)
                .join(" / ") || "全部任务"}
            </div>
            <div className={styles.pager}>
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
    </div>
  );
}

function renderCell(task: DataManagerTask, column: string) {
  switch (column) {
    case "display_id":
      return (
        <div className={styles.taskCell}>
          <span className="mono">{task.display_id}</span>
          <span>{task.file_name}</span>
        </div>
      );
    case "status":
      return <Badge variant={task.status === "completed" ? "success" : task.status === "review" ? "warning" : "default"}>{statusLabel(task.status)}</Badge>;
    case "annotation_count":
      return task.annotation_count.toLocaleString();
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
    default:
      return "—";
  }
}
