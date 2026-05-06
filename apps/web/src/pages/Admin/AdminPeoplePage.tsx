import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Icon } from "@/components/ui/Icon";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Avatar } from "@/components/ui/Avatar";
import { Sparkline } from "@/components/ui/Sparkline";
import { Histogram } from "@/components/ui/Histogram";
import { RadialProgress } from "@/components/ui/RadialProgress";
import { useAdminPeople, useAdminPersonDetail } from "@/hooks/useDashboard";
import type { AdminPersonItem } from "@/api/dashboard";

const ROLE_OPTS = [
  { v: "", label: "全部" },
  { v: "annotator", label: "标注员" },
  { v: "reviewer", label: "审核员" },
];
const PERIOD_OPTS = [
  { v: "today", label: "今日" },
  { v: "7d", label: "本周" },
  { v: "1m", label: "本月" },
];
const SORT_OPTS = [
  { v: "throughput", label: "产能↓" },
  { v: "quality", label: "质量↓" },
  { v: "activity", label: "活跃↓" },
  { v: "weekly_compare", label: "周环比↓" },
];

export function AdminPeoplePage() {
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();
  const role = sp.get("role") || "";
  const period = sp.get("period") || "7d";
  const sort = sp.get("sort") || "throughput";
  const q = sp.get("q") || "";

  const [activeUserId, setActiveUserId] = useState<string | null>(null);

  const { data, isLoading } = useAdminPeople({
    role: role || undefined,
    period,
    sort,
    q: q || undefined,
  });

  const items = data?.items ?? [];

  const setQuery = (key: string, value: string) => {
    const next = new URLSearchParams(sp);
    if (value) next.set(key, value);
    else next.delete(key);
    setSp(next, { replace: true });
  };

  return (
    <div style={{ padding: "20px 28px 40px", maxWidth: 1680, margin: "0 auto" }}>
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          marginBottom: 16,
        }}
      >
        <div>
          <h1
            style={{
              fontSize: 20,
              fontWeight: 600,
              margin: "0 0 4px",
              letterSpacing: "-0.01em",
            }}
          >
            成员绩效
          </h1>
          <p style={{ color: "var(--color-fg-muted)", fontSize: 13, margin: 0 }}>
            全员效率卡片网格 · 点击卡片查看详情
          </p>
        </div>
        <Button variant="ghost" onClick={() => navigate("/dashboard")}>
          <Icon name="chevron-left" size={13} />返回总览
        </Button>
      </div>

      {/* sticky filter bar */}
      <Card style={{ position: "sticky", top: 64, zIndex: 5, marginBottom: 16 }}>
        <div
          style={{
            padding: 12,
            display: "flex",
            flexWrap: "wrap",
            gap: 8,
            alignItems: "center",
          }}
        >
          <FilterGroup
            label="角色"
            opts={ROLE_OPTS}
            value={role}
            onChange={(v: string) => setQuery("role", v)}
          />
          <FilterGroup
            label="时间"
            opts={PERIOD_OPTS}
            value={period}
            onChange={(v: string) => setQuery("period", v)}
          />
          <FilterGroup
            label="排序"
            opts={SORT_OPTS}
            value={sort}
            onChange={(v: string) => setQuery("sort", v)}
          />
          <input
            type="search"
            placeholder="姓名 / 邮箱"
            defaultValue={q}
            onKeyDown={(e: any) => {
              if (e.key === "Enter") setQuery("q", e.currentTarget.value);
            }}
            style={{
              marginLeft: "auto",
              padding: "6px 10px",
              fontSize: 12.5,
              border: "1px solid var(--color-border)",
              borderRadius: "var(--radius-md)",
              background: "var(--color-bg-elev)",
              minWidth: 200,
            }}
          />
        </div>
      </Card>

      {isLoading ? (
        <div
          style={{
            padding: 60,
            textAlign: "center",
            color: "var(--color-fg-subtle)",
          }}
        >
          加载中...
        </div>
      ) : items.length === 0 ? (
        <Card style={{ padding: "48px 16px", textAlign: "center" }}>
          <Icon name="users" size={36} style={{ opacity: 0.25, marginBottom: 10 }} />
          <div style={{ fontSize: 14, marginBottom: 4 }}>暂无成员数据</div>
          <div style={{ fontSize: 12, color: "var(--color-fg-subtle)" }}>
            调整筛选条件重试
          </div>
        </Card>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
            gap: 12,
          }}
        >
          {items.map((it) => (
            <PersonCard
              key={it.user_id}
              item={it}
              onClick={() => setActiveUserId(it.user_id)}
            />
          ))}
        </div>
      )}

      {activeUserId && (
        <PersonDrawer
          userId={activeUserId}
          onClose={() => setActiveUserId(null)}
        />
      )}
    </div>
  );
}

