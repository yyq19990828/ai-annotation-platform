import { Icon } from "@/components/ui/Icon";
import styles from "./ConflictModal.module.css";

interface ConflictModalProps {
  open: boolean;
  onReload: () => void;
  onOverwrite: () => void;
  onClose: () => void;
}

export function ConflictModal({ open, onReload, onOverwrite, onClose }: ConflictModalProps) {
  if (!open) return null;

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <Icon name="warning" size={20} className={styles.warningIcon} />
          <span className={styles.title}>编辑冲突</span>
        </div>
        <p className={styles.description}>
          该标注已被其他用户修改。你可以重载以获取最新数据，或强制覆盖对方的修改。
        </p>
        <div className={styles.actions}>
          <button
            onClick={onClose}
            className={`${styles.button} ${styles.cancelButton}`}
          >
            取消
          </button>
          <button
            onClick={onOverwrite}
            className={`${styles.button} ${styles.overwriteButton}`}
          >
            强制覆盖
          </button>
          <button
            onClick={onReload}
            className={`${styles.button} ${styles.reloadButton}`}
          >
            重载（放弃本地）
          </button>
        </div>
      </div>
    </div>
  );
}
