import type { DataManagerSummary } from "@/api/taskViews";
import { Skeleton } from "@/components/shadcn/ui/skeleton";
import { Badge } from "@/components/ui/Badge";
import { DataManagerCharts } from "./DataManagerCharts";

interface DataManagerOverviewProps {
  summary: DataManagerSummary | undefined;
  isLoading: boolean;
  onSelect?: (field: string, value: string) => void;
}

function metric(value: number | undefined) {
  return value === undefined ? "—" : value.toLocaleString();
}

const STATUS_LABELS: Record<string, string> = {
  pending: "待标注",
  in_progress: "标注中",
  review: "待审核",
  rejected: "已退回",
  completed: "已完成",
};

const SOURCE_LABELS: Record<string, string> = {
  manual: "人工",
  prediction_based: "接受 AI",
  ai_tracker: "AI 追踪",
  interpolated: "插值",
};

const CONFIDENCE_BUCKET_LABELS: Record<string, string> = {
  lt_025: "0–24%",
  "025_049": "25–49%",
  "050_074": "50–74%",
  gte_075: "75–100%",
};

const KIND_METRIC_LABELS: Record<string, string> = {
  images_with_dimensions: "已有尺寸",
  distinct_resolutions: "分辨率种类",
  duration_ms: "总时长（毫秒）",
  frame_count: "总帧数",
  keyframes: "关键帧",
  outside_ranges: "不可见区间",
  box_3d: "3D 框",
  point_mask_3d: "点云 Mask",
  camera_links: "相机路数合计",
  calibration_issues: "标定异常",
  scenes: "Scene",
  interpolated_annotations: "插值标注",
};

function Distribution({
  title,
  values,
  labels = {},
}: {
  title: string;
  values: Record<string, number | null>;
  labels?: Record<string, string>;
}) {
  const items = Object.entries(values).filter(
    (entry): entry is [string, number] => typeof entry[1] === "number" && entry[1] > 0,
  );
  return (
    <div className="min-w-0">
      <div className="mb-2 text-xs font-semibold text-muted-foreground">{title}</div>
      <div className="flex flex-wrap gap-1.5">
        {items.length ? items.map(([key, value]) => (
          <Badge key={key} variant="outline">
            {labels[key] ?? key} · {value.toLocaleString()}
          </Badge>
        )) : <span className="text-xs text-muted-foreground">当前范围无数据</span>}
      </div>
    </div>
  );
}

type OverviewItem = {
  label: string;
  value: number | undefined;
  detail: string;
  // 有值时该 KPI 可点，下钻为一条 `field op value` 筛选；无 → 纯展示。
  drill?: { field: string; op: string; value: string };
};

function overviewItems(summary: DataManagerSummary | undefined): OverviewItem[] {
  return [
    {
      label: "当前匹配",
      value: summary?.scope.matched_task_total,
      detail: `可见 ${metric(summary?.scope.visible_task_total)}`,
    },
    {
      label: "标注对象",
      value: summary?.annotations.total,
      detail: `人工 ${metric(summary?.annotations.by_source.manual)} · AI ${metric(summary?.annotations.by_source.prediction_based)}`,
    },
    {
      label: "AI 待审",
      value: (summary?.ai_review.prediction_shapes ?? 0) + (summary?.ai_review.tracker_jobs ?? 0),
      detail: `低置信 ${metric(summary?.ai_review.low_confidence_prediction_shapes)}`,
      drill: { field: "ai.pending_prediction_shape_count", op: "gt", value: "0" },
    },
    {
      label: "逻辑轨迹",
      value: summary?.annotations.distinct_tracks,
      detail: `轨迹标注 ${metric(summary?.annotations.tracked)}`,
    },
    {
      label: "未解决反馈",
      value: summary?.unresolved_feedback,
      detail: summary?.unresolved_feedback ? "需要处理" : "当前无反馈",
      drill: { field: "feedback.unresolved_count", op: "gt", value: "0" },
    },
  ];
}

