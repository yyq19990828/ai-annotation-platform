import { Icon } from "@/components/ui/Icon";
import styles from "./BugReportFAB.module.css";

interface BugReportFABProps {
  onClick: () => void;
  /** 日常隐藏:光标移到右下角指定区域才露出(滑入 + 淡入)。 */
  hidden?: boolean;
}

export function BugReportFAB({ onClick, hidden = false }: BugReportFABProps) {
  return (
    <button
      data-bug-fab
      onClick={onClick}
      title="报告 Bug / 提交反馈"
      className={hidden ? `${styles.button} ${styles.hidden}` : styles.button}
    >
      <Icon name="bug" size={18} />
    </button>
  );
}
