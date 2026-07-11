import type {
  DataManagerEntityFacets,
  DataManagerEntityScope,
  DataManagerSummary,
} from "@/api/taskViews";
import { ScrollArea } from "@/components/shadcn/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/shadcn/ui/sheet";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { DataManagerCharts } from "./DataManagerCharts";
import { DataManagerAnalyticsContent } from "./DataManagerOverview";

export function DataManagerAnalyticsSheet({
  scope,
  summary,
  facets,
  isLoading,
}: {
  scope: DataManagerEntityScope;
  summary?: DataManagerSummary;
  facets?: DataManagerEntityFacets;
  isLoading: boolean;
}) {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button>
          <Icon name="activity" size={12} />统计
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full overflow-hidden sm:max-w-3xl">
        <SheetHeader className="shrink-0 border-b border-border">
          <SheetTitle>当前视图统计</SheetTitle>
          <SheetDescription>
            聚合范围与当前搜索、筛选和权限一致，不受表格分页影响。
          </SheetDescription>
        </SheetHeader>
        <ScrollArea className="min-h-0 flex-1 px-4 pb-6">
          <div className="pt-4">
            {scope === "tasks" ? (
              <DataManagerAnalyticsContent summary={summary} isLoading={isLoading} />
            ) : (
              <DataManagerCharts
                scope={scope}
                facets={facets}
                isLoading={isLoading}
              />
            )}
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
