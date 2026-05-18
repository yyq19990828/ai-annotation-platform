/**
 * v0.9.7 · Step 4: 跑预标按钮 + 进度可视化 + 完成 CTA.
 *
 * 进度卡视觉重构：顶部行 (大号百分数) + ProgressBar (高 8px) + 底部行 (current/total + WS state).
 */

import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { Icon } from "@/components/ui/Icon";
import styles from "./RunPanel.module.css";

interface Progress {
  current: number;
  total: number;
  status: "running" | "completed" | "error";
  error: string | null;
}

interface Props {
  anchorId: string;
  stepBadge: string;
  canRun: boolean;
  isPending: boolean;
  isRunning: boolean;
  progress: Progress | null;
  connection: string;
  onRun: () => void;
  onOpenWorkbench: () => void;
}

export function RunPanel({
  anchorId,
  stepBadge,
  canRun,
  isPending,
  isRunning,
  progress,
  connection,
  onRun,
  onOpenWorkbench,
}: Props) {
  const pct =
    progress && progress.total > 0
      ? Math.round((progress.current / progress.total) * 100)
      : 0;

  return (
    <Card>
      <div id={anchorId} className={styles.cardHeader}>
        <span>{stepBadge} · 跑预标</span>
        {progress && (
          <span className={styles.wsBadge}>
            <Badge variant={progress.status === "error" ? "danger" : "ai"}>
              WS · {connection} · {progress.status}
            </Badge>
          </span>
        )}
      </div>
      <div className={styles.cardBody}>
        <div className={styles.actionRow}>
          <Button variant="ai" disabled={!canRun} onClick={onRun}>
            <Icon name={isPending || isRunning ? "loader2" : "wandSparkles"} size={14} className={isPending || isRunning ? "spin" : undefined} />{" "}
            {isPending ? "排队中…" : isRunning ? "推理中…" : "跑预标"}
          </Button>
        </div>

        {progress && (
          <div className={styles.progressStack}>
            <div className={styles.progressSummary}>
              <span className={styles.progressLabel}>批次进度</span>
              <span
                className={`${styles.progressPct} ${
                  progress.status === "error" ? styles.progressPctError : styles.progressPctAi
                }`}
              >
                {pct}%
              </span>
              <span className={styles.progressMeta}>
                {progress.current} / {progress.total} 张
              </span>
            </div>

            <ProgressBar value={pct} color="var(--color-ai)" />

            {progress.error && (
              <div className={styles.errorText}>
                {progress.error}
              </div>
            )}

            {progress.status === "completed" && (
              <div className={styles.completedRow}>
                <span className={styles.completedText}>
                  <Icon name="check" size={14} /> 已跑完，批次状态已转为 pre_annotated
                </span>
                <Button variant="ai" onClick={onOpenWorkbench}>
                  打开标注工作台 <Icon name="chevRight" size={12} />
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}
