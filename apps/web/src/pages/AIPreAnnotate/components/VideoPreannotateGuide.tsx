/**
 * v0.10.38 · 视频项目的 AI 预标引导卡片 (epic 阶段 2).
 *
 * 视频 AI 预标无批量文本派发语义——追踪在工作台逐轨迹用 Shift+T 发起 (VideoTrackerJob)。
 * 故视频项目进 /ai-pre 不渲染图像批量面板, 改为引导 + 跳工作台 + 视频 job 历史链接。
 */

import { useNavigate } from "react-router-dom";

import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Icon } from "@/components/ui/Icon";
import styles from "./ProjectDetailPanel.module.css";

export function VideoPreannotateGuide({
  projectId,
  projectName,
  displayId,
  onBack,
}: {
  projectId: string;
  projectName: string;
  displayId?: string | null;
  onBack: () => void;
}) {
  const navigate = useNavigate();

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <Button size="sm" variant="ghost" onClick={onBack}>
          <Icon name="chevLeft" size={11} /> 返回项目列表
        </Button>
        <h2 className={styles.title}>{projectName}</h2>
        {displayId && <span className={styles.displayId}>({displayId})</span>}
        <Badge variant="ai">视频</Badge>
      </div>

      <Card>
        <div className={styles.runPanel}>
          <strong className={styles.sectionTitle}>视频 AI 预标在工作台发起</strong>
          <div className={styles.mutedText}>
            视频项目的 AI 预标是<strong>逐轨迹</strong>的追踪任务（不是整批文本检测）：在工作台打开视频任务，
            选中一条轨迹后按 <span className="mono">Shift+T</span> 发起 tracker 传播（可选模型 / 尺寸 / 帧范围 / 方向）。
            追踪任务的进度与历史在下方「视频 job 历史」查看。
          </div>
          <div className={styles.actions}>
            <Button
              onClick={() => navigate(`/projects/${projectId}/settings?section=batches`)}
              title="打开项目，进入视频任务标注"
            >
              <Icon name="video" size={12} /> 去工作台标注视频
            </Button>
            <Button
              variant="ghost"
              onClick={() =>
                navigate(`/ai-pre/jobs?tab=video&project_id=${projectId}`)
              }
              title="本项目视频追踪 job 历史"
            >
              <Icon name="history" size={11} /> 视频 job 历史
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