function FilterGroup({
  label,
  opts,
  value,
  onChange,
}: {
  label: string;
  opts: Array<{ v: string; label: string }>;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <span style={{ fontSize: 11.5, color: "var(--color-fg-muted)" }}>{label}</span>
      <div style={{ display: "flex", gap: 2 }}>
        {opts.map((o) => (
          <button
            key={o.v}
            type="button"
            onClick={() => onChange(o.v)}
            style={{
              padding: "4px 10px",
              fontSize: 12,
              border: "1px solid var(--color-border)",
              borderRadius: "var(--radius-sm)",
              background:
                value === o.v
                  ? "var(--color-accent-soft)"
                  : "var(--color-bg-elev)",
              color:
                value === o.v ? "var(--color-accent)" : "var(--color-fg)",
              cursor: "pointer",
              fontWeight: value === o.v ? 600 : 400,
            }}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function PersonCard({ item, onClick }: { item: AdminPersonItem; onClick: () => void }) {
  const trend = item.weekly_compare_pct;
  return (
    <Card
      onClick={onClick}
      style={{
        cursor: "pointer",
        padding: 14,
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <Avatar initial={item.name?.charAt(0) || "?"} size="md" />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 13,
              fontWeight: 600,
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <span
              style={{
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {item.name}
            </span>
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background:
                  item.status === "online"
                    ? "var(--color-success)"
                    : "var(--color-fg-subtle)",
              }}
            />
          </div>
          <div style={{ fontSize: 11, color: "var(--color-fg-subtle)" }}>
            <Badge
              variant={
                item.role === "annotator" ? "accent" : "ai"
              }
              style={{ fontSize: 10, padding: "0 5px", marginRight: 4 }}
            >
              {item.role}
            </Badge>
            {item.project_count} 项目
          </div>
        </div>
        <RadialProgress
          value={Math.round(
            (item.throughput_score + item.quality_score + item.activity_score) / 3,
          )}
          size={36}
          thickness={4}
        />
      </div>

      <div>
        <div
          style={{
            fontSize: 24,
            fontWeight: 600,
            letterSpacing: "-0.01em",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {item.main_metric.toLocaleString()}
          {trend != null && (
            <span
              style={{
                fontSize: 11,
                marginLeft: 6,
                fontWeight: 500,
                color:
                  trend >= 0 ? "var(--color-success)" : "var(--color-danger)",
              }}
            >
              {trend >= 0 ? "↑" : "↓"} {Math.abs(trend)}%
            </span>
          )}
        </div>
        <div style={{ fontSize: 11, color: "var(--color-fg-muted)" }}>
          {item.main_metric_label}
        </div>
      </div>

      <PercentBars
        rows={[
          { label: "产能", value: item.throughput_score },
          { label: "质量", value: item.quality_score },
          { label: "活跃", value: item.activity_score },
        ]}
      />

      <Sparkline values={item.sparkline_7d} color="var(--color-accent)" width={252} height={24} />

      {item.alerts.length > 0 && (
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          {item.alerts.includes("high_rejected") && (
            <Badge variant="danger" style={{ fontSize: 10 }}>
              退回率 {item.rejected_rate}% &gt; 15%
            </Badge>
          )}
          {item.alerts.includes("drop_30") && (
            <Badge variant="warning" style={{ fontSize: 10 }}>
              周环比降幅 &gt; 30%
            </Badge>
          )}
        </div>
      )}
    </Card>
  );
}

function PercentBars({ rows }: { rows: Array<{ label: string; value: number }> }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {rows.map((r) => (
        <div
          key={r.label}
          style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11 }}
        >
          <span style={{ width: 28, color: "var(--color-fg-muted)" }}>{r.label}</span>
          <div
            style={{
              flex: 1,
              height: 4,
              background: "var(--color-border)",
              borderRadius: 2,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                width: `${Math.min(100, Math.max(0, r.value))}%`,
                height: "100%",
                background: "var(--color-accent)",
              }}
            />
          </div>
          <span
            style={{
              fontVariantNumeric: "tabular-nums",
              width: 24,
              textAlign: "right",
              color: "var(--color-fg-muted)",
            }}
          >
            {Math.round(r.value)}
          </span>
        </div>
      ))}
    </div>
  );
}

function PersonDrawer({ userId, onClose }: { userId: string; onClose: () => void }) {
  const { data, isLoading } = useAdminPersonDetail(userId, "4w");
  const histogramValues = useMemo(() => (data?.duration_histogram ?? []).map((b) => b.count), [data]);
  const xLabels = useMemo(
    () => (data?.duration_histogram ?? []).map((b) => `${Math.round(b.upper_ms / 1000)}s`),
    [data],
  );

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "oklch(0 0 0 / 0.4)",
        zIndex: 50,
        display: "flex",
        justifyContent: "flex-end",
      }}
    >
      <div
        onClick={(e: any) => e.stopPropagation()}
        style={{
          width: 540,
          maxWidth: "100%",
          background: "var(--color-bg-elev)",
          borderLeft: "1px solid var(--color-border)",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div
          style={{
            padding: "14px 18px",
            borderBottom: "1px solid var(--color-border)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ fontSize: 14, fontWeight: 600 }}>
            {data?.name ?? "成员详情"}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            style={{
              background: "transparent",
              border: "none",
              cursor: "pointer",
              color: "var(--color-fg-muted)",
            }}
          >
            <Icon name="x" size={16} />
          </button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
          {isLoading || !data ? (
            <div style={{ padding: 32, textAlign: "center", color: "var(--color-fg-subtle)" }}>
              加载中...
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
                <KpiCell label="产能" value={data.throughput} />
                <KpiCell label="质量" value={`${data.quality_score}%`} />
                <KpiCell
                  label="活跃"
                  value={data.active_minutes == null ? "—" : `${data.active_minutes}m`}
                />
                <KpiCell label="综合分" value={data.composite_score} />
              </div>

              <Card>
                <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--color-border)", fontSize: 12, fontWeight: 600 }}>
                  4 周趋势
                </div>
                <div style={{ padding: 14 }}>
                  <div style={{ marginBottom: 6, fontSize: 11, color: "var(--color-fg-muted)" }}>产能</div>
                  <Sparkline values={data.trend_throughput} width={480} height={48} color="var(--color-accent)" />
                  <div style={{ marginTop: 12, marginBottom: 6, fontSize: 11, color: "var(--color-fg-muted)" }}>质量分</div>
                  <Sparkline values={data.trend_quality} width={480} height={48} color="var(--color-success)" />
                </div>
              </Card>

              {data.duration_histogram.length > 0 && (
                <Card>
                  <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--color-border)", fontSize: 12, fontWeight: 600 }}>
                    任务耗时分布
                    {data.p50_duration_ms != null && (
                      <span style={{ fontSize: 11, color: "var(--color-fg-subtle)", marginLeft: 8 }}>
                        p50 {Math.round(data.p50_duration_ms / 1000)}s · p95 {Math.round((data.p95_duration_ms ?? 0) / 1000)}s
                      </span>
                    )}
                  </div>
                  <div style={{ padding: 14 }}>
                    <Histogram values={histogramValues} xLabels={xLabels} />
                  </div>
                </Card>
              )}

              {data.project_distribution.length > 0 && (
                <Card>
                  <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--color-border)", fontSize: 12, fontWeight: 600 }}>
                    项目分布
                  </div>
                  <div style={{ padding: "8px 0" }}>
                    {data.project_distribution.map((p) => (
                      <div
                        key={p.project_id}
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          padding: "6px 14px",
                          fontSize: 12.5,
                        }}
                      >
                        <span>{p.project_name}</span>
                        <span style={{ color: "var(--color-fg-muted)", fontVariantNumeric: "tabular-nums" }}>
                          {p.count}
                        </span>
                      </div>
                    ))}
                  </div>
                </Card>
              )}

              {data.timeline.length > 0 && (
                <Card>
                  <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--color-border)", fontSize: 12, fontWeight: 600 }}>
                    最近 timeline ({data.timeline.length})
                  </div>
                  <div style={{ maxHeight: 320, overflowY: "auto" }}>
                    {data.timeline.map((t, i) => (
                      <div
                        key={i}
                        style={{
                          padding: "8px 14px",
                          fontSize: 12,
                          borderTop: i === 0 ? "none" : "1px solid var(--color-border-subtle)",
                          display: "flex",
                          gap: 8,
                          alignItems: "center",
                        }}
                      >
                        <Badge variant="outline" style={{ fontSize: 10 }}>{t.action}</Badge>
                        {t.task_display_id && (
                          <span className="mono" style={{ fontSize: 11, color: "var(--color-accent)" }}>
                            {t.task_display_id}
                          </span>
                        )}
                        <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--color-fg-subtle)" }}>
                          {t.at ? new Date(t.at).toLocaleString("zh-CN") : "—"}
                        </span>
                      </div>
                    ))}
                  </div>
                </Card>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function KpiCell({ label, value }: { label: string; value: string | number }) {
  return (
    <div
      style={{
        padding: "10px 12px",
        background: "var(--color-bg-sunken)",
        border: "1px solid var(--color-border)",
        borderRadius: "var(--radius-md)",
      }}
    >
      <div style={{ fontSize: 11, color: "var(--color-fg-muted)" }}>{label}</div>
      <div
        style={{
          fontSize: 18,
          fontWeight: 600,
          fontVariantNumeric: "tabular-nums",
          letterSpacing: "-0.01em",
        }}
      >
        {value}
      </div>
    </div>
  );
}
