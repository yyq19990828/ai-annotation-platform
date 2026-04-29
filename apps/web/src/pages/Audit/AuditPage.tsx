import { useMemo, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Icon } from "@/components/ui/Icon";
import { Modal } from "@/components/ui/Modal";
import { useToastStore } from "@/components/ui/Toast";
import { useAuditLogs } from "@/hooks/useAudit";
import { useUsers } from "@/hooks/useUsers";
import { auditApi } from "@/api/audit";
import {
  AUDIT_BUSINESS_ACTIONS,
  AUDIT_TARGET_TYPES,
  auditActionLabel,
} from "@/utils/auditLabels";
import { ROLE_LABELS } from "@/constants/roles";
import type { AuditLogResponse } from "@/api/audit";
import type { UserRole } from "@/types";

const PAGE_SIZE = 20;

export function AuditPage() {
  const [page, setPage] = useState(1);
  const [actionFilter, setActionFilter] = useState("");
  const [targetType, setTargetType] = useState("");
  const [actorId, setActorId] = useState("");
  const [scope, setScope] = useState<"business" | "all">("business");
  const [detail, setDetail] = useState<AuditLogResponse | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [exporting, setExporting] = useState(false);
  const pushToast = useToastStore((s) => s.push);

  const { data: usersData = [] } = useUsers();
  const params = useMemo(
    () => ({
      page,
      page_size: PAGE_SIZE,
      action: actionFilter || undefined,
      target_type: targetType || undefined,
      actor_id: actorId || undefined,
    }),
    [page, actionFilter, targetType, actorId],
  );
  const { data, isLoading, refetch, isFetching } = useAuditLogs(params, {
    refetchInterval: autoRefresh ? 30_000 : false,
  });

  const handleExport = async (format: "csv" | "json") => {
    if (exporting) return;
    setExporting(true);
    try {
      await auditApi.export(params, format);
      pushToast({ msg: `已导出审计日志 ${format.toUpperCase()}`, kind: "success" });
    } catch (err) {
      pushToast({ msg: "导出失败", sub: err instanceof Error ? err.message : String(err), kind: "error" });
    } finally {
      setExporting(false);
    }
  };

  const items = useMemo(() => {
    const all = data?.items ?? [];
    return scope === "business" ? all.filter((it) => !it.action.startsWith("http.")) : all;
  }, [data?.items, scope]);

  const total = data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div style={{ padding: "20px 28px 40px", maxWidth: 1480, margin: "0 auto" }}>
      <header style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 24, marginBottom: 16 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 600, margin: "0 0 4px" }}>审计日志</h1>
          <p style={{ color: "var(--color-fg-muted)", fontSize: 13, margin: 0 }}>
            所有写操作（POST/PATCH/PUT/DELETE）由中间件捕获；关键业务事件携带结构化 detail。
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "var(--color-fg-muted)", cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              style={{ cursor: "pointer" }}
            />
            30s 自动刷新
          </label>
          <Button onClick={() => handleExport("csv")} disabled={exporting}>
            <Icon name="download" size={12} />CSV
          </Button>
          <Button onClick={() => handleExport("json")} disabled={exporting}>
            <Icon name="download" size={12} />JSON
          </Button>
          <Button onClick={() => refetch()}>
            <Icon name="refresh" size={12} />刷新
          </Button>
        </div>
      </header>

      <Card>
        <div style={{ display: "flex", gap: 8, padding: "12px 16px", borderBottom: "1px solid var(--color-border)", flexWrap: "wrap", alignItems: "center" }}>
          <select value={scope} onChange={(e) => setScope(e.target.value as "business" | "all")} style={selectStyle}>
            <option value="business">仅业务事件</option>
            <option value="all">全部（含 HTTP 元数据）</option>
          </select>
          <select value={actionFilter} onChange={(e) => { setActionFilter(e.target.value); setPage(1); }} style={selectStyle}>
            <option value="">全部动作</option>
            {AUDIT_BUSINESS_ACTIONS.map((a) => (
              <option key={a} value={a}>{auditActionLabel(a)}</option>
            ))}
          </select>
          <select value={targetType} onChange={(e) => { setTargetType(e.target.value); setPage(1); }} style={selectStyle}>
            <option value="">全部对象</option>
            {AUDIT_TARGET_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          <select value={actorId} onChange={(e) => { setActorId(e.target.value); setPage(1); }} style={{ ...selectStyle, minWidth: 200 }}>
            <option value="">全部用户</option>
            {usersData.map((u) => (
              <option key={u.id} value={u.id}>{u.name} · {u.email}</option>
            ))}
          </select>
          <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--color-fg-muted)" }}>
            共 {total} 条 · 第 {page} / {pageCount} 页
          </span>
        </div>

        <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0, fontSize: 13 }}>
          <thead>
            <tr>
              {["时间", "操作人", "动作", "对象", "IP", "状态", ""].map((h, i) => (
                <th key={i} style={thStyle}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(isLoading || isFetching) && items.length === 0 && (
              <tr><td colSpan={7} style={{ padding: 32, textAlign: "center", color: "var(--color-fg-subtle)" }}>加载中...</td></tr>
            )}
            {!isLoading && items.length === 0 && (
              <tr><td colSpan={7} style={{ padding: 32, textAlign: "center", color: "var(--color-fg-subtle)" }}>暂无记录</td></tr>
            )}
            {items.map((it) => (
              <tr key={it.id}>
                <td style={{ ...tdStyle, color: "var(--color-fg-muted)", fontSize: 12, whiteSpace: "nowrap" }}>
                  {new Date(it.created_at).toLocaleString("zh-CN", { hour12: false })}
                </td>
                <td style={tdStyle}>
                  {it.actor_email ? (
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 12.5 }}>{it.actor_email}</span>
                      {it.actor_role && (
                        <Badge variant="outline" style={{ fontSize: 10 }}>
                          {ROLE_LABELS[it.actor_role as UserRole] ?? it.actor_role}
                        </Badge>
                      )}
                    </div>
                  ) : (
                    <span style={{ color: "var(--color-fg-subtle)", fontStyle: "italic", fontSize: 12 }}>匿名</span>
                  )}
                </td>
                <td style={tdStyle}>
                  <Badge variant={it.action.startsWith("http.") ? "outline" : "accent"} style={{ fontSize: 11 }}>
                    {auditActionLabel(it.action)}
                  </Badge>
                </td>
                <td style={{ ...tdStyle, fontSize: 12, color: "var(--color-fg-muted)" }}>
                  {it.target_type ? `${it.target_type}` : "—"}
                  {it.target_id && (
                    <span className="mono" style={{ marginLeft: 4, fontSize: 11, color: "var(--color-fg-subtle)" }}>
                      {it.target_id.length > 24 ? it.target_id.slice(0, 8) + "…" : it.target_id}
                    </span>
                  )}
                </td>
                <td style={{ ...tdStyle, fontSize: 11.5, color: "var(--color-fg-muted)", fontFamily: "var(--font-mono, monospace)" }}>
                  {it.ip ?? "—"}
                </td>
                <td style={tdStyle}>{statusBadge(it.status_code)}</td>
                <td style={{ ...tdStyle, textAlign: "right" }}>
                  <Button size="sm" variant="ghost" onClick={() => setDetail(it)}>详情</Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 6, padding: 12, borderTop: "1px solid var(--color-border)" }}>
          <Button size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            <Icon name="chevLeft" size={11} />上一页
          </Button>
          <Button size="sm" disabled={page >= pageCount} onClick={() => setPage((p) => p + 1)}>
            下一页<Icon name="chevRight" size={11} />
          </Button>
        </div>
      </Card>

      <Modal open={!!detail} onClose={() => setDetail(null)} title="审计日志详情" width={620}>
        {detail && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10, fontSize: 12.5 }}>
            <KV label="时间" value={new Date(detail.created_at).toLocaleString("zh-CN")} />
            <KV label="操作人" value={detail.actor_email ?? "匿名"} mono />
            <KV label="动作" value={`${auditActionLabel(detail.action)} (${detail.action})`} />
            <KV label="对象" value={`${detail.target_type ?? "-"} / ${detail.target_id ?? "-"}`} mono />
            <KV label="HTTP" value={`${detail.method ?? "-"} ${detail.path ?? "-"}`} mono />
            <KV label="状态" value={String(detail.status_code ?? "-")} />
            <KV label="IP" value={detail.ip ?? "-"} mono />
            <div>
              <div style={{ fontSize: 11.5, color: "var(--color-fg-muted)", marginBottom: 4 }}>detail_json</div>
              <pre style={{
                margin: 0, padding: 12, background: "var(--color-bg-sunken)",
                border: "1px solid var(--color-border)", borderRadius: "var(--radius-md)",
                fontSize: 12, overflow: "auto", maxHeight: 320,
              }}>
                {detail.detail_json ? JSON.stringify(detail.detail_json, null, 2) : "(空 — 中间件元数据行)"}
              </pre>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

