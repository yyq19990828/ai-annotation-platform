import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { useToastStore } from "@/components/ui/Toast";
import { useDeleteProject } from "@/hooks/useProjects";
import { projectsApi, type ProjectResponse } from "@/api/projects";

export function DangerSection({ project }: { project: ProjectResponse }) {
  const pushToast = useToastStore((s) => s.push);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const remove = useDeleteProject();

  // 孤儿任务预览
  const [orphanPreview, setOrphanPreview] = useState<{ tasks: number; annotations: number } | null>(null);
  const [cleanupConfirm, setCleanupConfirm] = useState(false);
  const [cleanupBusy, setCleanupBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    projectsApi.previewOrphanTasks(project.id)
      .then((r) => { if (!cancelled) setOrphanPreview({ tasks: r.orphan_tasks, annotations: r.orphan_annotations }); })
      .catch(() => { if (!cancelled) setOrphanPreview({ tasks: 0, annotations: 0 }); });
    return () => { cancelled = true; };
  }, [project.id]);

  const onCleanupOrphans = async () => {
    setCleanupBusy(true);
    try {
      const res = await projectsApi.cleanupOrphanTasks(project.id);
      pushToast({
        msg: `已清理 ${res.deleted_tasks} 个孤儿任务${res.deleted_annotations ? ` · ${res.deleted_annotations} 个标注` : ""}`,
        kind: "success",
      });
      setOrphanPreview({ tasks: 0, annotations: 0 });
      setCleanupConfirm(false);
      qc.invalidateQueries({ queryKey: ["projects"] });
      qc.invalidateQueries({ queryKey: ["project", project.id] });
      qc.invalidateQueries({ queryKey: ["project-stats"] });
      qc.invalidateQueries({ queryKey: ["batches", project.id] });
    } catch (err) {
      pushToast({ msg: "清理失败", sub: (err as Error).message, kind: "error" });
    } finally {
      setCleanupBusy(false);
    }
  };

  const onDelete = () => {
    remove.mutate(project.id, {
      onSuccess: () => {
        pushToast({ msg: "项目已删除", kind: "success" });
        navigate("/dashboard");
      },
      onError: (err) => pushToast({ msg: "删除失败", sub: (err as Error).message }),
    });
  };

  return (
    <>
      <Card style={{ borderColor: "var(--color-warning)", marginBottom: 16 }}>
        <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--color-border)" }}>
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: "var(--color-warning)" }}>清理孤儿任务</h3>
        </div>
        <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ fontSize: 13, color: "var(--color-fg-muted)", lineHeight: 1.6 }}>
            v0.6.0 ~ v0.6.6 期间因 link 流程缺陷，部分任务的源数据集已被取消关联但任务仍残留在项目里、计入进度。
            点击下方按钮可一键清理这些「无源任务」（含其标注），项目计数器同步重算。
          </div>
          {orphanPreview === null ? (
            <div style={{ fontSize: 12, color: "var(--color-fg-subtle)" }}>正在统计…</div>
          ) : orphanPreview.tasks === 0 ? (
            <div style={{ fontSize: 12, color: "var(--color-success)" }}>✓ 当前没有孤儿任务</div>
          ) : (
            <div style={{
              padding: 10, fontSize: 12.5, borderRadius: "var(--radius-sm)",
              background: "var(--color-bg-sunken)", border: "1px solid var(--color-warning)",
            }}>
              检测到 <strong style={{ color: "var(--color-warning)" }}>{orphanPreview.tasks}</strong> 个孤儿任务
              {orphanPreview.annotations > 0 && <>（含 <strong>{orphanPreview.annotations}</strong> 个标注）</>}
            </div>
          )}
          <div>
            <Button
              variant="danger"
              onClick={() => setCleanupConfirm(true)}
              disabled={!orphanPreview || orphanPreview.tasks === 0}
            >
              清理孤儿任务
            </Button>
          </div>
        </div>
      </Card>

      <Card style={{ borderColor: "var(--color-danger)" }}>
        <div
          style={{
            padding: "14px 16px",
            borderBottom: "1px solid var(--color-border)",
          }}
        >
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: "var(--color-danger)" }}>危险操作</h3>
        </div>
        <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ fontSize: 13, color: "var(--color-fg-muted)", lineHeight: 1.6 }}>
            删除项目将级联清除该项目下的全部任务、标注、AI 预测与成员关系。此操作不可撤销。
          </div>
          <div>
            <Button variant="danger" onClick={() => setOpen(true)}>
              删除此项目
            </Button>
          </div>
        </div>
      </Card>

      <Modal
        open={open}
        onClose={() => {
          setOpen(false);
          setConfirmText("");
        }}
        title="确认删除项目"
        width={460}
      >
        <div style={{ fontSize: 13, color: "var(--color-fg-muted)", lineHeight: 1.6, marginBottom: 14 }}>
          请输入项目名称 <strong style={{ color: "var(--color-fg)" }}>{project.name}</strong> 以确认删除。
        </div>
        <input
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          placeholder={project.name}
          style={{
            width: "100%",
            boxSizing: "border-box",
            padding: "8px 11px",
            fontSize: 13.5,
            background: "var(--color-bg-sunken)",
            border: "1px solid var(--color-border)",
            borderRadius: "var(--radius-md)",
            color: "var(--color-fg)",
            outline: "none",
            fontFamily: "inherit",
            marginBottom: 16,
          }}
        />
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <Button
            variant="ghost"
            onClick={() => {
              setOpen(false);
              setConfirmText("");
            }}
          >
            取消
          </Button>
          <Button
            variant="danger"
            disabled={confirmText !== project.name || remove.isPending}
            onClick={onDelete}
          >
            {remove.isPending ? "删除中..." : "永久删除"}
          </Button>
        </div>
      </Modal>

      <Modal open={cleanupConfirm} onClose={() => setCleanupConfirm(false)} title="确认清理孤儿任务" width={460}>
        <div style={{ fontSize: 13, lineHeight: 1.6 }}>
          <p style={{ margin: "0 0 8px" }}>
            将永久删除 <strong style={{ color: "var(--color-danger)" }}>{orphanPreview?.tasks ?? 0}</strong> 个孤儿任务
            {orphanPreview && orphanPreview.annotations > 0 && (
              <>（含 <strong style={{ color: "var(--color-danger)" }}>{orphanPreview.annotations}</strong> 个标注）</>
            )}
            。
          </p>
          <p style={{ margin: "0 0 16px", color: "var(--color-fg-muted)" }}>
            清理后项目计数器与各批次将自动重算。此操作不可恢复。
          </p>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <Button variant="ghost" onClick={() => setCleanupConfirm(false)}>取消</Button>
            <Button variant="danger" onClick={onCleanupOrphans} disabled={cleanupBusy}>
              {cleanupBusy ? "清理中…" : "确认清理"}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
