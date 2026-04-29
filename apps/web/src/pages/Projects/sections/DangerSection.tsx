import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card } from "@/components/ui/Card";
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
    </>
  );
}
