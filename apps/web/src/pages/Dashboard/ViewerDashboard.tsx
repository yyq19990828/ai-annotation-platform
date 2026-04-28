import { useState } from "react";
import { useNavigate } from "react-router-dom";
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

const FILTERS = ["全部", "进行中", "待审核", "已完成"] as const;
const FILTER_STATUS_MAP: Record<string, string | undefined> = {
  "全部": undefined,
  "进行中": "in_progress",
  "待审核": "pending_review",
  "已完成": "completed",
};

export function ViewerDashboard() {
  const [filter, setFilter] = useState<string>("全部");
  const [query, setQuery] = useState("");
  const navigate = useNavigate();
  const pushToast = useToastStore((s) => s.push);
  const onOpenProject = (p: ProjectResponse) => {
    if (p.type_key === "image-det") {
      navigate(`/projects/${p.id}/annotate`);
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
    <div style={{ padding: "20px 28px 40px", maxWidth: 1480, margin: "0 auto" }}>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 20, fontWeight: 600, margin: "0 0 4px", letterSpacing: "-0.01em" }}>项目概览</h1>
        <p style={{ color: "var(--color-fg-muted)", fontSize: 13, margin: 0 }}>查看项目进度与数据质量</p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 20 }}>
        <StatCard icon="layers" label="数据总量" value={(stats?.total_data ?? 0).toLocaleString()} />
        <StatCard icon="check" label="已完成标注" value={(stats?.completed ?? 0).toLocaleString()} />
        <StatCard icon="sparkles" label="AI 接管率" value={`${stats?.ai_rate ?? 0}%`} />
        <StatCard icon="flag" label="待审核" value={(stats?.pending_review ?? 0).toLocaleString()} />
      </div>

      <Card>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px", borderBottom: "1px solid var(--color-border)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>项目列表</h3>
            <TabRow tabs={[...FILTERS]} active={filter} onChange={setFilter} />
          </div>
          <SearchInput placeholder="搜索项目..." value={query} onChange={setQuery} width={220} />
        </div>
        <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0, fontSize: 13 }}>
          <thead>
            <tr>
              {["项目", "进度", "AI 模型", "状态"].map((h, i) => (
                <th key={i} style={{
                  textAlign: "left", fontWeight: 500, fontSize: 12,
                  color: "var(--color-fg-muted)", padding: "10px 12px",
                  borderBottom: "1px solid var(--color-border)",
                  background: "var(--color-bg-sunken)",
                  ...(i === 0 ? { paddingLeft: 16 } : {}),
                }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={4} style={{ textAlign: "center", padding: 40, color: "var(--color-fg-subtle)" }}>加载中...</td>
              </tr>
            )}
            {!isLoading && projects.map((p) => {
              const total = p.total_tasks || 1;
              const pct = Math.round((p.completed_tasks / total) * 100);
              return (
                <tr key={p.id} onClick={() => onOpenProject(p)} style={{ cursor: "pointer" }}>
                  <td style={{ padding: "12px 12px 12px 16px", borderBottom: "1px solid var(--color-border)" }}>
                    <div style={{ fontWeight: 500, fontSize: 13.5 }}>{p.name}</div>
                    <span className="mono" style={{ fontSize: 11, color: "var(--color-fg-subtle)" }}>{p.display_id}</span>
                  </td>
                  <td style={{ padding: 12, borderBottom: "1px solid var(--color-border)", minWidth: 180 }}>
                    <ProgressBar value={pct} />
                    <span className="mono" style={{ fontSize: 11, color: "var(--color-fg-muted)" }}>{pct}%</span>
                  </td>
                  <td style={{ padding: 12, borderBottom: "1px solid var(--color-border)" }}>
                    {p.ai_enabled ? (
                      <Badge variant="ai"><Icon name="sparkles" size={10} />{p.ai_model}</Badge>
                    ) : (
                      <span style={{ fontSize: 12, color: "var(--color-fg-subtle)" }}>—</span>
                    )}
                  </td>
                  <td style={{ padding: 12, borderBottom: "1px solid var(--color-border)" }}>
                    {p.status === "in_progress" && <Badge variant="accent" dot>进行中</Badge>}
                    {p.status === "completed" && <Badge variant="success" dot>已完成</Badge>}
                    {p.status === "pending_review" && <Badge variant="warning" dot>待审核</Badge>}
                  </td>
                </tr>
              );
            })}
            {!isLoading && projects.length === 0 && (
              <tr>
                <td colSpan={4} style={{ textAlign: "center", padding: 40, color: "var(--color-fg-subtle)" }}>没有匹配的项目</td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
