import { Modal } from "@/components/ui/Modal";
import { ApiKeysPanel } from "./ApiKeysPanel";

interface Props {
  open: boolean;
  onClose: () => void;
}

/** 用户页弹窗壳：复用 ApiKeysPanel 主体（个人设置页直接内联同一组件）。 */
export function ApiKeysModal({ open, onClose }: Props) {
  return (
    <Modal open={open} onClose={onClose} title="API 密钥" width={640}>
      <ApiKeysPanel active={open} />
    </Modal>
  );
}
