import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Icon } from "@/components/ui/Icon";
import { Button } from "@/components/ui/Button";
import { PageContainer } from "@/components/layout/PageContainer";
import { useProjects } from "@/hooks/useProjects";
import { AnnotatorDashboard } from "./AnnotatorDashboard";
import { ReviewerDashboard } from "./ReviewerDashboard";

type WorkTab = "annotate" | "review";

/**
 * Employee home.  An employee may annotate in one project and review in another,
 * so this composes the existing annotation and review dashboards (each already
 * server-filtered by project membership) behind an explicit work-mode switch.
 * No global "current role" is fabricated; the tab only selects presentation.
 */
export function EmployeeDashboard() {
  const [tab, setTab] = useState<WorkTab>("annotate");
  const navigate = useNavigate();
  const location = useLocation();
  const projectsQuery = useProjects();

  if (projectsQuery.isSuccess && (projectsQuery.data?.length ?? 0) === 0) {
    return (
      <PageContainer>
        <div className="rounded-lg border border-border bg-card px-6 py-15 text-center">
          <Icon name="folder" size={36} className="mx-auto mb-3 opacity-25" />
          <h1 className="text-lg font-semibold">等待分配项目</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            你还没有加入任何项目，请联系项目负责人将你添加为标注员或质检员。
          </p>
        </div>
      </PageContainer>
    );
  }

  return (
    <div>
      <div className="sticky top-0 z-local-1 flex flex-wrap items-center justify-between gap-3 border-b border-border bg-background px-7 py-3">
        <div className="flex items-center gap-1.5" role="tablist" aria-label="工作模式">
          <Button
            role="tab"
            aria-selected={tab === "annotate"}
            variant={tab === "annotate" ? "primary" : "default"}
            size="sm"
            onClick={() => setTab("annotate")}
            data-testid="employee-tab-annotate"
          >
            <Icon name="target" size={12} />
            标注工作
          </Button>
          <Button
            role="tab"
            aria-selected={tab === "review"}
            variant={tab === "review" ? "primary" : "default"}
            size="sm"
            onClick={() => setTab("review")}
            data-testid="employee-tab-review"
          >
            <Icon name="check" size={12} />
            质检工作
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={() => navigate("/annotate", { state: location.state })}>
            标注列表
          </Button>
          <Button size="sm" onClick={() => navigate("/review")}>
            审核列表
          </Button>
        </div>
      </div>
      {tab === "annotate" ? <AnnotatorDashboard /> : <ReviewerDashboard />}
    </div>
  );
}
