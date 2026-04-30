import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
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
  const [searchParams, setSearchParams] = useSearchParams();
  const [page, setPage] = useState(1);
  const [actionFilter, setActionFilter] = useState(searchParams.get("action") ?? "");
  const [targetType, setTargetType] = useState(searchParams.get("target_type") ?? "");
  const [targetId, setTargetId] = useState(searchParams.get("target_id") ?? "");
  const [actorId, setActorId] = useState(searchParams.get("actor_id") ?? "");
  const [detailKey, setDetailKey] = useState(searchParams.get("detail_key") ?? "");
  const [detailValue, setDetailValue] = useState(searchParams.get("detail_value") ?? "");
  const [scope, setScope] = useState<"business" | "all">("business");
  const [detail, setDetail] = useState<AuditLogResponse | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [exporting, setExporting] = useState(false);
  const pushToast = useToastStore((s) => s.push);

  const { data: usersData = [] } = useUsers();

  // URL 参数变化（如从 UsersPage 跳过来）→ 更新筛选并回到第 1 页
  useEffect(() => {
    setActionFilter(searchParams.get("action") ?? "");
    setTargetType(searchParams.get("target_type") ?? "");
    setTargetId(searchParams.get("target_id") ?? "");
    setActorId(searchParams.get("actor_id") ?? "");
    setDetailKey(searchParams.get("detail_key") ?? "");
    setDetailValue(searchParams.get("detail_value") ?? "");
    setPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams.toString()]);

  const focused =
    !!actorId || !!targetId || !!targetType || !!actionFilter || !!detailKey;
  const focusedActor = actorId
    ? usersData.find((u) => u.id === actorId)
    : null;

  const clearFocus = () => {
    setSearchParams({}, { replace: true });
    setActionFilter("");
    setTargetType("");
    setTargetId("");
    setActorId("");
    setDetailKey("");
    setDetailValue("");
    setPage(1);
  };

  const params = useMemo(
    () => ({
      page,
      page_size: PAGE_SIZE,
      action: actionFilter || undefined,
      target_type: targetType || undefined,
      target_id: targetId || undefined,
      actor_id: actorId || undefined,
      detail_key: detailKey || undefined,
      detail_value: detailKey ? detailValue : undefined,
    }),
    [page, actionFilter, targetType, targetId, actorId, detailKey, detailValue],
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
          <input
            value={targetId}
            placeholder="对象 ID（精确匹配）"
            onChange={(e) => { setTargetId(e.target.value); setPage(1); }}
            style={{ ...selectStyle, width: 220, fontFamily: "var(--font-mono, monospace)" }}
          />
          <input
            value={detailKey}
            placeholder="detail 键名（如 role）"
            title="A.3：detail_json 字段级 GIN 过滤——键名"
            onChange={(e) => { setDetailKey(e.target.value); setPage(1); }}
            style={{ ...selectStyle, width: 160, fontFamily: "var(--font-mono, monospace)" }}
          />
          <input
            value={detailValue}
            placeholder="detail 键值（如 super_admin）"
            title="A.3：detail_json 字段级 GIN 过滤——键值（与键名共同生效）"
            onChange={(e) => { setDetailValue(e.target.value); setPage(1); }}
            disabled={!detailKey}
            style={{ ...selectStyle, width: 200, fontFamily: "var(--font-mono, monospace)", opacity: detailKey ? 1 : 0.5 }}
          />
          <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--color-fg-muted)" }}>
            共 {total} 条 · 第 {page} / {pageCount} 页
          </span>
        </div>

        {focused && (
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "8px 16px", borderBottom: "1px solid var(--color-border)",
            background: "rgba(99, 102, 241, 0.08)",
            fontSize: 12.5,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <Icon name="target" size={13} style={{ color: "var(--color-accent)" }} />
              <span style={{ color: "var(--color-fg-muted)" }}>追溯模式：</span>
              {focusedActor && (
                <Badge variant="accent" style={{ fontSize: 11 }}>
                  操作人 {focusedActor.name} · {focusedActor.email}
                </Badge>
              )}
              {!focusedActor && actorId && (
                <Badge variant="accent" style={{ fontSize: 11 }}>actor_id = <span className="mono">{actorId.slice(0, 8)}…</span></Badge>
              )}
              {targetType && <Badge variant="accent" style={{ fontSize: 11 }}>对象类型 {targetType}</Badge>}
              {targetId && <Badge variant="accent" style={{ fontSize: 11 }}>对象 ID <span className="mono">{targetId.length > 24 ? targetId.slice(0, 8) + "…" : targetId}</span></Badge>}
              {actionFilter && <Badge variant="accent" style={{ fontSize: 11 }}>动作 {actionFilter}</Badge>}
              {detailKey && (
                <Badge variant="accent" style={{ fontSize: 11 }}>
                  detail.{detailKey}{detailValue ? ` = ${detailValue}` : ""}
                </Badge>
              )}
            </div>
            <Button size="sm" variant="ghost" onClick={clearFocus}>
              <Icon name="x" size={11} />清除追溯
            </Button>
          </div>
        )}

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
                      {it.actor_id ? (
                        <button
                          type="button"
                          onClick={() => { setActorId(it.actor_id!); setPage(1); }}
                          title="按操作人追溯"
                          style={focusBtnStyle}
                        >
                          {it.actor_email}
                        </button>
                      ) : (
                        <span style={{ fontSize: 12.5 }}>{it.actor_email}</span>
                      )}
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
                  {it.target_type && it.target_id ? (
                    <button
                      type="button"
                      onClick={() => {
                        setTargetType(it.target_type!);
                        setTargetId(it.target_id!);
                        setPage(1);
                      }}
                      title={`按对象 ${it.target_type}/${it.target_id} 追溯`}
                      style={focusBtnStyle}
                    >
                      {it.target_type}
                      <span className="mono" style={{ marginLeft: 4, fontSize: 11, color: "var(--color-fg-subtle)" }}>
                        {it.target_id.length > 24 ? it.target_id.slice(0, 8) + "…" : it.target_id}
                      </span>
                    </button>
                  ) : it.target_type ? (
                    <span>{it.target_type}</span>
                  ) : (
                    "—"
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
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 4 }}>
              {detail.actor_id && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setActorId(detail.actor_id!);
                    setTargetType("");
                    setTargetId("");
                    setActionFilter("");
                    setPage(1);
                    setDetail(null);
                  }}
                >
                  <Icon name="activity" size={11} /> 该操作人完整时间线
                </Button>
              )}
              {detail.target_type && detail.target_id && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setTargetType(detail.target_type!);
                    setTargetId(detail.target_id!);
                    setActorId("");
                    setActionFilter("");
                    setPage(1);
                    setDetail(null);
                  }}
                >
                  <Icon name="activity" size={11} /> 该对象完整时间线
                </Button>
              )}
            </div>
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

const focusBtnStyle: React.CSSProperties = {
  background: "transparent",
  border: "none",
  padding: 0,
  margin: 0,
  cursor: "pointer",
  color: "var(--color-accent)",
  fontSize: 12.5,
  textAlign: "left",
  textDecoration: "none",
};
