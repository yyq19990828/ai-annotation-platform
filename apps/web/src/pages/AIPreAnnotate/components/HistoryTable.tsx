/**
 * v0.9.7 · pre_annotated 批次历史表 (含 client-side 搜索 / 排序 / 分页).
 * v0.9.12 · BUG B-16 加 checkbox 多选 + 底部浮窗 + 批量重激活/删除 prediction.
 */

import { Fragment, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Icon } from "@/components/ui/Icon";
import { Modal } from "@/components/ui/Modal";
import type { PreannotateQueueItem, BulkClearMode, BulkClearResponse } from "@/api/adminPreannotate";
import { useBulkPreannotateClear } from "@/hooks/useBulkPreannotateActions";
import {
  cardBodyStyle,
  cardHeaderStyle,
  helperTextStyle,
  tableHeaderCellStyle,
  tableBodyCellStyle,
  HISTORY_PAGE_SIZE,
  FS_XS,
  FS_SM,
} from "../styles";

type SortKey = "last_run_at" | "total_tasks" | "prediction_count" | "failed_count";
type SortDir = "asc" | "desc";

interface Props {
  items: PreannotateQueueItem[];
  isLoading: boolean;
}

export function HistoryTable({ items, isLoading }: Props) {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("last_run_at");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [page, setPage] = useState(0);
  // v0.9.12 B-16 · 多选 state (按 batch_id 索引, 跨折叠/分页保留)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmMode, setConfirmMode] = useState<BulkClearMode | null>(null);
  const [reasonInput, setReasonInput] = useState("");
  const [bulkResult, setBulkResult] = useState<BulkClearResponse | null>(null);
  const bulkClear = useBulkPreannotateClear();

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return items;
    return items.filter(
      (it) =>
        it.batch_name.toLowerCase().includes(s) ||
        it.project_name.toLowerCase().includes(s) ||
        (it.project_display_id ?? "").toLowerCase().includes(s),
    );
  }, [items, search]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a, b) => {
      const av = sortValue(a, sortKey);
      const bv = sortValue(b, sortKey);
      if (av === bv) return 0;
      const cmp = av < bv ? -1 : 1;
      return sortDir === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [filtered, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / HISTORY_PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pageStart = safePage * HISTORY_PAGE_SIZE;
  const pageItems = sorted.slice(pageStart, pageStart + HISTORY_PAGE_SIZE);

  // B-2 · 项目→batch 分组,折叠展开;按当前页 pageItems 聚合
  const grouped = useMemo(() => {
    const m = new Map<string, { name: string; displayId: string | null; batches: PreannotateQueueItem[] }>();
    for (const it of pageItems) {
      const k = it.project_id;
      const cur = m.get(k);
      if (cur) cur.batches.push(it);
      else m.set(k, { name: it.project_name, displayId: it.project_display_id ?? null, batches: [it] });
    }
    return Array.from(m.entries()).map(([id, g]) => ({ id, ...g }));
  }, [pageItems]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggleProject = (pid: string) => {
    setCollapsed((s) => {
      const n = new Set(s);
      if (n.has(pid)) n.delete(pid);
      else n.add(pid);
      return n;
    });
  };

  const onSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const sortIndicator = (key: SortKey) => {
    if (sortKey !== key) return null;
    return (
      <span style={{ marginLeft: 4, color: "var(--color-ai)" }}>
        {sortDir === "asc" ? "↑" : "↓"}
      </span>
    );
  };

  const toggleOne = (bid: string) => {
    setSelectedIds((s) => {
      const n = new Set(s);
      if (n.has(bid)) n.delete(bid);
      else n.add(bid);
      return n;
    });
  };

  const pageBatchIds = pageItems.map((it) => it.batch_id);
  const allOnPageSelected =
    pageBatchIds.length > 0 && pageBatchIds.every((id) => selectedIds.has(id));
  const togglePageAll = () => {
    setSelectedIds((s) => {
      const n = new Set(s);
      if (allOnPageSelected) {
        for (const id of pageBatchIds) n.delete(id);
      } else {
        for (const id of pageBatchIds) n.add(id);
      }
      return n;
    });
  };

  const clearSelection = () => setSelectedIds(new Set());

  const openConfirm = (mode: BulkClearMode) => {
    setConfirmMode(mode);
    setReasonInput("");
    setBulkResult(null);
  };

  const closeConfirm = () => {
    setConfirmMode(null);
    setReasonInput("");
  };

  const submitBulk = async () => {
    if (!confirmMode) return;
    const trimmed = reasonInput.trim();
    if (trimmed.length < 10) return;
    const res = await bulkClear.mutateAsync({
      batch_ids: Array.from(selectedIds),
      mode: confirmMode,
      reason: trimmed,
    });
    setBulkResult(res);
    if (res.failed.length === 0 && res.skipped.length === 0) {
      // 全成功 → 直接关闭 + 清选中
      setConfirmMode(null);
      setReasonInput("");
      clearSelection();
    } else {
      // 部分失败 → 保留 modal 展示结果, 但移除已成功项
      setSelectedIds((s) => {
        const n = new Set(s);
        for (const id of res.succeeded) n.delete(id);
        return n;
      });
    }
  };

  return (
    <Card>
      <div style={cardHeaderStyle}>
        <span>AI 预标已就绪批次（{filtered.length}）</span>
        <input
          type="text"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(0);
          }}
          placeholder="搜索批次/项目..."
          style={{
            padding: "4px 10px",
            fontSize: FS_XS,
            background: "var(--color-bg-sunken)",
            border: "1px solid var(--color-border)",
            borderRadius: "var(--radius-sm)",
            color: "var(--color-fg)",
            outline: "none",
            width: 200,
          }}
        />
      </div>
      <div style={cardBodyStyle}>
        {isLoading ? (
          <div style={{ ...helperTextStyle, padding: 16, textAlign: "center" }}>加载中…</div>
        ) : items.length === 0 ? (
          <EmptyState />
        ) : sorted.length === 0 ? (
          <div style={{ ...helperTextStyle, padding: 16, textAlign: "center" }}>
            无匹配批次（搜索：{search}）
          </div>
        ) : (
          <>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", fontSize: FS_SM, borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ background: "var(--color-bg-sunken)" }}>
                    <th style={{ ...tableHeaderCellStyle, cursor: "default", width: 32 }}>
                      <input
                        type="checkbox"
                        aria-label="全选当前页"
                        checked={allOnPageSelected}
                        onChange={togglePageAll}
                      />
                    </th>
                    <th style={{ ...tableHeaderCellStyle, cursor: "default" }}>项目</th>
                    <th style={{ ...tableHeaderCellStyle, cursor: "default" }}>批次</th>
                    <th style={tableHeaderCellStyle} onClick={() => onSort("total_tasks")}>
                      总数{sortIndicator("total_tasks")}
                    </th>
                    <th style={tableHeaderCellStyle} onClick={() => onSort("prediction_count")}>
                      已预标{sortIndicator("prediction_count")}
                    </th>
                    <th style={tableHeaderCellStyle} onClick={() => onSort("failed_count")}>
                      失败{sortIndicator("failed_count")}
                    </th>
                    <th style={tableHeaderCellStyle} onClick={() => onSort("last_run_at")}>
                      最近预标{sortIndicator("last_run_at")}
                    </th>
                    <th style={{ ...tableHeaderCellStyle, cursor: "default" }}>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {grouped.map((g) => {
                    const isCollapsed = collapsed.has(g.id);
                    const totalBatches = g.batches.length;
                    const totalFailed = g.batches.reduce((s, b) => s + b.failed_count, 0);
                    const totalTasks = g.batches.reduce((s, b) => s + b.total_tasks, 0);
                    return (
                      <Fragment key={g.id}>
                        <tr
                          onClick={() => toggleProject(g.id)}
                          style={{
                            cursor: "pointer",
                            background: "var(--color-bg-elev)",
                            borderTop: "1px solid var(--color-border)",
                          }}
                        >
                          <td colSpan={8} style={{ padding: "8px 12px", fontSize: FS_SM }}>
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                              <Icon name={isCollapsed ? "chevRight" : "chevDown"} size={11} />
                              <strong>{g.name}</strong>
                              {g.displayId && (
                                <span style={{ color: "var(--color-fg-subtle)" }}>({g.displayId})</span>
                              )}
                              <span style={{ color: "var(--color-fg-muted)" }}>
                                · {totalBatches} 批 · {totalTasks} 任务
                                {totalFailed > 0 && (
                                  <span style={{ color: "var(--color-danger)", marginLeft: 6 }}>
                                    · {totalFailed} 失败
                                  </span>
                                )}
                              </span>
                            </span>
                          </td>
                        </tr>
                        {!isCollapsed &&
                          g.batches.map((it) => {
                            const isSel = selectedIds.has(it.batch_id);
                            return (
                              <tr
                                key={it.batch_id}
                                style={
                                  isSel
                                    ? { background: "color-mix(in oklch, var(--color-accent) 8%, transparent)" }
                                    : undefined
                                }
                              >
                                <td style={tableBodyCellStyle}>
                                  <input
                                    type="checkbox"
                                    aria-label={`选择 ${it.batch_name}`}
                                    checked={isSel}
                                    onChange={() => toggleOne(it.batch_id)}
                                  />
                                </td>
                                <td style={{ ...tableBodyCellStyle, paddingLeft: 28, color: "var(--color-fg-subtle)" }}>↳</td>
                                <td style={tableBodyCellStyle}>{it.batch_name}</td>
                                <td style={{ ...tableBodyCellStyle, fontVariantNumeric: "tabular-nums" }}>{it.total_tasks}</td>
                                <td style={tableBodyCellStyle}>
                                  <Badge variant="ai">{it.prediction_count}</Badge>
                                </td>
                                <td style={tableBodyCellStyle}>
                                  {it.failed_count > 0 ? (
                                    <Badge variant="danger">{it.failed_count}</Badge>
                                  ) : (
                                    <span style={{ color: "var(--color-fg-subtle)" }}>0</span>
                                  )}
                                </td>
                                <td style={{ ...tableBodyCellStyle, color: "var(--color-fg-muted)" }}>
                                  {formatRelative(it.last_run_at)}
                                </td>
                                <td style={tableBodyCellStyle}>
                                  <div style={{ display: "inline-flex", gap: 6 }}>
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      onClick={() =>
                                        navigate(
                                          `/projects/${it.project_id}/annotate?batch=${it.batch_id}`,
                                        )
                                      }
                                      title="打开工作台接管 review"
                                    >
                                      <Icon name="chevRight" size={11} />
                                    </Button>
                                    {it.can_retry && (
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        onClick={() =>
                                          navigate(
                                            `/ai-pre?failed=1&batch_id=${it.batch_id}`,
                                          )
                                        }
                                        title="到下方失败 prediction 列表重试"
                                      >
                                        <Icon name="refresh" size={11} />
                                      </Button>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {totalPages > 1 && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  paddingTop: 6,
                }}
              >
                <span style={{ ...helperTextStyle, marginTop: 0 }}>
                  共 {sorted.length} 条 · 第 {safePage + 1}/{totalPages} 页
                </span>
                <div style={{ display: "inline-flex", gap: 6 }}>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={safePage === 0}
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                  >
                    <Icon name="chevLeft" size={11} /> 上一页
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={safePage >= totalPages - 1}
                    onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                  >
                    下一页 <Icon name="chevRight" size={11} />
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {selectedIds.size > 0 && (
        <BulkActionBar
          count={selectedIds.size}
          onClear={clearSelection}
          onReactivate={() => openConfirm("predictions_only")}
          onReset={() => openConfirm("reset_to_draft")}
        />
      )}

      <Modal
        open={confirmMode !== null}
        onClose={() => {
          if (!bulkClear.isPending) closeConfirm();
        }}
        title={
          confirmMode === "reset_to_draft"
            ? "批量重置 batch 到 draft"
            : "批量删除 prediction (重激活)"
        }
        width={520}
      >
        {bulkResult ? (
          <BulkResultView result={bulkResult} onClose={closeConfirm} />
        ) : (
          <BulkConfirmForm
            mode={confirmMode}
            count={selectedIds.size}
            reason={reasonInput}
            onReasonChange={setReasonInput}
            onCancel={closeConfirm}
            onSubmit={submitBulk}
            isPending={bulkClear.isPending}
            error={bulkClear.error instanceof Error ? bulkClear.error.message : null}
          />
        )}
      </Modal>
    </Card>
  );
}

function BulkActionBar(props: {
  count: number;
  onClear: () => void;
  onReactivate: () => void;
  onReset: () => void;
}) {
  return (
    <div
      style={{
        position: "sticky",
        bottom: 0,
        marginTop: 12,
        padding: "10px 14px",
        background: "var(--color-bg-elev)",
        border: "1px solid var(--color-border)",
        borderRadius: "var(--radius-md)",
        boxShadow: "var(--shadow-md)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
      }}
    >
      <div style={{ display: "inline-flex", alignItems: "center", gap: 10, fontSize: FS_SM }}>
        <strong>已选 {props.count} 项</strong>
        <Button size="sm" variant="ghost" onClick={props.onClear}>
          清除
        </Button>
      </div>
      <div style={{ display: "inline-flex", gap: 8 }}>
        <Button size="sm" variant="ghost" onClick={props.onReactivate} title="清空 prediction, batch 回 active">
          <Icon name="refresh" size={11} /> 批量重激活
        </Button>
        <Button size="sm" variant="danger" onClick={props.onReset} title="重置 batch 到 draft + 清空 task / prediction / lock">
          <Icon name="trash" size={11} /> 批量重置 draft
        </Button>
      </div>
    </div>
  );
}

function BulkConfirmForm(props: {
  mode: BulkClearMode | null;
  count: number;
  reason: string;
  onReasonChange: (v: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
  isPending: boolean;
  error: string | null;
}) {
  const isDestructive = props.mode === "reset_to_draft";
  const tooShort = props.reason.trim().length < 10;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, fontSize: FS_SM }}>
      <p style={{ margin: 0, color: "var(--color-fg-muted)" }}>
        将对 <strong>{props.count}</strong> 个批次执行
        {isDestructive ? (
          <strong style={{ color: "var(--color-danger)" }}> reset_to_draft</strong>
        ) : (
          <strong style={{ color: "var(--color-ai)" }}> 清空 prediction</strong>
        )}
        操作：
      </p>
      <ul style={{ margin: 0, paddingLeft: 18, color: "var(--color-fg-muted)" }}>
        {isDestructive ? (
          <>
            <li>所有 task 回 pending（保留 annotation 记录）</li>
            <li>清 task_locks / prediction / failed_prediction / prediction_job</li>
            <li>batch.status → draft</li>
          </>
        ) : (
          <>
            <li>清 prediction / failed_prediction / prediction_job</li>
            <li>batch.status: pre_annotated → active（其他状态不变）</li>
            <li>task / annotation / lock 保留</li>
          </>
        )}
      </ul>
      <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span style={{ fontSize: FS_XS, color: "var(--color-fg-muted)" }}>
          原因（≥10 字，写入 audit log）
        </span>
        <textarea
          value={props.reason}
          onChange={(e) => props.onReasonChange(e.target.value)}
          rows={3}
          placeholder="例：批次配置错误，需要重新跑一次预标"
          style={{
            padding: "8px 10px",
            fontSize: FS_SM,
            background: "var(--color-bg-sunken)",
            border: "1px solid var(--color-border)",
            borderRadius: "var(--radius-sm)",
            color: "var(--color-fg)",
            fontFamily: "inherit",
            resize: "vertical",
          }}
        />
      </label>
      {props.error && (
        <div style={{ color: "var(--color-danger)", fontSize: FS_XS }}>{props.error}</div>
      )}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <Button size="sm" variant="ghost" onClick={props.onCancel} disabled={props.isPending}>
          取消
        </Button>
        <Button
          size="sm"
          variant={isDestructive ? "danger" : "primary"}
          onClick={props.onSubmit}
          disabled={tooShort || props.isPending}
        >
          {props.isPending ? "执行中..." : "确认"}
        </Button>
      </div>
    </div>
  );
}

function BulkResultView(props: { result: BulkClearResponse; onClose: () => void }) {
  const { succeeded, skipped, failed } = props.result;
  return (
    <div data-testid="bulk-result" style={{ display: "flex", flexDirection: "column", gap: 10, fontSize: FS_SM }}>
      <div>
        <strong>{succeeded.length}</strong> 成功 ·{" "}
        <span style={{ color: "var(--color-warning)" }}>{skipped.length} 跳过</span> ·{" "}
        <span style={{ color: "var(--color-danger)" }}>{failed.length} 失败</span>
      </div>
      {skipped.length > 0 && (
        <details>
          <summary style={{ cursor: "pointer", color: "var(--color-fg-muted)" }}>
            跳过详情 ({skipped.length})
          </summary>
          <ul style={{ margin: "4px 0 0", paddingLeft: 18, color: "var(--color-fg-muted)", fontSize: FS_XS }}>
            {skipped.map((it) => (
              <li key={it.batch_id}>
                <code>{it.batch_id.slice(0, 8)}</code> — {it.reason}
              </li>
            ))}
          </ul>
        </details>
      )}
      {failed.length > 0 && (
        <details open>
          <summary style={{ cursor: "pointer", color: "var(--color-danger)" }}>
            失败详情 ({failed.length})
          </summary>
          <ul style={{ margin: "4px 0 0", paddingLeft: 18, color: "var(--color-danger)", fontSize: FS_XS }}>
            {failed.map((it) => (
              <li key={it.batch_id}>
                <code>{it.batch_id.slice(0, 8)}</code> — {it.reason}
              </li>
            ))}
          </ul>
        </details>
      )}
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <Button size="sm" variant="ghost" onClick={props.onClose}>
          关闭
        </Button>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
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
      <Icon name="sparkles" size={28} />
      <div style={{ fontSize: FS_SM, color: "var(--color-fg-muted)" }}>
        暂无 AI 预标已就绪的批次
      </div>
      <div style={{ fontSize: FS_XS }}>在上方跑一次预标，结果会出现在这里。</div>
    </div>
  );
}

function sortValue(it: PreannotateQueueItem, key: SortKey): number | string {
  switch (key) {
    case "total_tasks":
      return it.total_tasks;
    case "prediction_count":
      return it.prediction_count;
    case "failed_count":
      return it.failed_count;
    case "last_run_at":
      return it.last_run_at ? Date.parse(it.last_run_at) : 0;
  }
}

function formatRelative(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const diffMs = Date.now() - d.getTime();
  const sec = Math.round(diffMs / 1000);
  if (sec < 60) return `${sec} 秒前`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} 分钟前`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} 小时前`;
  const day = Math.round(hr / 24);
  if (day < 30) return `${day} 天前`;
  return d.toLocaleDateString("zh-CN");
}
