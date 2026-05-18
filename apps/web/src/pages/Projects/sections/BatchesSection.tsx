import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
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
  useAdminLockBatch,
  useAdminUnlockBatch,
  useBulkApproveBatches,
  useBulkRejectBatches,
} from "@/hooks/useBatches";
import { useBatchEventsSocket } from "@/hooks/useBatchEventsSocket";
import { useIsProjectOwner } from "@/hooks/useIsProjectOwner";
import { BatchAssignmentModal } from "@/components/projects/BatchAssignmentModal";
import { ProjectDistributeBatchesModal } from "@/components/projects/ProjectDistributeBatchesModal";
import { RejectBatchModal } from "./RejectBatchModal";
import { BulkReassignModal } from "./BulkReassignModal";
import { ReverseTransitionModal, type ReverseKind } from "./ReverseTransitionModal";
import { ResetBatchModal } from "./ResetBatchModal";
import { AdminLockModal } from "./AdminLockModal";
import { BulkRejectModal } from "./BulkRejectModal";
import { BatchesKanbanView } from "./BatchesKanbanView";
import { BatchAuditLogDrawer } from "./BatchAuditLogDrawer";
import type { ProjectResponse } from "@/api/projects";
import type { BatchResponse, BulkBatchActionResponse } from "@/api/batches";
import styles from "./BatchesSection.module.css";

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

type BulkActionKind = "archive" | "delete" | "reassign" | "activate" | "approve" | "reject";

const BULK_LABEL: Record<BulkActionKind, string> = {
  archive: "归档",
  delete: "删除",
  reassign: "改派",
  activate: "激活",
  approve: "通过",
  reject: "驳回",
};

// v0.10.11 · 拼接非空 class 名 (类似 clsx 但不引依赖, 单文件足够).
function cn(...xs: Array<string | false | null | undefined>): string {
  return xs.filter(Boolean).join(" ");
}

