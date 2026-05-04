import { useMemo, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Badge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { AssigneeAvatarStack } from "@/components/ui/AssigneeAvatarStack";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { useToastStore } from "@/components/ui/Toast";
import {
  useBatches,
  useCreateBatch,
  useDeleteBatch,
  useTransitionBatch,
  useSplitBatches,
  useBulkArchiveBatches,
  useBulkDeleteBatches,
  useBulkReassignBatches,
  useBulkActivateBatches,
  useUnclassifiedTaskCount,
} from "@/hooks/useBatches";
import { useIsProjectOwner } from "@/hooks/useIsProjectOwner";
import { BatchAssignmentModal } from "@/components/projects/BatchAssignmentModal";
import { ProjectDistributeBatchesModal } from "@/components/projects/ProjectDistributeBatchesModal";
import { RejectBatchModal } from "./RejectBatchModal";
import { BulkReassignModal } from "./BulkReassignModal";
import { ReverseTransitionModal, type ReverseKind } from "./ReverseTransitionModal";
import { BatchAuditLogDrawer } from "./BatchAuditLogDrawer";
import type { ProjectResponse } from "@/api/projects";
import type { BatchResponse, BulkBatchActionResponse } from "@/api/batches";

const STATUS_LABELS: Record<string, string> = {
  draft: "草稿",
  active: "激活",
  annotating: "标注中",
  reviewing: "审核中",
  approved: "已通过",
  rejected: "已退回",
  archived: "已归档",
};

const STATUS_VARIANTS: Record<string, "default" | "accent" | "success" | "warning" | "danger"> = {
  draft: "default",
  active: "accent",
  annotating: "accent",
  reviewing: "warning",
  approved: "success",
  rejected: "danger",
  archived: "default",
};

type CreateMode = "single" | "split";

type BulkActionKind = "archive" | "delete" | "reassign" | "activate";

const BULK_LABEL: Record<BulkActionKind, string> = {
  archive: "归档",
  delete: "删除",
  reassign: "改派",
  activate: "激活",
};

export function BatchesSection({ project }: { project: ProjectResponse }) {
  const pushToast = useToastStore((s) => s.push);
  const { data: batches = [], isLoading } = useBatches(project.id);
  const createBatch = useCreateBatch(project.id);
  const deleteBatch = useDeleteBatch(project.id);
  const transitionBatch = useTransitionBatch(project.id);
  const splitBatches = useSplitBatches(project.id);
  const bulkArchive = useBulkArchiveBatches(project.id);
  const bulkDelete = useBulkDeleteBatches(project.id);
  const bulkReassign = useBulkReassignBatches(project.id);
  const bulkActivate = useBulkActivateBatches(project.id);
  const isOwner = useIsProjectOwner(project);
  const { data: unclassified } = useUnclassifiedTaskCount(project.id);
  const unclassifiedCount = unclassified?.count ?? 0;

  const [showCreate, setShowCreate] = useState(false);
  const [createMode, setCreateMode] = useState<CreateMode>("single");
  const [name, setName] = useState("");
  const [priority, setPriority] = useState(50);
  const [nBatches, setNBatches] = useState(3);
  const [namePrefix, setNamePrefix] = useState("Batch");
  const [confirmDelete, setConfirmDelete] = useState<BatchResponse | null>(null);
  const [assignTarget, setAssignTarget] = useState<BatchResponse | null>(null);
  const [rejectTarget, setRejectTarget] = useState<BatchResponse | null>(null);
  const [distributeOpen, setDistributeOpen] = useState(false);

  // v0.7.3 · 多选批量操作
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmBulk, setConfirmBulk] = useState<BulkActionKind | null>(null);
  const [reassignOpen, setReassignOpen] = useState(false);
  const [bulkResult, setBulkResult] = useState<{ kind: BulkActionKind; data: BulkBatchActionResponse } | null>(null);
  const [resultExpanded, setResultExpanded] = useState(false);

  // v0.7.3 · 逆向迁移 + 操作历史
  const [reverseTarget, setReverseTarget] = useState<{ batch: BatchResponse; kind: ReverseKind } | null>(null);
  const [auditTarget, setAuditTarget] = useState<BatchResponse | null>(null);

  const selectableBatches = useMemo(
    () => batches.filter((b) => b.display_id !== "B-DEFAULT"),
    [batches],
  );
  const selectedCount = selectedIds.size;
  const allSelected = selectableBatches.length > 0 && selectableBatches.every((b) => selectedIds.has(b.id));

  const toggleOne = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    setSelectedIds(allSelected ? new Set() : new Set(selectableBatches.map((b) => b.id)));
  };

  const clearSelection = () => setSelectedIds(new Set());

  const handleBulkResult = (kind: BulkActionKind, data: BulkBatchActionResponse) => {
    setBulkResult({ kind, data });
    setResultExpanded(false);
    clearSelection();
    const sN = data.succeeded.length;
    const skN = data.skipped.length;
    const fN = data.failed.length;
    if (fN === 0 && skN === 0) {
      pushToast({ msg: `批量${BULK_LABEL[kind]}成功 ${sN} 个`, kind: "success" });
    } else {
      pushToast({
        msg: `批量${BULK_LABEL[kind]}：成功 ${sN} / 跳过 ${skN} / 失败 ${fN}`,
        kind: fN > 0 ? "warning" : "success",
      });
    }
  };

  const runBulkArchive = () => {
    bulkArchive.mutate([...selectedIds], {
      onSuccess: (data) => {
        handleBulkResult("archive", data);
        setConfirmBulk(null);
      },
      onError: (e) => pushToast({ msg: "批量归档失败", sub: (e as Error).message }),
    });
  };

  const runBulkDelete = () => {
    bulkDelete.mutate([...selectedIds], {
      onSuccess: (data) => {
        handleBulkResult("delete", data);
        setConfirmBulk(null);
      },
      onError: (e) => pushToast({ msg: "批量删除失败", sub: (e as Error).message }),
    });
  };

  const runBulkActivate = () => {
    bulkActivate.mutate([...selectedIds], {
      onSuccess: (data) => {
        handleBulkResult("activate", data);
        setConfirmBulk(null);
      },
      onError: (e) => pushToast({ msg: "批量激活失败", sub: (e as Error).message }),
    });
  };

  const runBulkReassign = async (payload: { annotator_id?: string | null; reviewer_id?: string | null }) => {
    return new Promise<void>((resolve) => {
      bulkReassign.mutate(
        { batch_ids: [...selectedIds], ...payload },
        {
          onSuccess: (data) => {
            handleBulkResult("reassign", data);
            setReassignOpen(false);
            resolve();
          },
          onError: (e) => {
            pushToast({ msg: "批量改派失败", sub: (e as Error).message });
            resolve();
          },
        },
      );
    });
  };

  const idToBatch = useMemo(() => {
    const m = new Map<string, BatchResponse>();
    for (const b of batches) m.set(b.id, b);
    return m;
  }, [batches]);

  const renderBulkResultRow = (item: { batch_id: string; reason: string }) => {
    const b = idToBatch.get(item.batch_id);
    return (
      <li key={item.batch_id} style={{ fontSize: 12, color: "var(--color-fg-muted)" }}>
        <span className="mono">{b?.display_id ?? item.batch_id.slice(0, 8)}</span>
        {b ? <span style={{ marginLeft: 6 }}>· {b.name}</span> : null}
        <span style={{ marginLeft: 6, color: "var(--color-fg-subtle)" }}>— {item.reason}</span>
      </li>
    );
  };

  const handleCreate = () => {
    if (createMode === "single") {
      createBatch.mutate(
        { name, priority },
        {
          onSuccess: () => {
            pushToast({ msg: "批次已创建", kind: "success" });
            setShowCreate(false);
            setName("");
          },
          onError: (e) => pushToast({ msg: "创建失败", sub: (e as Error).message }),
        },
      );
    } else {
      splitBatches.mutate(
        { strategy: "random", n_batches: nBatches, name_prefix: namePrefix, priority },
        {
          onSuccess: (res) => {
            pushToast({ msg: `已创建 ${res.length} 个批次`, kind: "success" });
            setShowCreate(false);
          },
          onError: (e) => pushToast({ msg: "切分失败", sub: (e as Error).message }),
        },
      );
    }
  };

  const handleTransition = (batch: BatchResponse, target: string) => {
    transitionBatch.mutate(
      { batchId: batch.id, targetStatus: target },
      {
        onSuccess: () => pushToast({ msg: `批次状态已更新为 ${STATUS_LABELS[target]}`, kind: "success" }),
        onError: (e) => pushToast({ msg: "状态转移失败", sub: (e as Error).message }),
      },
    );
  };

  const handleDelete = (batch: BatchResponse) => {
    deleteBatch.mutate(batch.id, {
      onSuccess: () => {
        pushToast({ msg: "批次已删除", kind: "success" });
        setConfirmDelete(null);
      },
      onError: (e) => pushToast({ msg: "删除失败", sub: (e as Error).message }),
    });
  };

  return (
    <>
      <Card>
        <div
          style={{
            padding: "14px 16px",
            borderBottom: "1px solid var(--color-border)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>批次管理</h3>
          <div style={{ display: "flex", gap: 8 }}>
            <Button
              onClick={() => setDistributeOpen(true)}
              disabled={batches.length === 0}
              title="把项目下所有批次圆周分派给所选成员（一 batch 一标注员 + 一审核员）"
            >
              <Icon name="users" size={12} />按项目分派批次
            </Button>
            <Button onClick={() => setShowCreate(true)}>
              <Icon name="plus" size={12} />创建批次
            </Button>
          </div>
        </div>

        {isLoading && (
          <div style={{ padding: 32, textAlign: "center", color: "var(--color-fg-subtle)", fontSize: 13 }}>
            加载中...
          </div>
        )}

        {!isLoading && batches.length === 0 && (
          <div style={{ padding: 32, textAlign: "center", color: "var(--color-fg-subtle)", fontSize: 13 }}>
            暂无批次
          </div>
        )}

        {/* v0.7.3 · 未归类任务横带（关联数据集后但还没切分到 batch 的 task） */}
        {unclassifiedCount > 0 && (
          <div
            style={{
              padding: "8px 16px",
              background: "color-mix(in oklab, var(--color-warning) 8%, transparent)",
              borderBottom: "1px solid var(--color-border)",
              display: "flex",
              alignItems: "center",
              gap: 12,
              fontSize: 13,
            }}
          >
            <Icon name="info" size={14} />
            <span>
              本项目有 <strong>{unclassifiedCount}</strong> 个 <strong>未归类任务</strong>（数据集已关联但尚未划分到批次）。
            </span>
            {isOwner && (
              <Button
                onClick={() => {
                  setCreateMode("split");
                  setShowCreate(true);
                }}
                style={{ marginLeft: "auto" }}
                title="按随机切分把未归类任务拆成 N 个批次"
              >
                <Icon name="layers" size={12} /> 去分包
              </Button>
            )}
          </div>
        )}

        {/* v0.7.3 · 多选浮层操作条（仅 owner 可见） */}
        {isOwner && selectedCount > 0 && (
          <div
            style={{
              padding: "8px 16px",
              background: "var(--color-accent-soft)",
              borderBottom: "1px solid var(--color-border)",
              display: "flex",
              alignItems: "center",
              gap: 12,
              fontSize: 13,
            }}
          >
            <span>已选 <strong>{selectedCount}</strong> 个批次</span>
            <div style={{ display: "flex", gap: 6, marginLeft: "auto" }}>
              <Button onClick={() => setConfirmBulk("activate")} title="对选中的 draft 批次批量激活">
                <Icon name="play" size={12} /> 激活
              </Button>
              <Button onClick={() => setReassignOpen(true)} title="批量改派 annotator / reviewer">
                <Icon name="users" size={12} /> 改派
              </Button>
              <Button onClick={() => setConfirmBulk("archive")} title="批量归档">
                <Icon name="inbox" size={12} /> 归档
              </Button>
              <Button
                onClick={() => setConfirmBulk("delete")}
                style={{ background: "var(--color-danger)", color: "#fff" }}
                title="批量删除"
              >
                <Icon name="trash" size={12} /> 删除
              </Button>
              <Button onClick={clearSelection} title="取消选择">
                取消
              </Button>
            </div>
          </div>
        )}

        {/* v0.7.3 · 上次批量操作结果（partial-success） */}
        {bulkResult && (
          <div
            style={{
              padding: "8px 16px",
              background: "var(--color-bg-sunken)",
              borderBottom: "1px solid var(--color-border)",
              fontSize: 12,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span>
                上次批量{BULK_LABEL[bulkResult.kind]}：
                <strong style={{ color: "var(--color-success)" }}> 成功 {bulkResult.data.succeeded.length}</strong>
                {bulkResult.data.skipped.length > 0 && (
                  <strong style={{ color: "var(--color-warning)", marginLeft: 8 }}>
                    跳过 {bulkResult.data.skipped.length}
                  </strong>
                )}
                {bulkResult.data.failed.length > 0 && (
                  <strong style={{ color: "var(--color-danger)", marginLeft: 8 }}>
                    失败 {bulkResult.data.failed.length}
                  </strong>
                )}
              </span>
              {(bulkResult.data.skipped.length > 0 || bulkResult.data.failed.length > 0) && (
                <button
                  type="button"
                  onClick={() => setResultExpanded((v) => !v)}
                  style={{
                    background: "transparent",
                    border: "none",
                    color: "var(--color-accent)",
                    cursor: "pointer",
                    fontSize: 12,
                    fontFamily: "inherit",
                  }}
                >
                  {resultExpanded ? "收起" : "查看详情"}
                </button>
              )}
              <button
                type="button"
                onClick={() => setBulkResult(null)}
                style={{
                  marginLeft: "auto",
                  background: "transparent",
                  border: "none",
                  color: "var(--color-fg-subtle)",
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
                title="关闭"
              >
                <Icon name="x" size={12} />
              </button>
            </div>
            {resultExpanded && (
              <ul style={{ margin: "8px 0 0 16px", padding: 0, listStyle: "disc" }}>
                {bulkResult.data.skipped.map(renderBulkResultRow)}
                {bulkResult.data.failed.map(renderBulkResultRow)}
              </ul>
            )}
          </div>
        )}

        {!isLoading && batches.length > 0 && (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--color-border)" }}>
                {isOwner && (
                  <th style={{ padding: "8px 0 8px 12px", width: 28 }}>
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleAll}
                      title={allSelected ? "取消全选" : "全选"}
                      style={{ cursor: "pointer" }}
                    />
                  </th>
                )}
                {["批次", "状态", "分派", "优先级", "截止日期", "进度", "操作"].map((h) => (
                  <th
                    key={h}
                    style={{
                      padding: "8px 12px",
                      textAlign: "left",
                      fontWeight: 500,
                      color: "var(--color-fg-muted)",
                      fontSize: 12,
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {batches.map((b) => (
                <tr key={b.id} style={{ borderBottom: "1px solid var(--color-border)" }}>
                  {isOwner && (
                    <td style={{ padding: "10px 0 10px 12px", width: 28 }}>
                      {b.display_id !== "B-DEFAULT" ? (
                        <input
                          type="checkbox"
                          checked={selectedIds.has(b.id)}
                          onChange={() => toggleOne(b.id)}
                          style={{ cursor: "pointer" }}
                        />
                      ) : null}
                    </td>
                  )}
                  <td style={{ padding: "10px 12px" }}>
                    <div style={{ fontWeight: 500 }}>{b.name}</div>
                    <div className="mono" style={{ fontSize: 11, color: "var(--color-fg-subtle)" }}>
                      {b.display_id}
                    </div>
                  </td>
                  <td style={{ padding: "10px 12px" }}>
                    <Badge variant={STATUS_VARIANTS[b.status] ?? "default"} dot>
                      {STATUS_LABELS[b.status] ?? b.status}
                    </Badge>
                  </td>
                  <td style={{ padding: "10px 12px" }}>
                    {(() => {
                      const unassigned = !b.annotator_id && !b.reviewer_id;
                      const assignees = [b.annotator, b.reviewer].filter(Boolean) as NonNullable<typeof b.annotator>[];
                      return (
                        <button
                          type="button"
                          onClick={() => setAssignTarget(b)}
                          title={unassigned ? "未分派 · 点击设置" : "点击修改分派"}
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 4,
                            padding: "2px 6px",
                            background: "transparent",
                            border: `1px dashed ${unassigned ? "var(--color-warning)" : "var(--color-border)"}`,
                            borderRadius: 100,
                            cursor: "pointer",
                            fontSize: 11,
                            color: unassigned ? "var(--color-warning)" : "var(--color-fg-muted)",
                            fontFamily: "inherit",
                          }}
                        >
                          {unassigned ? (
                            <>
                              <Icon name="users" size={11} />未分派
                            </>
                          ) : (
                            <AssigneeAvatarStack users={assignees} max={2} />
                          )}
                        </button>
                      );
                    })()}
                  </td>
                  <td style={{ padding: "10px 12px" }}>{b.priority}</td>
                  <td style={{ padding: "10px 12px", color: "var(--color-fg-muted)" }}>
                    {b.deadline ?? "—"}
                  </td>
                  <td style={{ padding: "10px 12px", minWidth: 140 }}>
                    <ProgressBar value={b.progress_pct} />
                    <div style={{ fontSize: 11, color: "var(--color-fg-muted)", marginTop: 2 }}>
                      <span className="mono">
                        {b.completed_tasks} / {b.total_tasks}
                      </span>
                    </div>
                  </td>
                  <td style={{ padding: "10px 12px" }}>
                    <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                      {b.status === "draft" && (
                        <Button
                          onClick={() => handleTransition(b, "active")}
                          disabled={!b.annotator_id || b.total_tasks === 0}
                          title={
                            !b.annotator_id
                              ? "请先分派标注员"
                              : b.total_tasks === 0
                                ? "批次内无任务，无法激活"
                                : "激活"
                          }
                        >
                          <Icon name="play" size={12} />
                        </Button>
                      )}
                      {b.status === "annotating" && (
                        <Button
                          onClick={() => handleTransition(b, "reviewing")}
                          title="整批提交质检（owner / 被分派标注员）"
                        >
                          <Icon name="check" size={12} /> 提交质检
                        </Button>
                      )}
                      {b.status === "reviewing" && (
                        <>
                          <Button
                            onClick={() => handleTransition(b, "approved")}
                            title="批次通过审核（reviewer / owner）"
                            style={{ background: "var(--color-success)", color: "#fff" }}
                          >
                            <Icon name="check" size={12} /> 通过
                          </Button>
                          <Button
                            onClick={() => setRejectTarget(b)}
                            title="批次驳回（reviewer / owner）"
                            style={{ background: "var(--color-danger)", color: "#fff" }}
                          >
                            <Icon name="x" size={12} /> 驳回
                          </Button>
                        </>
                      )}
                      {b.status === "rejected" && (
                        <Button onClick={() => handleTransition(b, "active")} title="重新激活">
                          <Icon name="refresh" size={12} />
                        </Button>
                      )}
                      {/* v0.7.3 · owner 专属逆向迁移按钮 */}
                      {isOwner && b.status === "rejected" && (
                        <Button
                          onClick={() => setReverseTarget({ batch: b, kind: "reopen_from_rejected" })}
                          title="跳过重标，直接复审"
                        >
                          <Icon name="refresh" size={12} /> 直接复审
                        </Button>
                      )}
                      {isOwner && b.status === "approved" && (
                        <Button
                          onClick={() => setReverseTarget({ batch: b, kind: "reopen_from_approved" })}
                          title="重开审核"
                        >
                          <Icon name="refresh" size={12} /> 重开审核
                        </Button>
                      )}
                      {isOwner && b.status === "archived" && (
                        <Button
                          onClick={() => setReverseTarget({ batch: b, kind: "unarchive" })}
                          title="撤销归档"
                        >
                          <Icon name="refresh" size={12} /> 撤销归档
                        </Button>
                      )}
                      {!["archived", "approved"].includes(b.status) && (
                        <Button onClick={() => handleTransition(b, "archived")} title="归档">
                          <Icon name="inbox" size={12} />
                        </Button>
                      )}
                      {b.display_id !== "B-DEFAULT" && (
                        <Button onClick={() => setConfirmDelete(b)} title="删除">
                          <Icon name="trash" size={12} />
                        </Button>
                      )}
                      {/* v0.7.3 · 操作历史抽屉 */}
                      <Button onClick={() => setAuditTarget(b)} title="操作历史">
                        <Icon name="clock" size={12} />
                      </Button>
                    </div>
                    {b.status === "rejected" && b.review_feedback && (
                      <div
                        style={{
                          marginTop: 6,
                          padding: "6px 8px",
                          background: "color-mix(in oklab, var(--color-danger) 8%, transparent)",
                          borderLeft: "2px solid var(--color-danger)",
                          fontSize: 11,
                          color: "var(--color-fg-muted)",
                          maxWidth: 300,
                        }}
                        title={b.review_feedback}
                      >
                        <strong style={{ color: "var(--color-danger)" }}>驳回原因：</strong>
                        {b.review_feedback.length > 80
                          ? b.review_feedback.slice(0, 80) + "…"
                          : b.review_feedback}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {/* 创建批次 Modal */}
      <Modal open={showCreate} title="创建批次" onClose={() => setShowCreate(false)}>
          <div style={{ display: "flex", flexDirection: "column", gap: 16, padding: "0 4px" }}>
            <div style={{ display: "flex", gap: 8 }}>
              <Button
                onClick={() => setCreateMode("single")}
                style={{
                  background: createMode === "single" ? "var(--color-accent)" : undefined,
                  color: createMode === "single" ? "#fff" : undefined,
                }}
              >
                单个批次
              </Button>
              <Button
                onClick={() => setCreateMode("split")}
                style={{
                  background: createMode === "split" ? "var(--color-accent)" : undefined,
                  color: createMode === "split" ? "#fff" : undefined,
                }}
              >
                随机切分
              </Button>
            </div>

            {createMode === "single" ? (
              <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13 }}>
                批次名称
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  style={{
                    padding: "6px 10px",
                    border: "1px solid var(--color-border)",
                    borderRadius: "var(--radius-sm)",
                    fontSize: 13,
                    fontFamily: "inherit",
                    background: "var(--color-bg)",
                    color: "var(--color-fg)",
                  }}
                  placeholder="例如：第 1 批"
                />
              </label>
            ) : (
              <>
                <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13 }}>
                  批次数量
                  <input
                    type="number"
                    min={2}
                    max={100}
                    value={nBatches}
                    onChange={(e) => setNBatches(Number(e.target.value))}
                    style={{
                      padding: "6px 10px",
                      border: "1px solid var(--color-border)",
                      borderRadius: "var(--radius-sm)",
                      fontSize: 13,
                      fontFamily: "inherit",
                      background: "var(--color-bg)",
                      color: "var(--color-fg)",
                      width: 80,
                    }}
                  />
                </label>
                <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13 }}>
                  名称前缀
                  <input
                    value={namePrefix}
                    onChange={(e) => setNamePrefix(e.target.value)}
                    style={{
                      padding: "6px 10px",
                      border: "1px solid var(--color-border)",
                      borderRadius: "var(--radius-sm)",
                      fontSize: 13,
                      fontFamily: "inherit",
                      background: "var(--color-bg)",
                      color: "var(--color-fg)",
                    }}
                    placeholder="Batch"
                  />
                </label>
              </>
            )}

            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13 }}>
              优先级: {priority}
              <input
                type="range"
                min={0}
                max={100}
                value={priority}
                onChange={(e) => setPriority(Number(e.target.value))}
                style={{ width: "100%" }}
              />
            </label>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <Button onClick={() => setShowCreate(false)}>取消</Button>
              <Button
                onClick={handleCreate}
                disabled={createMode === "single" && !name.trim()}
                style={{ background: "var(--color-accent)", color: "#fff" }}
              >
                {createMode === "single" ? "创建" : `切分为 ${nBatches} 个批次`}
              </Button>
            </div>
          </div>
        </Modal>

      {/* 删除确认 */}
      <Modal open={!!confirmDelete} title="确认删除" onClose={() => setConfirmDelete(null)}>
          <div style={{ fontSize: 13 }}>
            <p>
              确定删除批次 <strong>{confirmDelete?.name}</strong>？
              其中的 {confirmDelete?.total_tasks ?? 0} 个任务将回归默认批次。
            </p>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
              <Button onClick={() => setConfirmDelete(null)}>取消</Button>
              <Button
                onClick={() => confirmDelete && handleDelete(confirmDelete)}
                style={{ background: "var(--color-danger)", color: "#fff" }}
              >
                删除
              </Button>
            </div>
          </div>
        </Modal>

      {/* v0.6.7 B-12-②：分派 Modal */}
      {assignTarget && (
        <BatchAssignmentModal
          projectId={project.id}
          batch={assignTarget}
          onClose={() => setAssignTarget(null)}
        />
      )}

      {/* v0.7.0：批次驳回 Modal */}
      {rejectTarget && (
        <RejectBatchModal
          projectId={project.id}
          batch={rejectTarget}
          onClose={() => setRejectTarget(null)}
        />
      )}

      {/* v0.7.2：项目级 batch 分派 Modal */}
      {distributeOpen && (
        <ProjectDistributeBatchesModal
          projectId={project.id}
          onClose={() => setDistributeOpen(false)}
        />
      )}

      {/* v0.7.3：批量操作二次确认 Modal */}
      <Modal
        open={confirmBulk === "archive" || confirmBulk === "delete" || confirmBulk === "activate"}
        title={`批量${confirmBulk ? BULK_LABEL[confirmBulk] : ""}`}
        onClose={() => setConfirmBulk(null)}
      >
        <div style={{ fontSize: 13 }}>
          {confirmBulk === "archive" && (
            <p>将把已选 <strong>{selectedCount}</strong> 个批次归档。归档后批次进入终态，可由 owner 通过「撤销归档」恢复。</p>
          )}
          {confirmBulk === "delete" && (
            <p style={{ color: "var(--color-danger)" }}>
              将永久删除已选 <strong>{selectedCount}</strong> 个批次。批次内的任务会回归默认批次（无默认批次时变为未归类）。此操作不可撤销。
            </p>
          )}
          {confirmBulk === "activate" && (
            <p>将激活已选 <strong>{selectedCount}</strong> 个 draft 批次。前置条件不满足（未指派标注员或任务为空）的批次会失败但不影响其他。</p>
          )}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
            <Button onClick={() => setConfirmBulk(null)}>取消</Button>
            <Button
              onClick={() => {
                if (confirmBulk === "archive") runBulkArchive();
                else if (confirmBulk === "delete") runBulkDelete();
                else if (confirmBulk === "activate") runBulkActivate();
              }}
              disabled={bulkArchive.isPending || bulkDelete.isPending || bulkActivate.isPending}
              style={{
                background:
                  confirmBulk === "delete" ? "var(--color-danger)" : "var(--color-accent)",
                color: "#fff",
              }}
            >
              确认{confirmBulk ? BULK_LABEL[confirmBulk] : ""}
            </Button>
          </div>
        </div>
      </Modal>

      {/* v0.7.3：批量改派 Modal */}
      {reassignOpen && (
        <BulkReassignModal
          projectId={project.id}
          count={selectedCount}
          onClose={() => setReassignOpen(false)}
          onSubmit={runBulkReassign}
          pending={bulkReassign.isPending}
        />
      )}

      {/* v0.7.3：逆向迁移 Modal */}
      {reverseTarget && (
        <ReverseTransitionModal
          projectId={project.id}
          batch={reverseTarget.batch}
          kind={reverseTarget.kind}
          onClose={() => setReverseTarget(null)}
        />
      )}

      {/* v0.7.3：操作历史抽屉 */}
      {auditTarget && (
        <BatchAuditLogDrawer
          projectId={project.id}
          batch={auditTarget}
          onClose={() => setAuditTarget(null)}
        />
      )}
    </>
  );
}
