import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Icon } from "@/components/ui/Icon";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { StatCard } from "@/components/ui/StatCard";
import { SearchInput } from "@/components/ui/SearchInput";
import { TabRow } from "@/components/ui/TabRow";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { useToastStore } from "@/components/ui/Toast";
import { useProjects, useProjectStats } from "@/hooks/useProjects";
import type { ProjectResponse } from "@/api/projects";
import { buildWorkbenchUrl, currentWorkbenchReturnTo } from "@/utils/workbenchNavigation";
import styles from "./ViewerDashboard.module.css";

const FILTERS = ["全部", "进行中", "待审核", "已完成"] as const;
const FILTER_STATUS_MAP: Record<string, string | undefined> = {
  "全部": undefined,
  "进行中": "in_progress",
  "待审核": "pending_review",
  "已完成": "completed",
};
const WORKBENCH_PROJECT_TYPES = new Set(["image-det", "video-track"]);

export function ViewerDashboard() {
  const [filter, setFilter] = useState<string>("全部");
  const [query, setQuery] = useState("");
  const navigate = useNavigate();
  const location = useLocation();
  const pushToast = useToastStore((s) => s.push);
  const onOpenProject = (p: ProjectResponse) => {
    if (WORKBENCH_PROJECT_TYPES.has(p.type_key)) {
      navigate(buildWorkbenchUrl(p.id, { returnTo: currentWorkbenchReturnTo(location) }));
    } else {
      pushToast({ msg: `项目 "${p.name}" 已打开`, sub: `类型 ${p.type_label} 的标注界面尚未实现` });
    }
  };

  const { data: projects = [], isLoading } = useProjects({
    status: FILTER_STATUS_MAP[filter],
    search: query || undefined,
  });
  const { data: stats } = useProjectStats();

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>项目概览</h1>
        <p className={styles.subtitle}>查看项目进度与数据质量</p>
      </div>

      <div className={styles.statsGrid}>
        <StatCard icon="layers" label="数据总量" value={(stats?.total_data ?? 0).toLocaleString()} />
        <StatCard icon="check" label="已完成标注" value={(stats?.completed ?? 0).toLocaleString()} />
        <StatCard icon="sparkles" label="AI 接管率" value={`${stats?.ai_rate ?? 0}%`} />
        <StatCard icon="flag" label="待审核" value={(stats?.pending_review ?? 0).toLocaleString()} />
      </div>

      <Card>
        <div className={styles.cardHeader}>
          <div className={styles.cardTitleGroup}>
            <h3 className={styles.cardTitle}>项目列表</h3>
            <TabRow tabs={[...FILTERS]} active={filter} onChange={setFilter} />
          </div>
          <SearchInput placeholder="搜索项目..." value={query} onChange={setQuery} width={220} />
        </div>
        <div className={styles.tableScroller}>
          <table className={styles.table}>
            <thead>
              <tr>
                {["项目", "进度", "AI 模型", "状态"].map((h, i) => (
                  <th key={i}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr>
                  <td colSpan={4} className={styles.emptyCell}>加载中...</td>
                </tr>
              )}
              {!isLoading && projects.map((p) => {
                const total = p.total_tasks || 1;
                const pct = Math.round((p.completed_tasks / total) * 100);
                return (
                  <tr key={p.id} onClick={() => onOpenProject(p)} className={styles.clickableRow}>
                    <td>
                      <div className={styles.projectName}>{p.name}</div>
                      <span className={`mono ${styles.projectId}`}>{p.display_id}</span>
                    </td>
                    <td className={styles.progressCell}>
                      <ProgressBar value={pct} />
                      <span className={`mono ${styles.progressPct}`}>{pct}%</span>
                    </td>
                    <td>
                      {p.ai_enabled ? (
                        <Badge variant="ai">
                          <Icon name="sparkles" size={10} />
                          {p.ml_backend_id ? p.ai_model ?? "未接入模型" : "未接入模型"}
                        </Badge>
                      ) : (
                        <span className={styles.noneText}>—</span>
                      )}
                    </td>
                    <td>
                      {p.status === "in_progress" && <Badge variant="accent" dot>进行中</Badge>}
                      {p.status === "completed" && <Badge variant="success" dot>已完成</Badge>}
                      {p.status === "pending_review" && <Badge variant="warning" dot>待审核</Badge>}
                    </td>
                  </tr>
                );
              })}
              {!isLoading && projects.length === 0 && (
                <tr>
                  <td colSpan={4} className={styles.emptyCell}>没有匹配的项目</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
