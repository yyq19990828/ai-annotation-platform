import { useState } from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Badge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { useToastStore } from "@/components/ui/Toast";
import {
  useBatches,
  useCreateBatch,
  useDeleteBatch,
  useTransitionBatch,
  useSplitBatches,
} from "@/hooks/useBatches";
import type { ProjectResponse } from "@/api/projects";
import type { BatchResponse } from "@/api/batches";

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

export function BatchesSection({ project }: { project: ProjectResponse }) {
  const pushToast = useToastStore((s) => s.push);
  const { data: batches = [], isLoading } = useBatches(project.id);
  const createBatch = useCreateBatch(project.id);
  const deleteBatch = useDeleteBatch(project.id);
  const transitionBatch = useTransitionBatch(project.id);
  const splitBatches = useSplitBatches(project.id);

  const [showCreate, setShowCreate] = useState(false);
  const [createMode, setCreateMode] = useState<CreateMode>("single");
  const [name, setName] = useState("");
  const [priority, setPriority] = useState(50);
  const [nBatches, setNBatches] = useState(3);
  const [namePrefix, setNamePrefix] = useState("Batch");
  const [confirmDelete, setConfirmDelete] = useState<BatchResponse | null>(null);

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
          <Button onClick={() => setShowCreate(true)}>
            <Icon name="plus" size={12} />创建批次
          </Button>
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

        {!isLoading && batches.length > 0 && (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--color-border)" }}>
                {["批次", "状态", "优先级", "截止日期", "进度", "操作"].map((h) => (
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
                    <div style={{ display: "flex", gap: 4 }}>
                      {b.status === "draft" && (
                        <Button onClick={() => handleTransition(b, "active")} title="激活">
                          <Icon name="play" size={12} />
                        </Button>
                      )}
                      {b.status === "rejected" && (
                        <Button onClick={() => handleTransition(b, "active")} title="重新激活">
                          <Icon name="refresh" size={12} />
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
                    </div>
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
    </>
  );
}
