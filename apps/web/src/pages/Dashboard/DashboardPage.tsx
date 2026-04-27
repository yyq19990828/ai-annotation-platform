import { useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { Avatar } from "@/components/ui/Avatar";
import { StatCard } from "@/components/ui/StatCard";
import { SearchInput } from "@/components/ui/SearchInput";
import { TabRow } from "@/components/ui/TabRow";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { useToastStore } from "@/components/ui/Toast";
import { useProjects, useProjectStats } from "@/hooks/useProjects";
import type { ProjectResponse } from "@/api/projects";

const TYPE_ICONS: Record<string, string> = {
  "image-det": "rect",
  "image-seg": "polygon",
  "image-kp": "point",
  lidar: "cube",
  "video-mm": "video",
  "video-track": "video",
  mm: "mm",
};

function ProjectRow({ p, onOpen }: { p: ProjectResponse; onOpen: (p: ProjectResponse) => void }) {
  const total = p.total_tasks || 1;
  const pct = Math.round((p.completed_tasks / total) * 100);
  const aiPct = p.ai_enabled ? Math.round(pct * 0.6) : 0;
  const due = p.due_date ?? "—";
  const updated = p.updated_at ? new Date(p.updated_at).toLocaleDateString("zh-CN") : "—";

  return (
    <tr onClick={() => onOpen(p)} style={{ cursor: "pointer" }}>
      <td style={{ padding: "12px 12px 12px 16px", borderBottom: "1px solid var(--color-border)", verticalAlign: "middle" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{
            width: 28, height: 28, borderRadius: 6,
            background: "var(--color-bg-sunken)", border: "1px solid var(--color-border)",
            display: "flex", alignItems: "center", justifyContent: "center",
            color: "var(--color-fg-muted)", flex: "0 0 28px",
          }}>
            <Icon name={(TYPE_ICONS[p.type_key] || "image") as any} size={14} />
          </div>
          <div>
            <div style={{ fontWeight: 500, fontSize: 13.5 }}>{p.name}</div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 2 }}>
              <span className="mono" style={{ fontSize: 11, color: "var(--color-fg-subtle)" }}>{p.display_id}</span>
              <span style={{ color: "var(--color-fg-faint)" }}>·</span>
              <span style={{ fontSize: 11.5, color: "var(--color-fg-muted)" }}>{p.type_label}</span>
            </div>
          </div>
        </div>
      </td>
      <td style={{ padding: 12, borderBottom: "1px solid var(--color-border)", verticalAlign: "middle" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Avatar initial="?" size="sm" />
          <div>
            <div style={{ fontSize: 12.5 }}>负责人</div>
            <div style={{ fontSize: 11, color: "var(--color-fg-subtle)" }}>—</div>
          </div>
        </div>
      </td>
      <td style={{ padding: 12, borderBottom: "1px solid var(--color-border)", verticalAlign: "middle", minWidth: 220 }}>
        <ProgressBar value={pct} aiValue={aiPct} />
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4, fontSize: 11, color: "var(--color-fg-muted)" }}>
          <span className="mono">{p.completed_tasks.toLocaleString()} / {p.total_tasks.toLocaleString()}</span>
          <span style={{ fontWeight: 500, color: "var(--color-fg)" }}>{pct}%</span>
        </div>
      </td>
      <td style={{ padding: 12, borderBottom: "1px solid var(--color-border)", verticalAlign: "middle" }}>
        {p.ai_enabled ? (
          <Badge variant="ai"><Icon name="sparkles" size={10} />{p.ai_model}</Badge>
        ) : (
          <span style={{ fontSize: 12, color: "var(--color-fg-subtle)" }}>未启用</span>
        )}
      </td>
      <td style={{ padding: 12, borderBottom: "1px solid var(--color-border)", verticalAlign: "middle" }}>
        {p.status === "进行中" && <Badge variant="accent" dot>进行中</Badge>}
        {p.status === "已完成" && <Badge variant="success" dot>已完成</Badge>}
        {p.status === "待审核" && <Badge variant="warning" dot>待审核</Badge>}
      </td>
      <td style={{ padding: 12, borderBottom: "1px solid var(--color-border)", verticalAlign: "middle" }}>
        <div style={{ fontSize: 12 }}>{due}</div>
        <div style={{ fontSize: 11, color: "var(--color-fg-subtle)" }}>更新 {updated}</div>
      </td>
      <td style={{ padding: "12px 16px 12px 12px", borderBottom: "1px solid var(--color-border)", textAlign: "right", verticalAlign: "middle" }}>
        <Button size="sm">打开 <Icon name="chevRight" size={11} /></Button>
      </td>
    </tr>
  );
}