function statusBadge(code: number | null) {
  if (code === null) return <span style={{ color: "var(--color-fg-subtle)" }}>—</span>;
  if (code >= 500) return <Badge variant="danger" style={{ fontSize: 11 }}>{code}</Badge>;
  if (code >= 400) return <Badge variant="warning" style={{ fontSize: 11 }}>{code}</Badge>;
  if (code >= 200) return <Badge variant="success" style={{ fontSize: 11 }}>{code}</Badge>;
  return <Badge variant="outline" style={{ fontSize: 11 }}>{code}</Badge>;
}

function KV({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={{ display: "flex", gap: 12 }}>
      <div style={{ width: 80, color: "var(--color-fg-muted)" }}>{label}</div>
      <div className={mono ? "mono" : undefined} style={{ flex: 1, wordBreak: "break-all" }}>{value}</div>
    </div>
  );
}

const selectStyle: React.CSSProperties = {
  padding: "5px 8px",
  border: "1px solid var(--color-border)",
  borderRadius: "var(--radius-md)",
  fontSize: 12.5,
  background: "var(--color-bg-elev)",
  color: "var(--color-fg)",
};

const thStyle: React.CSSProperties = {
  textAlign: "left",
  fontWeight: 500,
  fontSize: 12,
  color: "var(--color-fg-muted)",
  padding: "10px 12px",
  borderBottom: "1px solid var(--color-border)",
  background: "var(--color-bg-sunken)",
};

const tdStyle: React.CSSProperties = {
  padding: "10px 12px",
  borderBottom: "1px solid var(--color-border)",
  verticalAlign: "middle",
};
