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
import {
  cardBodyStyle,
  cardHeaderStyle,
  helperTextStyle,
  FS_XS,
  FS_HUGE,
  FS_MD,
} from "../styles";

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
      <div id={anchorId} style={{ ...cardHeaderStyle, scrollMarginTop: 80 }}>
        <span>{stepBadge} · 跑预标</span>
        {progress && (
          <Badge variant={progress.status === "error" ? "danger" : "ai"} style={{ fontSize: 10 }}>
            WS · {connection} · {progress.status}
          </Badge>
        )}
      </div>
      <div style={cardBodyStyle}>
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <Button variant="ai" disabled={!canRun} onClick={onRun}>
            <Icon name={isPending || isRunning ? "loader2" : "wandSparkles"} size={14} className={isPending || isRunning ? "spin" : undefined} />{" "}
            {isPending ? "排队中…" : isRunning ? "推理中…" : "跑预标"}
          </Button>
        </div>

        {progress && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
              <span style={{ fontSize: FS_MD, fontWeight: 600 }}>批次进度</span>
              <span
                style={{
                  fontSize: FS_HUGE,
                  fontWeight: 700,
                  color: progress.status === "error" ? "var(--color-danger)" : "var(--color-ai)",
                  fontVariantNumeric: "tabular-nums",
                  lineHeight: 1,
                }}
              >
                {pct}%
              </span>
              <span style={{ ...helperTextStyle, marginTop: 0 }}>
                {progress.current} / {progress.total} 张
              </span>
            </div>

            <ProgressBar value={pct} color="var(--color-ai)" />

            {progress.error && (
              <div style={{ fontSize: FS_XS, color: "var(--color-danger)" }}>
                {progress.error}
              </div>
            )}

            {progress.status === "completed" && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  flexWrap: "wrap",
                  paddingTop: 4,
                }}
              >
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    fontSize: FS_MD,
                    color: "var(--color-success)",
                    fontWeight: 600,
                  }}
                >
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