export function DataManagerSummaryStrip({
  summary,
  isLoading,
  onDrill,
}: DataManagerOverviewProps & {
  onDrill?: (rule: { field: string; op: string; value: string }) => void;
}) {
  const items = overviewItems(summary);
  return (
    <section
      aria-label="数据概览"
      className="grid shrink-0 grid-cols-5 gap-px overflow-hidden rounded-md border border-border bg-border max-md:flex max-md:overflow-x-auto"
    >
      {items.map((item) => {
        const drillable = Boolean(item.drill && onDrill);
        const inner = (
          <>
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate text-xs text-muted-foreground">{item.label}</span>
              {isLoading ? (
                <Skeleton className="h-5 w-10" />
              ) : (
                <strong className="font-mono text-base font-semibold tabular-nums text-foreground">
                  {metric(item.value)}
                </strong>
              )}
            </div>
            <div className="mt-0.5 truncate text-2xs text-muted-foreground">
              {isLoading ? <Skeleton className="h-3 w-full" /> : item.detail}
            </div>
          </>
        );
        return drillable ? (
          <button
            key={item.label}
            type="button"
            onClick={() => item.drill && onDrill?.(item.drill)}
            className="min-w-0 bg-card px-3 py-2 text-left transition-colors hover:bg-muted max-md:min-w-36"
          >
            {inner}
          </button>
        ) : (
          <div key={item.label} className="min-w-0 bg-card px-3 py-2 max-md:min-w-36">
            {inner}
          </div>
        );
      })}
    </section>
  );
}

export function DataManagerAnalyticsContent({ summary, isLoading, onSelect }: DataManagerOverviewProps) {
  return (
    <section aria-label="详细统计" className="flex flex-col gap-4">
      <div>
        <DataManagerCharts
          scope="tasks"
          summary={summary}
          isLoading={isLoading}
          onSelect={onSelect}
        />
      </div>
      <details className="rounded-lg border border-border bg-card" open>
        <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-foreground marker:text-muted-foreground">
          查看状态、来源、类别与属性聚合
        </summary>
        <div className="grid gap-5 border-t border-border p-3 md:grid-cols-2 xl:grid-cols-4">
          {isLoading || !summary ? (
            Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-16 w-full" />)
          ) : (
            <>
              <Distribution title="任务状态" values={summary.task_status} labels={STATUS_LABELS} />
              <Distribution title="标注来源" values={summary.annotations.by_source} labels={SOURCE_LABELS} />
              <Distribution title="类别" values={summary.annotations.by_class} />
              <Distribution title="几何类型" values={summary.annotations.by_type} />
              <Distribution title="工具单位" values={summary.annotations.by_tool_unit} />
              <Distribution title="待审模型版本" values={summary.ai_review.by_model_version} />
              <Distribution title="待审置信度" values={summary.ai_review.confidence_buckets} labels={CONFIDENCE_BUCKET_LABELS} />
              <Distribution title="当前模态" values={summary.kind_metrics} labels={KIND_METRIC_LABELS} />
              <div className="min-w-0 md:col-span-2 xl:col-span-2">
                <div className="mb-2 text-xs font-semibold text-muted-foreground">属性完整度和值分布</div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {summary.attributes.length ? summary.attributes.map((attribute) => (
                    <div key={`${attribute.tool_unit_id}.${attribute.key}`} className="rounded-md border border-border bg-background p-2">
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="truncate font-medium">{attribute.label}</span>
                        <span className="font-mono text-muted-foreground">
                          {attribute.present}/{attribute.eligible}
                        </span>
                      </div>
                      <progress
                        className="mt-1.5 h-1.5 w-full accent-primary"
                        value={attribute.present}
                        max={Math.max(attribute.eligible, 1)}
                        aria-label={`${attribute.label}完整度`}
                      />
                      <div className="mt-1.5 flex flex-wrap gap-1 text-xs text-muted-foreground">
                        <span>缺失 {attribute.missing}</span>
                        {Object.entries(attribute.values).slice(0, 5).map(([value, count]) => (
                          <span key={value}>· {value} {count}</span>
                        ))}
                      </div>
                    </div>
                  )) : <span className="text-xs text-muted-foreground">项目未配置属性字段</span>}
                </div>
              </div>
            </>
          )}
        </div>
      </details>
    </section>
  );
}

export function DataManagerOverview(props: DataManagerOverviewProps) {
  return (
    <div className="flex flex-col gap-4">
      <DataManagerSummaryStrip {...props} />
      <DataManagerAnalyticsContent {...props} />
    </div>
  );
}
