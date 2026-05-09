/**
 * v0.9.12 · BUG B-17 · /ai-pre 项目卡片网格 (主视图入口).
 *
 * 仅渲染接了 ml_backend 的项目;每张卡片展示 ml_backend 状态 + 批次数量 + 失败数.
 * 点击 → 进 ProjectDetailPanel.
 */

import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Icon } from "@/components/ui/Icon";
import type { PreannotateProjectSummary } from "@/api/adminPreannotate";
import { FS_XS, FS_SM } from "../styles";

interface Props {
  items: PreannotateProjectSummary[];
  isLoading: boolean;
  onSelect: (projectId: string) => void;
}

export function ProjectCardGrid({ items, isLoading, onSelect }: Props) {
  if (isLoading) {
    return (
      <Card>
        <div style={{ padding: 24, textAlign: "center", color: "var(--color-fg-muted)", fontSize: FS_SM }}>
          加载项目列表…
        </div>
      </Card>
    );
  }

  if (items.length === 0) {
    return <EmptyState />;
  }

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
        gap: 12,
      }}
    >
      {items.map((it) => (
        <ProjectCard key={it.project_id} item={it} onClick={() => onSelect(it.project_id)} />
      ))}
    </div>
  );
}

function ProjectCard({
  item,
  onClick,
}: {
  item: PreannotateProjectSummary;
  onClick: () => void;
}) {
  const stateColor =
    item.ml_backend_state === "ready"
      ? "var(--color-success)"
      : item.ml_backend_state === "mismatch"
        ? "var(--color-warning)"
        : "var(--color-fg-subtle)";

  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        textAlign: "left",
        cursor: "pointer",
        padding: 14,
        background: "var(--color-bg-elev)",
        border: "1px solid var(--color-border)",
        borderRadius: "var(--radius-md)",
        display: "flex",
        flexDirection: "column",
        gap: 10,
        fontFamily: "inherit",
        transition: "border-color 120ms ease",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = "var(--color-accent)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = "var(--color-border)";
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontSize: FS_SM,
              fontWeight: 600,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
            title={item.project_name}
          >
            {item.project_name}
          </div>
          <div style={{ fontSize: FS_XS, color: "var(--color-fg-subtle)", marginTop: 2 }}>
            {item.project_display_id ?? "—"} · {item.type_key}
          </div>
        </div>
        <Icon name="chevRight" size={14} />
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            fontSize: FS_XS,
            padding: "2px 8px",
            borderRadius: 999,
            background: "var(--color-bg-sunken)",
            color: stateColor,
          }}
        >
          <Icon name="bot" size={10} />
          {item.ml_backend_name ?? "(未绑定)"}
          {item.ml_backend_state && ` · ${item.ml_backend_state}`}
        </span>
        {item.ml_backend_max_concurrency != null && (
          <span style={{ fontSize: FS_XS, color: "var(--color-fg-muted)" }}>
            最多 {item.ml_backend_max_concurrency} 并发
          </span>
        )}
      </div>

      <div style={{ display: "flex", gap: 14, fontSize: FS_XS }}>
        <BadgeStat label="可预标" value={item.active_batches} variant={item.active_batches > 0 ? "ai" : "muted"} />
        <BadgeStat label="已就绪" value={item.ready_batches} variant={item.ready_batches > 0 ? "success" : "muted"} />
        <BadgeStat
          label="近期失败"
          value={item.recent_failures}
          variant={item.recent_failures > 0 ? "danger" : "muted"}
        />
      </div>

      {item.last_job_at && (
        <div style={{ fontSize: FS_XS, color: "var(--color-fg-muted)" }}>
          最近 job · {formatRelative(item.last_job_at)}
        </div>
      )}
    </button>
  );
}

function BadgeStat({
  label,
  value,
  variant,
}: {
  label: string;
  value: number;
  variant: "ai" | "success" | "danger" | "muted";
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <span style={{ color: "var(--color-fg-subtle)" }}>{label}</span>
      {variant === "muted" ? (
        <span style={{ fontVariantNumeric: "tabular-nums", color: "var(--color-fg-subtle)" }}>{value}</span>
      ) : (
        <Badge variant={variant === "ai" ? "ai" : variant === "success" ? "success" : "danger"}>
          {value}
        </Badge>
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <Card>
      <div
        style={{
          padding: "32px 16px",
          textAlign: "center",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 8,
          color: "var(--color-fg-subtle)",
        }}
      >
        <Icon name="bot" size={28} />
        <div style={{ fontSize: FS_SM, color: "var(--color-fg-muted)" }}>
          暂无接入 ML backend 的项目
        </div>
        <div style={{ fontSize: FS_XS }}>
          先在「模式市场」注册 backend 或在项目设置中绑定一个 backend，再回到这里跑预标。
        </div>
      </div>
    </Card>
  );
}

function formatRelative(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const sec = Math.round((Date.now() - d.getTime()) / 1000);
  if (sec < 60) return `${sec} 秒前`;
  if (sec < 3600) return `${Math.round(sec / 60)} 分钟前`;
  if (sec < 86400) return `${Math.round(sec / 3600)} 小时前`;
  return d.toLocaleDateString("zh-CN");
}
