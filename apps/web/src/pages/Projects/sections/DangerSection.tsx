import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { useToastStore } from "@/components/ui/Toast";
import { useDeleteProject } from "@/hooks/useProjects";
import { projectsApi, type ProjectResponse } from "@/api/projects";
import styles from "./DangerSection.module.css";

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
      <div className={styles.orphanCard}>
        <div className={styles.cardHeader}>
          <h3 className={styles.warningTitle}>清理孤儿任务</h3>
        </div>
        <div className={styles.cardBody}>
          <div className={styles.mutedCopy}>
            v0.6.0 ~ v0.6.6 期间因 link 流程缺陷，部分任务的源数据集已被取消关联但任务仍残留在项目里、计入进度。
            点击下方按钮可一键清理这些「无源任务」（含其标注），项目计数器同步重算。
          </div>
          {orphanPreview === null ? (
            <div className={styles.subtleText}>正在统计…</div>
          ) : orphanPreview.tasks === 0 ? (
            <div className={styles.successText}>✓ 当前没有孤儿任务</div>
          ) : (
            <div className={styles.orphanPreview}>
              检测到 <strong className={styles.warningText}>{orphanPreview.tasks}</strong> 个孤儿任务
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
      </div>

      <div className={styles.dangerCard}>
        <div className={styles.cardHeader}>
          <h3 className={styles.dangerTitle}>危险操作</h3>
        </div>
        <div className={styles.cardBody}>
          <div className={styles.mutedCopy}>
            删除项目将级联清除该项目下的全部任务、标注、AI 预测与成员关系。此操作不可撤销。
          </div>
          <div>
            <Button variant="danger" onClick={() => setOpen(true)}>
              删除此项目
            </Button>
          </div>
        </div>
      </div>

      <Modal
        open={open}
        onClose={() => {
          setOpen(false);
          setConfirmText("");
        }}
        title="确认删除项目"
        width={460}
      >
        <div className={styles.deleteIntro}>
          请输入项目名称 <strong className={styles.strongText}>{project.name}</strong> 以确认删除。
        </div>
        <input
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          placeholder={project.name}
          className={styles.confirmInput}
        />
        <div className={styles.modalActions}>
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
        <div className={styles.cleanupBody}>
          <p className={styles.cleanupLead}>
            将永久删除 <strong className={styles.dangerText}>{orphanPreview?.tasks ?? 0}</strong> 个孤儿任务
            {orphanPreview && orphanPreview.annotations > 0 && (
              <>（含 <strong className={styles.dangerText}>{orphanPreview.annotations}</strong> 个标注）</>
            )}
            。
          </p>
          <p className={styles.cleanupNote}>
            清理后项目计数器与各批次将自动重算。此操作不可恢复。
          </p>
          <div className={styles.modalActions}>
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