const FILTERS = ["全部", "进行中", "待审核", "已完成"] as const;

export function DashboardPage({ onOpenProject }: { onOpenProject: (p: ProjectResponse) => void }) {
  const [filter, setFilter] = useState<string>("全部");
  const [query, setQuery] = useState("");
  const pushToast = useToastStore((s) => s.push);

  const { data: projects = [], isLoading } = useProjects({
    status: filter !== "全部" ? filter : undefined,
    search: query || undefined,
  });

  const { data: stats } = useProjectStats();

  return (
    <div style={{ padding: "20px 28px 40px", maxWidth: 1480, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 24, marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 600, margin: "0 0 4px", letterSpacing: "-0.01em" }}>项目总览</h1>
          <p style={{ color: "var(--color-fg-muted)", fontSize: 13, margin: 0 }}>管理你的标注项目,跟踪进度与 AI 辅助效率</p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Button onClick={() => pushToast({ msg: "导入数据集面板已打开", sub: "支持 OSS / 本地 / 数据库" })}>
            <Icon name="upload" size={13} />导入数据集
          </Button>
          <Button variant="primary" onClick={() => pushToast({ msg: "新建项目向导", sub: "选择数据类型 → 配置类别 → 接入模型" })}>
            <Icon name="plus" size={13} />新建项目
          </Button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 20 }}>
        <StatCard icon="layers" label="数据总量" value={(stats?.total_data ?? 0).toLocaleString()} trend={12} sparkValues={[42, 50, 48, 56, 60, 65, 78, 82, 89, 95, 102, 108]} sparkColor="var(--color-accent)" hint="近 12 周" />
        <StatCard icon="check" label="已完成标注" value={(stats?.completed ?? 0).toLocaleString()} trend={8} sparkValues={[20, 28, 24, 36, 42, 48, 56, 62, 68, 74, 80, 86]} sparkColor="var(--color-success)" hint="近 12 周" />
        <StatCard icon="sparkles" label="AI 接管率" value={`${stats?.ai_rate ?? 0}%`} trend={5} sparkValues={[42, 48, 50, 52, 55, 56, 58, 59, 60, 61, 62, 62]} sparkColor="var(--color-ai)" hint="自动通过" />
        <StatCard icon="flag" label="待审核" value={(stats?.pending_review ?? 0).toLocaleString()} trend={-14} sparkValues={[820, 760, 920, 880, 760, 700, 680, 620, 580, 540, 480, 412]} sparkColor="var(--color-warning)" hint="近 12 周" />
      </div>

      <Card>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px", borderBottom: "1px solid var(--color-border)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>我的项目</h3>
            <TabRow tabs={[...FILTERS]} active={filter} onChange={setFilter} />
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <SearchInput placeholder="搜索项目..." value={query} onChange={setQuery} width={220} />
            <Button><Icon name="filter" size={13} />筛选</Button>
            <Button><Icon name="grid" size={13} /></Button>
          </div>
        </div>
        <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0, fontSize: 13 }}>
          <thead>
            <tr>
              {["项目", "负责人", "进度", "AI 模型", "状态", "截止 / 更新", ""].map((h, i) => (
                <th key={i} style={{
                  textAlign: "left", fontWeight: 500, fontSize: 12,
                  color: "var(--color-fg-muted)", padding: "10px 12px",
                  borderBottom: "1px solid var(--color-border)",
                  background: "var(--color-bg-sunken)",
                  ...(i === 0 ? { paddingLeft: 16 } : {}),
                  ...(i === 6 ? { paddingRight: 16 } : {}),
                }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={7} style={{ textAlign: "center", padding: 40, color: "var(--color-fg-subtle)" }}>
                  加载中...
                </td>
              </tr>
            )}
            {!isLoading && projects.map((p) => (
              <ProjectRow key={p.id} p={p} onOpen={onOpenProject} />
            ))}
            {!isLoading && projects.length === 0 && (
              <tr>
                <td colSpan={7} style={{ textAlign: "center", padding: 40, color: "var(--color-fg-subtle)" }}>
                  没有匹配的项目
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>

      <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 12, marginTop: 16 }}>
        <Card>
          <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--color-border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>AI 预标注队列</h3>
            <Badge variant="ai" dot>3 个任务运行中</Badge>
          </div>
          <div style={{ padding: "8px 16px 16px" }}>
            {[
              { name: "智能门店货架商品检测", model: "GroundingDINO + SAM", pct: 78, eta: "约 14 分钟", gpu: "GPU-A100 #2" },
              { name: "自动驾驶激光点云路况", model: "PointPillars", pct: 34, eta: "约 1 小时 22 分", gpu: "GPU-A100 #5" },
              { name: "短视频内容审核多模态", model: "GPT-4V (API)", pct: 52, eta: "约 38 分钟", gpu: "API 调用" },
            ].map((q, i) => (
              <div key={i} style={{ padding: "10px 0", borderBottom: i < 2 ? "1px solid var(--color-border)" : "none" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 500 }}>{q.name}</div>
                    <div style={{ fontSize: 11.5, color: "var(--color-fg-muted)", marginTop: 2 }}>
                      <Icon name="bot" size={11} style={{ verticalAlign: "-2px", marginRight: 4 }} />
                      {q.model} · {q.gpu}
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div className="mono" style={{ fontSize: 13, fontWeight: 600 }}>{q.pct}%</div>
                    <div style={{ fontSize: 11, color: "var(--color-fg-subtle)" }}>剩余 {q.eta}</div>
                  </div>
                </div>
                <ProgressBar value={q.pct} color="var(--color-ai)" />
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--color-border)" }}>
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>近期活动</h3>
          </div>
          <div style={{ padding: "4px 16px 14px" }}>
            {[
              { who: "李静雯", act: "通过审核了", what: "412 个商品检测样本", when: "12 分钟前", isAi: false },
              { who: "AI 助手", act: "完成预标注", what: "1,840 帧点云数据", when: "32 分钟前", isAi: true },
              { who: "陈思琪", act: "提交了", what: "短视频内容审核 88 个样本", when: "1 小时前", isAi: false },
              { who: "AI 助手", act: "驳回低置信度样本", what: "62 个样本需人工复核", when: "2 小时前", isAi: true },
              { who: "张明轩", act: "新建项目", what: "智能门店货架商品检测", when: "今天 09:18", isAi: false },
            ].map((a, i) => (
              <div key={i} style={{ display: "flex", gap: 10, padding: "10px 0", borderBottom: i < 4 ? "1px solid var(--color-border)" : "none", alignItems: "flex-start" }}>
                {a.isAi ? (
                  <div style={{
                    width: 24, height: 24, borderRadius: "50%",
                    background: "var(--color-ai-soft)", color: "var(--color-ai)",
                    display: "flex", alignItems: "center", justifyContent: "center", flex: "0 0 24px",
                  }}>
                    <Icon name="sparkles" size={12} />
                  </div>
                ) : (
                  <Avatar initial={a.who[0]} size="sm" style={{ flex: "0 0 24px", width: 24, height: 24 }} />
                )}
                <div style={{ flex: 1, fontSize: 12.5, lineHeight: 1.5 }}>
                  <span style={{ fontWeight: 500 }}>{a.who}</span>
                  <span style={{ color: "var(--color-fg-muted)" }}> {a.act} </span>
                  <span>{a.what}</span>
                  <div style={{ fontSize: 11, color: "var(--color-fg-subtle)", marginTop: 2 }}>{a.when}</div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
