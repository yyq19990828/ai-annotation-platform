import { useMemo, type CSSProperties } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type {
  DataManagerEntityFacets,
  DataManagerEntityScope,
  DataManagerSummary,
} from "@/api/taskViews";
import { Skeleton } from "@/components/shadcn/ui/skeleton";
import { useTheme } from "@/hooks/useTheme";

const SOURCE_LABELS: Record<string, string> = {
  manual: "人工",
  prediction_based: "接受 AI",
  ai_tracker: "AI 追踪",
  interpolated: "插值",
};

const STATUS_LABELS: Record<string, string> = {
  pending: "待标注",
  in_progress: "标注中",
  review: "待审核",
  rejected: "已退回",
  completed: "已完成",
};

const QUALITY_LABELS: Record<string, string> = {
  missing_keyframes: "缺少关键帧",
  track_identity_mismatch: "轨迹标识不一致",
  inconsistent_class: "类别不一致",
  inconsistent_attributes: "属性不一致",
  multiple_scenes: "跨多个 Scene",
  duplicate_frame: "同帧重复",
  duplicate_keyframe: "关键帧重复",
};

const CONFIDENCE_BUCKET_LABELS: Record<string, string> = {
  lt_025: "0–24%",
  "025_049": "25–49%",
  "050_074": "50–74%",
  gte_075: "75–100%",
};

function cssVar(name: string) {
  if (typeof window === "undefined") return "";
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function rows(
  values: Record<string, number>,
  labels: Record<string, string> = {},
  order?: string[],
) {
  return Object.entries(values)
    .filter(([, value]) => value > 0)
    .sort((a, b) => order
      ? order.indexOf(a[0]) - order.indexOf(b[0])
      : b[1] - a[1])
    .slice(0, 8)
    .map(([key, value]) => ({ key, name: labels[key] ?? key, value }));
}

interface ChartSpec {
  title: string;
  description: string;
  data: Array<{ key: string; name: string; value: number }>;
}

export function DataManagerCharts({
  scope,
  summary,
  facets,
  isLoading = false,
}: {
  scope: DataManagerEntityScope;
  summary?: DataManagerSummary;
  facets?: DataManagerEntityFacets;
  isLoading?: boolean;
}) {
  useTheme();
  const grid = cssVar("--sc-border");
  const muted = cssVar("--sc-muted-foreground");
  const series = [
    cssVar("--sc-chart-1"),
    cssVar("--sc-chart-2"),
    cssVar("--sc-chart-3"),
  ];
  const tooltipStyle = useMemo<CSSProperties>(
    () => ({
      background: "var(--sc-card)",
      border: "1px solid var(--sc-border)",
      borderRadius: "var(--radius-md)",
      boxShadow: "var(--shadow-md)",
      color: "var(--sc-foreground)",
    }),
    [],
  );
  const tick = useMemo(() => ({ fontSize: 11, fill: muted }), [muted]);
  const specs = useMemo<ChartSpec[]>(() => {
    if (scope === "tasks" && summary) {
      return [
        {
          title: "任务状态",
          description: "当前筛选范围内的任务状态分布",
          data: rows(summary.task_status, STATUS_LABELS),
        },
        {
          title: "标注来源",
          description: "active annotation 按来源统计",
          data: rows(summary.annotations.by_source, SOURCE_LABELS),
        },
        {
          title: "标注类别",
          description: "数量最多的前 8 个类别",
          data: rows(summary.annotations.by_class),
        },
        {
          title: "待审模型版本",
          description: "仅统计当前仍待审的 AI 检测候选",
          data: rows(summary.ai_review.by_model_version),
        },
        {
          title: "待审置信度",
          description: "候选级分布，低于 50% 计为低置信",
          data: rows(
            summary.ai_review.confidence_buckets,
            CONFIDENCE_BUCKET_LABELS,
            ["lt_025", "025_049", "050_074", "gte_075"],
          ),
        },
      ];
    }
    if (!facets) return [];
    return [
      {
        title: scope === "objects" ? "对象来源" : "轨迹来源",
        description: "当前筛选结果按 annotation source 统计",
        data: rows(facets.by_source, SOURCE_LABELS),
      },
      {
        title: scope === "objects" ? "对象类别" : "轨迹类别",
        description: "数量最多的前 8 个类别",
        data: rows(facets.by_class),
      },
      {
        title: scope === "tracks" ? "质量异常" : "几何类型",
        description:
          scope === "tracks" ? "需要进一步审阅的轨迹异常" : "对象按几何类型统计",
        data:
          scope === "tracks"
            ? rows(facets.by_quality, QUALITY_LABELS)
            : rows(facets.by_type),
      },
    ];
  }, [facets, scope, summary]);

  return (
    <section aria-label="标注统计图表" className="grid gap-4 lg:grid-cols-3">
      {(isLoading ? Array.from({ length: scope === "tasks" ? 5 : 3 }, (_, index) => index) : specs).map((spec, index) => (
        <div key={typeof spec === "number" ? spec : spec.title} className="min-w-0">
          {typeof spec === "number" ? (
            <Skeleton className="h-44 w-full" />
          ) : (
            <>
              <div className="mb-2">
                <h3 className="text-sm font-medium text-foreground">{spec.title}</h3>
                <p className="mt-0.5 text-xs text-muted-foreground">{spec.description}</p>
              </div>
              {spec.data.length ? (
                <div
                  className="h-40 w-full"
                  role="img"
                  aria-label={`${spec.title}：${spec.data.map((item) => `${item.name} ${item.value}`).join("，")}`}
                >
                  <ResponsiveContainer
                    width="100%"
                    height="100%"
                    minWidth={0}
                    initialDimension={{ width: 320, height: 160 }}
                  >
                    <BarChart
                      data={spec.data}
                      layout="vertical"
                      margin={{ top: 0, right: 16, bottom: 0, left: 4 }}
                    >
                      <CartesianGrid stroke={grid} horizontal={false} />
                      <XAxis type="number" allowDecimals={false} tick={tick} axisLine={{ stroke: grid }} />
                      <YAxis
                        type="category"
                        dataKey="name"
                        width={72}
                        tick={tick}
                        axisLine={false}
                        tickLine={false}
                      />
                      <Tooltip
                        contentStyle={tooltipStyle}
                        labelStyle={{ color: "var(--sc-foreground)", fontWeight: 500 }}
                        itemStyle={{ color: "var(--sc-muted-foreground)" }}
                        formatter={(value) => [Number(value).toLocaleString(), "数量"]}
                      />
                      <Bar dataKey="value" fill={series[index % series.length]} radius={[0, 3, 3, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="flex h-40 items-center justify-center text-xs text-muted-foreground">
                  当前筛选范围暂无可绘制数据
                </div>
              )}
            </>
          )}
        </div>
      ))}
    </section>
  );
}
