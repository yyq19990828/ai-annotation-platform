import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useSearchParams } from "react-router-dom";
import { useVirtualizer } from "@tanstack/react-virtual";
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
import { useElementStyle } from "@/components/ui/useElementStyle";
import styles from "./AuditPage.module.css";

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

  // v0.6.6 · 按 request_id 分组：同一 HTTP 请求的 metadata 行 + 业务 detail 行折叠为单行 + ▸ 展开
  // v0.7.0：折叠状态 sessionStorage 持久化（30min TTL），刷新页面后自动恢复最近展开的 request_id。
  const [expandedReqIds, setExpandedReqIds] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set();
    try {
      const raw = sessionStorage.getItem("audit:expanded");
      if (!raw) return new Set();
      const parsed = JSON.parse(raw) as { ts: number; ids: string[] };
      if (Date.now() - parsed.ts > 30 * 60 * 1000) {
        sessionStorage.removeItem("audit:expanded");
        return new Set();
      }
      return new Set(parsed.ids);
    } catch {
      return new Set();
    }
  });

  useEffect(() => {
    try {
      sessionStorage.setItem(
        "audit:expanded",
        JSON.stringify({ ts: Date.now(), ids: Array.from(expandedReqIds) }),
      );
    } catch {
      // ignore quota
    }
  }, [expandedReqIds]);
  type Group = { id: string; leader: AuditLogResponse; children: AuditLogResponse[] };
  const groups: Group[] = useMemo(() => {
    const buckets = new Map<string, AuditLogResponse[]>();
    const ordered: string[] = [];
    items.forEach((it) => {
      const key = it.request_id || `__solo_${it.id}`;
      if (!buckets.has(key)) {
        buckets.set(key, []);
        ordered.push(key);
      }
      buckets.get(key)!.push(it);
    });
    return ordered.map((key) => {
      const rows = buckets.get(key)!;
      // 选 leader：优先非 http.* 的业务行；否则用 http.* 元数据行
      const business = rows.find((r) => !r.action.startsWith("http."));
      const leader = business ?? rows[0];
      const children = rows.filter((r) => r.id !== leader.id);
      return { id: key, leader, children };
    });
  }, [items]);

  // 平铺成 virtualizable rows：[group-leader, ...expanded-children]*
  type FlatRow =
    | { kind: "leader"; group: Group }
    | { kind: "child"; group: Group; row: AuditLogResponse };
  const flatRows: FlatRow[] = useMemo(() => {
    const out: FlatRow[] = [];
    groups.forEach((g) => {
      out.push({ kind: "leader", group: g });
      if (expandedReqIds.has(g.id)) {
        g.children.forEach((row) => out.push({ kind: "child", group: g, row }));
      }
    });
    return out;
  }, [groups, expandedReqIds]);

  const tableContainerRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: flatRows.length,
    getScrollElement: () => tableContainerRef.current,
    estimateSize: () => 44,
    overscan: 8,
  });

  const toggleGroup = (id: string) => {
    setExpandedReqIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>审计日志</h1>
          <p className={styles.description}>
            所有写操作（POST/PATCH/PUT/DELETE）由中间件捕获；关键业务事件携带结构化 detail。
          </p>
        </div>
        <div className={styles.actions}>
          <label className={styles.autoRefresh}>
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className={styles.checkbox}
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
        <div className={styles.filters}>
          <select value={scope} onChange={(e) => setScope(e.target.value as "business" | "all")} className={styles.control}>
            <option value="business">仅业务事件</option>
            <option value="all">全部（含 HTTP 元数据）</option>
          </select>
          <select value={actionFilter} onChange={(e) => { setActionFilter(e.target.value); setPage(1); }} className={styles.control}>
            <option value="">全部动作</option>
            {AUDIT_BUSINESS_ACTIONS.map((a) => (
              <option key={a} value={a}>{auditActionLabel(a)}</option>
            ))}
          </select>
          <select value={targetType} onChange={(e) => { setTargetType(e.target.value); setPage(1); }} className={styles.control}>
            <option value="">全部对象</option>
            {AUDIT_TARGET_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          <select value={actorId} onChange={(e) => { setActorId(e.target.value); setPage(1); }} className={`${styles.control} ${styles.actorControl}`}>
            <option value="">全部用户</option>
            {usersData.map((u) => (
              <option key={u.id} value={u.id}>{u.name} · {u.email}</option>
            ))}
          </select>
          <input
            value={targetId}
            placeholder="对象 ID（精确匹配）"
            onChange={(e) => { setTargetId(e.target.value); setPage(1); }}
            className={`${styles.control} ${styles.targetInput}`}
          />
          <input
            value={detailKey}
            placeholder="detail 键名（如 role）"
            title="A.3：detail_json 字段级 GIN 过滤——键名"
            onChange={(e) => { setDetailKey(e.target.value); setPage(1); }}
            className={`${styles.control} ${styles.detailKeyInput}`}
          />
          <input
            value={detailValue}
            placeholder="detail 键值（如 super_admin）"
            title="A.3：detail_json 字段级 GIN 过滤——键值（与键名共同生效）"
            onChange={(e) => { setDetailValue(e.target.value); setPage(1); }}
            disabled={!detailKey}
            className={`${styles.control} ${styles.detailValueInput} ${detailKey ? "" : styles.controlDisabled}`}
          />
          <span className={styles.totalText}>
            共 {total} 条 · 第 {page} / {pageCount} 页
          </span>
        </div>

        {focused && (
          <div className={styles.focusBar}>
            <div className={styles.focusTags}>
              <Icon name="target" size={13} className={styles.accentIcon} />
              <span className={styles.mutedText}>追溯模式：</span>
              {focusedActor && (
                <SmallBadge>操作人 {focusedActor.name} · {focusedActor.email}</SmallBadge>
              )}
              {!focusedActor && actorId && (
                <SmallBadge>actor_id = <span className="mono">{actorId.slice(0, 8)}…</span></SmallBadge>
              )}
              {targetType && <SmallBadge>对象类型 {targetType}</SmallBadge>}
              {targetId && <SmallBadge>对象 ID <span className="mono">{targetId.length > 24 ? targetId.slice(0, 8) + "…" : targetId}</span></SmallBadge>}
              {actionFilter && <SmallBadge>动作 {actionFilter}</SmallBadge>}
              {detailKey && (
                <SmallBadge>detail.{detailKey}{detailValue ? ` = ${detailValue}` : ""}</SmallBadge>
              )}
            </div>
            <Button size="sm" variant="ghost" onClick={clearFocus}>
              <Icon name="x" size={11} />清除追溯
            </Button>
          </div>
        )}

        {/* v0.6.6 · 按 request_id 折叠为单行 + ▸ 展开；virtualized 容器 */}
        <div className={styles.tableHeader}>
          {["", "时间", "操作人", "动作", "对象", "IP", "状态", ""].map((h, i) => (
            <div key={i} className={styles.headerCell}>{h}</div>
          ))}
        </div>

        <div
          ref={tableContainerRef}
          className={styles.tableViewport}
        >
          {(isLoading || isFetching) && flatRows.length === 0 && (
            <div className={styles.emptyState}>加载中...</div>
          )}
          {!isLoading && flatRows.length === 0 && (
            <div className={styles.emptyState}>暂无记录</div>
          )}
          <VirtualSizer height={virtualizer.getTotalSize()}>
            {virtualizer.getVirtualItems().map((virt) => {
              const row = flatRows[virt.index];
              const expanded = row.kind === "leader" && expandedReqIds.has(row.group.id);
              const it = row.kind === "leader" ? row.group.leader : row.row;
              const isLeader = row.kind === "leader";
              const hasChildren = isLeader && row.group.children.length > 0;
              return (
                <VirtualAuditRow
                  key={virt.key}
                  index={virt.index}
                  start={virt.start}
                  isChild={row.kind === "child"}
                  measureElement={virtualizer.measureElement}
                >
                  <div className={styles.expandCell}>
                    {hasChildren ? (
                      <button
                        type="button"
                        onClick={() => toggleGroup(row.group.id)}
                        title={expanded ? "折叠" : `展开同请求 ${row.group.children.length + 1} 条`}
                        className={styles.focusButton}
                      >
                        <Icon name={expanded ? "chevDown" : "chevRight"} size={12} />
                        <span className={styles.childCount}>{row.group.children.length + 1}</span>
                      </button>
                    ) : null}
                  </div>
                  <div className={styles.timeCell}>
                    {new Date(it.created_at).toLocaleString("zh-CN", { hour12: false })}
                  </div>
                  <div className={styles.cell}>
                    {it.actor_email ? (
                      <div className={styles.actorWrap}>
                        {it.actor_id ? (
                          <button
                            type="button"
                            onClick={() => { setActorId(it.actor_id!); setPage(1); }}
                            title="按操作人追溯"
                            className={styles.focusButton}
                          >
                            {it.actor_email}
                          </button>
                        ) : (
                          <span className={styles.actorEmail}>{it.actor_email}</span>
                        )}
                        {it.actor_role && (
                          <span className={styles.tinyBadge}>
                          <Badge variant="outline">
                            {ROLE_LABELS[it.actor_role as UserRole] ?? it.actor_role}
                          </Badge>
                          </span>
                        )}
                      </div>
                    ) : (
                      <span className={styles.anonymous}>匿名</span>
                    )}
                  </div>
                  <div className={styles.cell}>
                    <SmallBadge variant={it.action.startsWith("http.") ? "outline" : "accent"}>
                      {auditActionLabel(it.action)}
                    </SmallBadge>
                  </div>
                  <div className={styles.targetCell}>
                    {it.target_type && it.target_id ? (
                      <button
                        type="button"
                        onClick={() => {
                          setTargetType(it.target_type!);
                          setTargetId(it.target_id!);
                          setPage(1);
                        }}
                        title={`按对象 ${it.target_type}/${it.target_id} 追溯`}
                        className={styles.focusButton}
                      >
                        {it.target_type}
                        <span className={`mono ${styles.targetId}`}>
                          {it.target_id.length > 24 ? it.target_id.slice(0, 8) + "…" : it.target_id}
                        </span>
                      </button>
                    ) : it.target_type ? (
                      <span>{it.target_type}</span>
                    ) : (
                      "—"
                    )}
                  </div>
                  <div className={styles.ipCell}>
                    {it.ip ?? "—"}
                  </div>
                  <div className={styles.cell}>{statusBadge(it.status_code)}</div>
                  <div className={styles.detailCell}>
                    <Button size="sm" variant="ghost" onClick={() => setDetail(it)}>详情</Button>
                  </div>
                </VirtualAuditRow>
              );
            })}
          </VirtualSizer>
        </div>

        <div className={styles.pagination}>
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
          <div className={styles.detailStack}>
            <div className={styles.detailActions}>
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
              <div className={styles.detailJsonLabel}>detail_json</div>
              <pre className={styles.detailJson}>
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
  if (code === null) return <span className={styles.subtleText}>—</span>;
  if (code >= 500) return <SmallBadge variant="danger">{code}</SmallBadge>;
  if (code >= 400) return <SmallBadge variant="warning">{code}</SmallBadge>;
  if (code >= 200) return <SmallBadge variant="success">{code}</SmallBadge>;
  return <SmallBadge variant="outline">{code}</SmallBadge>;
}

function KV({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className={styles.kvRow}>
      <div className={styles.kvLabel}>{label}</div>
      <div className={mono ? `mono ${styles.kvValue}` : styles.kvValue}>{value}</div>
    </div>
  );
}

function SmallBadge({
  children,
  variant = "accent",
}: {
  children: ReactNode;
  variant?: ComponentProps<typeof Badge>["variant"];
}) {
  return <Badge variant={variant} className={styles.smallBadge}>{children}</Badge>;
}

function VirtualSizer({ height, children }: { height: number; children: ReactNode }) {
  const styleRef = useElementStyle<HTMLDivElement>(useMemo<CSSProperties>(() => ({ height }), [height]));
  return (
    <div ref={styleRef} className={styles.virtualSizer}>
      {children}
    </div>
  );
}

function VirtualAuditRow({
  index,
  start,
  isChild,
  measureElement,
  children,
}: {
  index: number;
  start: number;
  isChild: boolean;
  measureElement: (element: Element | null) => void;
  children: ReactNode;
}) {
  const rowStyle = useMemo<CSSProperties>(
    () => ({ "--audit-row-y": `${start}px` }) as CSSProperties,
    [start],
  );
  const styleRef = useElementStyle<HTMLDivElement>(rowStyle);
  const setRowRef = useCallback(
    (node: HTMLDivElement | null) => {
      styleRef(node);
      measureElement(node);
    },
    [measureElement, styleRef],
  );

  return (
    <div
      ref={setRowRef}
      data-index={index}
      className={isChild ? `${styles.auditRow} ${styles.auditRowChild}` : styles.auditRow}
    >
      {children}
    </div>
  );
}
