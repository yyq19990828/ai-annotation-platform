import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";

interface DeleteConfirmModalProps {
  open: boolean;
  count: number;
  onCancel: () => void;
  onConfirm: () => void;
}

export function DeleteConfirmModal({ open, count, onCancel, onConfirm }: DeleteConfirmModalProps) {
  return (
    <Modal open={open} onClose={onCancel} title="确认删除" width={420}>
      <p>确定删除 {count} 个标注？删除后仍可通过撤销恢复。</p>
      <div className="flex justify-end gap-2">
        <Button onClick={onCancel}>取消</Button>
        <Button variant="danger" onClick={onConfirm} data-testid="delete-confirm-submit">
          删除
        </Button>
      </div>
    </Modal>
  );
}
