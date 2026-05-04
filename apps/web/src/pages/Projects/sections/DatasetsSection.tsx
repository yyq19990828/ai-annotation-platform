import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Modal } from "@/components/ui/Modal";
import { useToastStore } from "@/components/ui/Toast";
import {
  useDatasets,
  useLinkProject,
  useUnlinkProject,
  useProjectDatasets,
} from "@/hooks/useDatasets";
import { datasetsApi } from "@/api/datasets";
import type { ProjectResponse } from "@/api/projects";

export function DatasetsSection({ project }: { project: ProjectResponse }) {
  const pushToast = useToastStore((s) => s.push);
  const { data: linked = [], isLoading } = useProjectDatasets(project.id);
  const { data: allDatasetsRes } = useDatasets();
  const allDatasets = allDatasetsRes?.items ?? [];

  const [linkOpen, setLinkOpen] = useState(false);
  const [unlinkTarget, setUnlinkTarget] = useState<{
    dataset_id: string;
    name: string;
  } | null>(null);

  const linkedIds = useMemo(() => new Set(linked.map((d) => d.id)), [linked]);
  const candidates = allDatasets.filter((d) => !linkedIds.has(d.id));

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
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>关联数据集</h3>
          <Button onClick={() => setLinkOpen(true)} disabled={candidates.length === 0}>
            <Icon name="plus" size={12} /> 关联数据集
          </Button>
        </div>

        {isLoading && (
          <div style={{ padding: 32, textAlign: "center", color: "var(--color-fg-subtle)", fontSize: 13 }}>
            加载中...
          </div>
        )}

        {!isLoading && linked.length === 0 && (
          <div style={{ padding: 32, textAlign: "center", color: "var(--color-fg-subtle)", fontSize: 13 }}>
            尚未关联任何数据集。点击右上角「关联数据集」开始。
          </div>
        )}

        {!isLoading && linked.length > 0 && (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--color-border)" }}>
                {["数据集", "类型", "原数据集条目", "本项目任务", "关联时间", "操作"].map((h) => (
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
              {linked.map((d) => (
                <tr key={d.id} style={{ borderBottom: "1px solid var(--color-border)" }}>
                  <td style={{ padding: "10px 12px" }}>
                    <div style={{ fontWeight: 500 }}>{d.name}</div>
                    <div className="mono" style={{ fontSize: 11, color: "var(--color-fg-subtle)" }}>
                      {d.display_id}
                    </div>
                  </td>
                  <td style={{ padding: "10px 12px", color: "var(--color-fg-muted)" }}>{d.data_type}</td>
                  <td style={{ padding: "10px 12px" }}>{d.items_count}</td>
                  <td style={{ padding: "10px 12px" }}>{d.tasks_in_project}</td>
                  <td style={{ padding: "10px 12px", color: "var(--color-fg-muted)", fontSize: 12 }}>
                    {d.linked_at ? new Date(d.linked_at).toLocaleString() : "—"}
                  </td>
                  <td style={{ padding: "10px 12px" }}>
                    <Button
                      onClick={() => setUnlinkTarget({ dataset_id: d.id, name: d.name })}
                      title="取消关联（会清理对应的任务、标注与空批次）"
                    >
                      <Icon name="x" size={12} /> 取消关联
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {linkOpen && (
        <LinkDatasetModal
          projectId={project.id}
          candidates={candidates}
          onClose={() => setLinkOpen(false)}
          onLinked={(name) => pushToast({ msg: `已关联数据集：${name}`, kind: "success" })}
        />
      )}

      {unlinkTarget && (
        <UnlinkConfirmModal
          projectId={project.id}
          datasetId={unlinkTarget.dataset_id}
          datasetName={unlinkTarget.name}
          onClose={() => setUnlinkTarget(null)}
          onDone={() => setUnlinkTarget(null)}
        />
      )}
    </>
  );
}

function LinkDatasetModal({
  projectId,
  candidates,
  onClose,
  onLinked,
}: {
  projectId: string;
  candidates: { id: string; name: string; display_id: string; data_type: string }[];
  onClose: () => void;
  onLinked: (name: string) => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  // useLinkProject 是按 datasetId 维度的 hook；这里临时绕开 — 直接调 mutation
  // 但现有 useLinkProject 只能 useMutation 化为 datasetId-bound 实例。
  // 为简洁，我们直接调 datasetsApi.linkProject + invalidate by hand。
  const link = useLinkProject(selected ?? "");
  const pushToast = useToastStore((s) => s.push);

  const onSubmit = async () => {
    if (!selected) return;
    const ds = candidates.find((c) => c.id === selected);
    link.mutate(projectId, {
      onSuccess: () => {
        onLinked(ds?.name ?? "数据集");
        onClose();
      },
      onError: (e) => pushToast({ msg: "关联失败", sub: (e as Error).message, kind: "error" }),
    });
  };

  return (
    <Modal open onClose={onClose} title="关联数据集" width={520}>
      <div style={{ fontSize: 13, color: "var(--color-fg-muted)", marginBottom: 12 }}>
        选择一个尚未关联到本项目的数据集。关联后该数据集的全部条目会作为「未归类任务」加入项目，
        在批次管理顶部点击「去分包」即可划分到批次。
      </div>
      {candidates.length === 0 && (
        <div style={{ padding: 16, textAlign: "center", color: "var(--color-fg-subtle)", fontSize: 13 }}>
          暂无可关联的数据集 · 请先在「数据集」页面创建
        </div>
      )}
      {candidates.length > 0 && (
        <div
          style={{
            border: "1px solid var(--color-border)",
            borderRadius: "var(--radius-md)",
            background: "var(--color-bg-sunken)",
            padding: 6,
            maxHeight: 320,
            overflowY: "auto",
          }}
        >
          {candidates.map((d) => {
            const checked = selected === d.id;
            return (
              <button
                key={d.id}
                type="button"
                onClick={() => setSelected(d.id)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  width: "100%",
                  padding: "8px 10px",
                  borderRadius: "var(--radius-sm)",
                  background: checked ? "var(--color-accent-soft)" : "transparent",
                  border: `1px solid ${checked ? "var(--color-accent)" : "transparent"}`,
                  cursor: "pointer",
                  textAlign: "left",
                  marginBottom: 2,
                  fontFamily: "inherit",
                  color: "var(--color-fg)",
                }}
              >
                <span
                  style={{
                    width: 14,
                    height: 14,
                    borderRadius: "50%",
                    border: "1px solid var(--color-border)",
                    background: checked ? "var(--color-accent)" : "var(--color-bg)",
                    flexShrink: 0,
                    position: "relative",
                  }}
                >
                  {checked && (
                    <span style={{ position: "absolute", inset: 3, borderRadius: "50%", background: "#fff" }} />
                  )}
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ fontSize: 13, fontWeight: 500 }}>{d.name}</span>
                  <span className="mono" style={{ fontSize: 11, color: "var(--color-fg-subtle)", marginLeft: 6 }}>
                    {d.display_id}
                  </span>
                  <span
                    style={{
                      fontSize: 11,
                      color: "var(--color-fg-subtle)",
                      marginLeft: 6,
                      padding: "1px 6px",
                      border: "1px solid var(--color-border)",
                      borderRadius: 100,
                    }}
                  >
                    {d.data_type}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
        <Button onClick={onClose}>取消</Button>
        <Button
          onClick={onSubmit}
          disabled={!selected || link.isPending}
          style={{ background: "var(--color-accent)", color: "#fff" }}
        >
          {link.isPending ? "关联中…" : "确认关联"}
        </Button>
      </div>
    </Modal>
  );
}

function UnlinkConfirmModal({
  projectId,
  datasetId,
  datasetName,
  onClose,
  onDone,
}: {
  projectId: string;
  datasetId: string;
  datasetName: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [preview, setPreview] = useState<{
    tasks: number;
    annotations: number;
    batches: number;
  } | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const dangerous = (preview?.tasks ?? 0) > 0;
  const canSubmit = dangerous ? confirmText.trim() === datasetName : true;
  const unlink = useUnlinkProject(datasetId);
  const pushToast = useToastStore((s) => s.push);

  useEffect(() => {
    let cancelled = false;
    datasetsApi
      .previewUnlink(datasetId, projectId)
      .then((r) => {
        if (!cancelled)
          setPreview({
            tasks: r.will_delete_tasks,
            annotations: r.will_delete_annotations,
            batches: r.will_delete_batches,
          });
      })
      .catch(() => {
        if (!cancelled) setPreview({ tasks: 0, annotations: 0, batches: 0 });
      });
    return () => {
      cancelled = true;
    };
  }, [datasetId, projectId]);

  const onConfirm = () => {
    if (!canSubmit) return;
    unlink.mutate(projectId, {
      onSuccess: (res) => {
        const parts: string[] = [];
        if (res?.deleted_tasks) parts.push(`${res.deleted_tasks} 个任务`);
        if (res?.deleted_annotations) parts.push(`${res.deleted_annotations} 个标注`);
        if (res?.deleted_batches) parts.push(`${res.deleted_batches} 个空批次`);
        pushToast({
          msg: "已取消关联",
          sub: parts.length ? `已清理 ${parts.join(" · ")}` : undefined,
          kind: "success",
        });
        onDone();
      },
      onError: (e) =>
        pushToast({ msg: "取消关联失败", sub: (e as Error).message, kind: "error" }),
    });
  };

  return (
    <Modal open onClose={onClose} title="确认取消关联">
      <div style={{ fontSize: 13, lineHeight: 1.6 }}>
        <p style={{ margin: "0 0 8px" }}>
          确认取消数据集 <strong>{datasetName}</strong> 与本项目的关联？
        </p>
        <div style={{ margin: "0 0 8px", color: "var(--color-fg-muted)" }}>
          {preview === null ? (
            "正在统计影响范围…"
          ) : preview.tasks === 0 ? (
            "项目中没有由该数据集创建的任务，可放心取消。"
          ) : (
            <>
              <strong style={{ color: "var(--color-danger)" }}>将一并删除</strong>项目中由该数据集创建的{" "}
              <strong>{preview.tasks}</strong> 个任务
              {preview.annotations > 0 && (
                <>
                  （含 <strong style={{ color: "var(--color-danger)" }}>{preview.annotations}</strong> 个已有标注）
                </>
              )}
              {preview.batches > 0 && (
                <>
                  ，并清理 <strong style={{ color: "var(--color-danger)" }}>{preview.batches}</strong> 个失去全部任务的空批次
                </>
              )}
              。<br />
              此操作不可恢复。
            </>
          )}
        </div>
        {dangerous && (
          <div style={{ margin: "10px 0" }}>
            <label style={{ display: "block", fontSize: 12, color: "var(--color-fg-muted)", marginBottom: 4 }}>
              请输入数据集名称 <strong>{datasetName}</strong> 以确认：
            </label>
            <input
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={datasetName}
              autoFocus
              style={{
                width: "100%",
                boxSizing: "border-box",
                padding: "7px 10px",
                fontSize: 13,
                background: "var(--color-bg-sunken)",
                border: `1px solid ${canSubmit ? "var(--color-success)" : "var(--color-border)"}`,
                borderRadius: "var(--radius-md)",
                color: "var(--color-fg)",
                fontFamily: "inherit",
              }}
            />
          </div>
        )}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
          <Button onClick={onClose}>取消</Button>
          <Button
            onClick={onConfirm}
            disabled={!canSubmit || unlink.isPending}
            style={{
              background: canSubmit ? "var(--color-danger)" : undefined,
              color: canSubmit ? "#fff" : undefined,
            }}
          >
            {unlink.isPending ? "处理中…" : "确认取消关联"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
