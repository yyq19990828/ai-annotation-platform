// v0.14.11 · 模型市场零接入横幅. 引导用户去注册 backend, 不打断协议卡浏览。
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import styles from "./EmptyCatalogBanner.module.css";

interface Props {
  taskCount: number;
  onGoToRegistry: () => void;
}

export function EmptyCatalogBanner({ taskCount, onGoToRegistry }: Props) {
  return (
    <div className={styles.banner}>
      <div className={styles.iconBox}>
        <Icon name="layers" size={24} />
      </div>
      <div className={styles.body}>
        <div className={styles.title}>
          平台支持 {taskCount} 类 AI 标注能力，当前还没有 backend 接入。
        </div>
        <div className={styles.subtitle}>
          下方列出协议层支持的能力清单。每张协议卡都给出推荐的开源 backend，
          注册后该能力下会出现可用模型。
        </div>
      </div>
      <div className={styles.actions}>
        <Button size="sm" onClick={onGoToRegistry}>
          <Icon name="plus" size={11} /> 去注册 backend
        </Button>
      </div>
    </div>
  );
}
