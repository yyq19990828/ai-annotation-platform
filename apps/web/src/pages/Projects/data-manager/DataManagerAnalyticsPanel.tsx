import type {
  DataManagerEntityFacets,
  DataManagerEntityScope,
  DataManagerSummary,
} from "@/api/taskViews";
import { DataManagerCharts } from "./DataManagerCharts";
import { DataManagerAnalyticsContent } from "./DataManagerOverview";

/**
 * 首屏内联分析面板（原为右侧抽屉）。由各 lens 的「统计」按钮受控展开/折叠，
 * 放在概览条与结果表格之间；自身限高滚动，避免展开时挤塌 flex-1 的表格。
 * 图表点柱子经 onSelect 注入筛选，表格与图表就地联动，无需再开抽屉。
 */
export function DataManagerAnalyticsPanel({
  scope,
  summary,
  facets,
  isLoading,
  onSelect,
}: {
  scope: DataManagerEntityScope;
  summary?: DataManagerSummary;
  facets?: DataManagerEntityFacets;
  isLoading: boolean;
  onSelect?: (field: string, value: string) => void;
}) {
  return (
    <section
      aria-label="当前视图统计"
      className="max-h-[42vh] shrink-0 overflow-auto rounded-md border border-border bg-card p-3"
    >
      {scope === "tasks" ? (
        <DataManagerAnalyticsContent summary={summary} isLoading={isLoading} onSelect={onSelect} />
      ) : (
        <DataManagerCharts scope={scope} facets={facets} isLoading={isLoading} onSelect={onSelect} />
      )}
    </section>
  );
}
