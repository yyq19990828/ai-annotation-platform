import { Icon } from "@/components/ui/Icon";
import styles from "./ThreeDWorkbench.placeholder.module.css";

export function ThreeDWorkbenchPlaceholder() {
  return (
    <div
      data-testid="three-d-workbench-placeholder"
      className={styles.placeholder}
    >
      <div className={styles.content}>
        <Icon name="box" size={32} />
        <div className={styles.message}>3D 标注工作台暂未启用</div>
      </div>
    </div>
  );
}