export function BatchesSection({ project }: { project: ProjectResponse }) {
  const pushToast = useToastStore((s) => s.push);
  // v0.9.13 · 后端 batch 状态变更 (transition / auto_transition) 实时刷新本页列表
  useBatchEventsSocket(project.id);
  const { data: batches = [], isLoading } = useBatches(project.id);
  const createBatch = useCreateBatch(project.id);
  const deleteBatch = useDeleteBatch(project.id);
  const transitionBatch = useTransitionBatch(project.id);
  const splitBatches = useSplitBatches(project.id);
  const bulkArchive = useBulkArchiveBatches(project.id);
  const bulkDelete = useBulkDeleteBatches(project.id);
  const bulkReassign = useBulkReassignBatches(project.id);
  const bulkActivate = useBulkActivateBatches(project.id);
  const bulkApprove = useBulkApproveBatches(project.id);
  const bulkReject = useBulkRejectBatches(project.id);
  const adminLock = useAdminLockBatch(project.id);
  const adminUnlock = useAdminUnlockBatch(project.id);
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
  // v0.7.6 · 终极重置到 draft
  const [resetTarget, setResetTarget] = useState<BatchResponse | null>(null);
  // v0.9.15 · ADR-0008 admin-lock
  const [lockTarget, setLockTarget] = useState<BatchResponse | null>(null);

  // v0.7.6 · view toggle [list | kanban] + URL ?batch_view=kanban 持久化
  const [searchParams, setSearchParams] = useSearchParams();
  const view = (searchParams.get("batch_view") === "kanban" ? "kanban" : "list") as "list" | "kanban";
  const setView = (next: "list" | "kanban") => {
    const params = new URLSearchParams(searchParams);
    if (next === "kanban") params.set("batch_view", "kanban");
    else params.delete("batch_view");
    setSearchParams(params, { replace: true });
  };

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

  const runBulkApprove = () => {
    bulkApprove.mutate([...selectedIds], {
      onSuccess: (data) => {
        handleBulkResult("approve", data);
        setConfirmBulk(null);
      },
      onError: (e) => pushToast({ msg: "批量通过失败", sub: (e as Error).message }),
    });
  };

  const runBulkReject = (feedback: string) => {
    bulkReject.mutate({ batchIds: [...selectedIds], feedback }, {
      onSuccess: (data) => {
        handleBulkResult("reject", data);
        setConfirmBulk(null);
      },
      onError: (e) => pushToast({ msg: "批量驳回失败", sub: (e as Error).message }),
    });
  };

  const handleAdminLock = (batch: BatchResponse, reason: string) => {
    adminLock.mutate({ batchId: batch.id, reason }, {
      onSuccess: () => {
        pushToast({ msg: `批次 ${batch.display_id} 已锁定`, kind: "success" });
        setLockTarget(null);
      },
      onError: (e) => pushToast({ msg: "锁定失败", sub: (e as Error).message }),
    });
  };

  const handleAdminUnlock = (batch: BatchResponse) => {
    adminUnlock.mutate(batch.id, {
      onSuccess: () => pushToast({ msg: `批次 ${batch.display_id} 已解锁`, kind: "success" }),
      onError: (e) => pushToast({ msg: "解锁失败", sub: (e as Error).message }),
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
      <li key={item.batch_id} className={styles.bulkResultRow}>
        <span className="mono">{b?.display_id ?? item.batch_id.slice(0, 8)}</span>
        {b ? <span className={styles.bulkResultRowName}>· {b.name}</span> : null}
        <span className={styles.bulkResultRowReason}>— {item.reason}</span>
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
        <div className={styles.toolbar}>
          <h3 className={styles.toolbarTitle}>批次管理</h3>
          <div className={styles.toolbarActions}>
            {/* v0.7.6 · view toggle */}
            <div role="tablist" aria-label="批次视图" className={styles.viewToggle}>
              {(["list", "kanban"] as const).map((v) => (
                <button
                  key={v}
                  role="tab"
                  aria-selected={view === v}
                  onClick={() => setView(v)}
                  className={cn(
                    styles.viewToggleButton,
                    view === v && styles.viewToggleButtonActive,
                    v === "list" && styles.viewToggleButtonList,
                  )}
                  title={v === "list" ? "列表视图" : "看板视图（按状态分列）"}
                >
                  <Icon name={v === "list" ? "list" : "grid"} size={11} />
                  {v === "list" ? "列表" : "看板"}
                </button>
              ))}
            </div>
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

        {isLoading && <div className={styles.placeholder}>加载中...</div>}

        {!isLoading && batches.length === 0 && (
          <div className={styles.placeholder}>暂无批次</div>
        )}

        {/* v0.7.3 · 未归类任务横带（关联数据集后但还没切分到 batch 的 task） */}
        {unclassifiedCount > 0 && (
          <div className={cn(styles.banner, styles.bannerWarn)}>
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
                className={styles.bannerListGoSplit}
                title="按随机切分把未归类任务拆成 N 个批次"
              >
                <Icon name="layers" size={12} /> 去分包
              </Button>
            )}
          </div>
        )}

        {/* v0.7.3 · 多选浮层操作条（仅 owner 可见） */}
        {isOwner && selectedCount > 0 && (
          <div className={cn(styles.banner, styles.bannerAccent)}>
            <span>已选 <strong>{selectedCount}</strong> 个批次</span>
            <div className={styles.bannerActionsRight}>
              <Button onClick={() => setConfirmBulk("activate")} title="对选中的 draft 批次批量激活">
                <Icon name="play" size={12} /> 激活
              </Button>
              <Button
                onClick={() => setConfirmBulk("approve")}
                className={styles.btnSuccess}
                title="批量通过审核（仅审核中的批次生效）"
              >
                <Icon name="check" size={12} /> 通过
              </Button>
              <Button
                onClick={() => setConfirmBulk("reject")}
                className={styles.btnDanger}
                title="批量驳回（仅审核中的批次生效，需填写驳回原因）"
              >
                <Icon name="x" size={12} /> 驳回
              </Button>
              <Button onClick={() => setReassignOpen(true)} title="批量改派 annotator / reviewer">
                <Icon name="users" size={12} /> 改派
              </Button>
              <Button onClick={() => setConfirmBulk("archive")} title="批量归档">
                <Icon name="inbox" size={12} /> 归档
              </Button>
              <Button
                onClick={() => setConfirmBulk("delete")}
                className={styles.btnDanger}
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
          <div className={cn(styles.banner, styles.bannerSunken)}>
            <div className={styles.bannerInline}>
              <span>
                上次批量{BULK_LABEL[bulkResult.kind]}：
                <strong className={styles.bulkOk}> 成功 {bulkResult.data.succeeded.length}</strong>
                {bulkResult.data.skipped.length > 0 && (
                  <strong className={styles.bulkWarn}>
                    跳过 {bulkResult.data.skipped.length}
                  </strong>
                )}
                {bulkResult.data.failed.length > 0 && (
                  <strong className={styles.bulkFail}>
                    失败 {bulkResult.data.failed.length}
                  </strong>
                )}
              </span>
              {(bulkResult.data.skipped.length > 0 || bulkResult.data.failed.length > 0) && (
                <button
                  type="button"
                  onClick={() => setResultExpanded((v) => !v)}
                  className={styles.linkButton}
                >
                  {resultExpanded ? "收起" : "查看详情"}
                </button>
              )}
              <button
                type="button"
                onClick={() => setBulkResult(null)}
                className={styles.iconButton}
                title="关闭"
              >
                <Icon name="x" size={12} />
              </button>
            </div>
            {resultExpanded && (
              <ul className={styles.bulkResultDetail}>
                {bulkResult.data.skipped.map(renderBulkResultRow)}
                {bulkResult.data.failed.map(renderBulkResultRow)}
              </ul>
            )}
          </div>
        )}

        {!isLoading && batches.length > 0 && view === "kanban" && (
          <BatchesKanbanView
            batches={batches}
            isOwner={isOwner}
            onTransition={handleTransition}
          />
        )}

        {!isLoading && batches.length > 0 && view === "list" && (
          <table className={styles.table}>
            <thead>
              <tr className={styles.tableHeadRow}>
                {isOwner && (
                  <th className={styles.thCheckbox}>
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleAll}
                      title={allSelected ? "取消全选" : "全选"}
                      className={styles.checkbox}
                    />
                  </th>
                )}
                {["批次", "状态", "分派", "优先级", "截止日期", "进度", "操作"].map((h) => (
                  <th key={h} className={styles.thLabel}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {batches.map((b) => (
                <tr key={b.id} className={styles.tableBodyRow}>
                  {isOwner && (
                    <td className={styles.tdCheckbox}>
                      {b.display_id !== "B-DEFAULT" ? (
                        <input
                          type="checkbox"
                          checked={selectedIds.has(b.id)}
                          onChange={() => toggleOne(b.id)}
                          className={styles.checkbox}
                        />
                      ) : null}
                    </td>
                  )}
                  <td className={styles.td}>
                    <div className={styles.cellTitle}>{b.name}</div>
                    <div className={cn("mono", styles.cellSubId)}>
                      {b.display_id}
                    </div>
                  </td>
                  <td className={styles.td}>
                    <div className={styles.cellStatusRow}>
                      <Badge variant={STATUS_VARIANTS[b.status] ?? "default"} dot>
                        {STATUS_LABELS[b.status] ?? b.status}
                      </Badge>
                      {b.admin_locked && (
                        <span title={b.admin_lock_reason ?? "已锁定"}>
                          <Badge variant="warning">
                            <Icon name="lock" size={10} /> 已锁定
                          </Badge>
                        </span>
                      )}
                    </div>
                  </td>
                  <td className={styles.td}>
                    {(() => {
                      const unassigned = !b.annotator_id && !b.reviewer_id;
                      const assignees = [b.annotator, b.reviewer].filter(Boolean) as NonNullable<typeof b.annotator>[];
                      return (
                        <button
                          type="button"
                          onClick={() => setAssignTarget(b)}
                          title={unassigned ? "未分派 · 点击设置" : "点击修改分派"}
                          className={cn(
                            styles.assignChip,
                            unassigned && styles.assignChipUnassigned,
                          )}
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
                  <td className={styles.td}>{b.priority}</td>
                  <td className={styles.tdMuted}>
                    {b.deadline ?? "—"}
                  </td>
                  <td className={styles.tdProgress}>
                    <ProgressBar value={b.progress_pct} />
                    <div className={styles.progressSublabel}>
                      <span className="mono">
                        {b.completed_tasks} / {b.total_tasks}
                      </span>
                    </div>
                  </td>
                  <td className={styles.td}>
                    <div className={styles.actionRow}>
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
                            className={styles.btnSuccess}
                          >
                            <Icon name="check" size={12} /> 通过
                          </Button>
                          <Button
                            onClick={() => setRejectTarget(b)}
                            title="批次驳回（reviewer / owner）"
                            className={styles.btnDanger}
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
                      {/* v0.7.6 · owner 终极重置到 draft（任意非 draft 状态） */}
                      {isOwner && b.status !== "draft" && (
                        <Button
                          onClick={() => setResetTarget(b)}
                          title="重置到草稿（owner 兜底）"
                        >
                          <Icon name="refresh" size={12} /> 重置
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
                      {/* v0.9.15 · ADR-0008 admin-lock */}
                      {isOwner && !b.admin_locked && (
                        <Button
                          onClick={() => setLockTarget(b)}
                          title="锁定批次（冻结自动推进，阻止新派单）"
                          className={styles.btnLockWarn}
                        >
                          <Icon name="lock" size={12} />
                        </Button>
                      )}
                      {isOwner && b.admin_locked && (
                        <Button
                          onClick={() => handleAdminUnlock(b)}
                          title="解锁批次"
                          className={styles.btnUnlockSuccess}
                        >
                          <Icon name="unlock" size={12} />
                        </Button>
                      )}
                    </div>
                    {b.status === "rejected" && b.review_feedback && (
                      <div
                        className={styles.rejectFeedback}
                        title={b.review_feedback}
                      >
                        <strong className={styles.rejectFeedbackLabel}>驳回原因：</strong>
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
          <div className={styles.modalForm}>
            <div className={styles.modeToggleRow}>
              <Button
                onClick={() => setCreateMode("single")}
                className={cn(createMode === "single" && styles.modeToggleActive)}
              >
                单个批次
              </Button>
              <Button
                onClick={() => setCreateMode("split")}
                className={cn(createMode === "split" && styles.modeToggleActive)}
              >
                随机切分
              </Button>
            </div>

            {createMode === "single" ? (
              <label className={styles.formLabel}>
                批次名称
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className={styles.formInput}
                  placeholder="例如：第 1 批"
                />
              </label>
            ) : (
              <>
                <label className={styles.formLabel}>
                  批次数量
                  <input
                    type="number"
                    min={2}
                    max={100}
                    value={nBatches}
                    onChange={(e) => setNBatches(Number(e.target.value))}
                    className={cn(styles.formInput, styles.formInputNarrow)}
                  />
                </label>
                <label className={styles.formLabel}>
                  名称前缀
                  <input
                    value={namePrefix}
                    onChange={(e) => setNamePrefix(e.target.value)}
                    className={styles.formInput}
                    placeholder="Batch"
                  />
                </label>
              </>
            )}

            <label className={styles.formLabel}>
              优先级: {priority}
              <input
                type="range"
                min={0}
                max={100}
                value={priority}
                onChange={(e) => setPriority(Number(e.target.value))}
                className={styles.formRange}
              />
            </label>

            <div className={styles.formActions}>
              <Button onClick={() => setShowCreate(false)}>取消</Button>
              <Button
                onClick={handleCreate}
                disabled={createMode === "single" && !name.trim()}
                className={styles.btnAccent}
              >
                {createMode === "single" ? "创建" : `切分为 ${nBatches} 个批次`}
              </Button>
            </div>
          </div>
        </Modal>

      {/* 删除确认 */}
      <Modal open={!!confirmDelete} title="确认删除" onClose={() => setConfirmDelete(null)}>
          <div className={styles.confirmBody}>
            <p>
              确定删除批次 <strong>{confirmDelete?.name}</strong>？
              其中的 {confirmDelete?.total_tasks ?? 0} 个任务将回归默认批次。
            </p>
            <div className={styles.confirmActions}>
              <Button onClick={() => setConfirmDelete(null)}>取消</Button>
              <Button
                onClick={() => confirmDelete && handleDelete(confirmDelete)}
                className={styles.btnDanger}
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
        open={confirmBulk === "archive" || confirmBulk === "delete" || confirmBulk === "activate" || confirmBulk === "approve"}
        title={`批量${confirmBulk ? BULK_LABEL[confirmBulk] : ""}`}
        onClose={() => setConfirmBulk(null)}
      >
        <div className={styles.confirmBody}>
          {confirmBulk === "archive" && (
            <p>将把已选 <strong>{selectedCount}</strong> 个批次归档。归档后批次进入终态，可由 owner 通过「撤销归档」恢复。</p>
          )}
          {confirmBulk === "delete" && (
            <p className={styles.dangerText}>
              将永久删除已选 <strong>{selectedCount}</strong> 个批次。批次内的任务会回归默认批次（无默认批次时变为未归类）。此操作不可撤销。
            </p>
          )}
          {confirmBulk === "activate" && (
            <p>将激活已选 <strong>{selectedCount}</strong> 个 draft 批次。前置条件不满足（未指派标注员或任务为空）的批次会失败但不影响其他。</p>
          )}
          {confirmBulk === "approve" && (
            <p>将把已选 <strong>{selectedCount}</strong> 个批次中的「审核中」批次全部通过。非审核中状态的批次会自动跳过。</p>
          )}
          <div className={styles.confirmActions}>
            <Button onClick={() => setConfirmBulk(null)}>取消</Button>
            <Button
              onClick={() => {
                if (confirmBulk === "archive") runBulkArchive();
                else if (confirmBulk === "delete") runBulkDelete();
                else if (confirmBulk === "activate") runBulkActivate();
                else if (confirmBulk === "approve") runBulkApprove();
              }}
              disabled={bulkArchive.isPending || bulkDelete.isPending || bulkActivate.isPending || bulkApprove.isPending}
              className={cn(
                styles.bulkConfirmPrimary,
                confirmBulk === "delete" && styles.bulkConfirmDanger,
                confirmBulk === "approve" && styles.bulkConfirmSuccess,
              )}
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

      {/* v0.7.6：终极重置到 draft */}
      {resetTarget && (
        <ResetBatchModal
          projectId={project.id}
          batch={resetTarget}
          onClose={() => setResetTarget(null)}
        />
      )}

      {/* v0.9.15：管理员锁定 Modal */}
      {lockTarget && (
        <AdminLockModal
          batch={lockTarget}
          onClose={() => setLockTarget(null)}
          onSubmit={(reason) => handleAdminLock(lockTarget, reason)}
          pending={adminLock.isPending}
        />
      )}

      {/* v0.9.15：批量驳回 Modal */}
      {confirmBulk === "reject" && (
        <BulkRejectModal
          count={selectedCount}
          onClose={() => setConfirmBulk(null)}
          onSubmit={runBulkReject}
          pending={bulkReject.isPending}
        />
      )}
    </>
  );
}
