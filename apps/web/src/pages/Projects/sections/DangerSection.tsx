import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { useToastStore } from "@/components/ui/Toast";
import { useDeleteProject } from "@/hooks/useProjects";
import type { ProjectResponse } from "@/api/projects";

export function DangerSection({ project }: { project: ProjectResponse }) {
  const pushToast = useToastStore((s) => s.push);
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const remove = useDeleteProject();

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
      <div className="rounded-lg border border-rose-500 bg-card">
        <div className="border-b border-border px-4 py-3.5">
          <h3 className="text-sm font-semibold text-status-danger">危险操作</h3>
        </div>
        <div className="flex flex-col gap-3 p-4">
          <div className="text-[13px] leading-relaxed text-muted-foreground">
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
        <div className="mb-3.5 text-[13px] leading-relaxed text-muted-foreground">
          请输入项目名称 <strong className="text-foreground">{project.name}</strong> 以确认删除。
        </div>
        <input
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          placeholder={project.name}
          className="mb-4 w-full appearance-none rounded-md border border-border bg-muted px-[11px] py-2 text-[13.5px] text-foreground outline-none"
        />
        <div className="flex justify-end gap-2">
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
    </>
  );
}
