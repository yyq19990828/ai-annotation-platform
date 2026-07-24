import { Icon } from "@/components/ui/Icon";
import styles from "./ImageBackdrop.module.css";

export function ImageBackdrop({ url, onRetry }: { url: string | null; onRetry?: () => void }) {
  if (url) {
    return <img src={url} alt="task" className={styles.image} draggable={false} />;
  }
  return (
    <div className={styles.empty}>
      <Icon name="warning" size={32} />
      <div className={styles.emptyText}>图像不可用</div>
      {onRetry && (
        <button type="button" onClick={onRetry} className={styles.retryButton}>
          重试
        </button>
      )}
    </div>
  );
}
