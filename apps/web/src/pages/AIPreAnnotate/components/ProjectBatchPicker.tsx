/**
 * v0.9.7 · Step 1: 项目 + 批次选择器.
 *
 * 仅做展示与 callback 上抛, 不持有任何状态. 由 AIPreAnnotatePage 编排
 * (项目→batch 联动 / backend 状态徽章源).
 */

import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import styles from "./ProjectBatchPicker.module.css";

interface ProjectOption {
  id: string;
  display_id: string;
  name: string;
  type_label: string;
}

interface BatchOption {
  id: string;
  display_id: string;
  name: string;
  total_tasks?: number | null;
}

interface BackendInfo {
  id: string;
  name: string;
}

interface Props {
  anchorId: string;
  projects: ProjectOption[];
  projectsLoading: boolean;
  projectId: string;
  onProjectChange: (id: string) => void;

  batches: BatchOption[];
  batchId: string;
  onBatchChange: (id: string) => void;

  boundBackend: BackendInfo | null;
  stepBadge: string;
}

export function ProjectBatchPicker({
  anchorId,
  projects,
  projectsLoading,
  projectId,
  onProjectChange,
  batches,
  batchId,
  onBatchChange,
  boundBackend,
  stepBadge,
}: Props) {
  return (
    <Card>
      <div id={anchorId} className={styles.cardHeader}>
        <span>{stepBadge} · 项目与批次</span>
      </div>
      <div className={styles.cardBody}>
        <div>
          <label className={styles.label}>项目（仅显示已启用 AI）</label>
          <select
            value={projectId}
            onChange={(e) => onProjectChange(e.target.value)}
            className={styles.select}
            disabled={projectsLoading}
          >
            <option value="">-- 请选择 --</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.display_id} · {p.name} ({p.type_label})
              </option>
            ))}
          </select>
          {projects.length === 0 && !projectsLoading && (
            <div className={styles.helperText}>暂无已启用 AI 的项目，先到项目设置开启。</div>
          )}
        </div>

        {projectId && (
          <div>
            <div className={styles.batchHeader}>
              <label className={`${styles.label} ${styles.batchLabel}`}>批次（active 状态可预标）</label>
              {boundBackend ? (
                <span className={styles.backendBadge}>
                  <Badge variant="success">backend: {boundBackend.name}</Badge>
                </span>
              ) : (
                <span className={styles.backendBadge}>
                  <Badge variant="danger">未绑定 ML Backend，请到项目设置配置</Badge>
                </span>
              )}
            </div>
            {batches.length === 0 ? (
              <div className={styles.emptyBatchHint}>
                本项目暂无 active 批次（draft → active 转换后可见）
              </div>
            ) : (
              <select
                value={batchId}
                onChange={(e) => onBatchChange(e.target.value)}
                className={styles.select}
              >
                <option value="">-- 请选择 --</option>
                {batches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.display_id} · {b.name} （共 {b.total_tasks ?? 0} 张）
                  </option>
                ))}
              </select>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}
