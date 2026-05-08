/**
 * v0.9.7 · Step 1: 项目 + 批次选择器.
 *
 * 仅做展示与 callback 上抛, 不持有任何状态. 由 AIPreAnnotatePage 编排
 * (项目→batch 联动 / backend 状态徽章源).
 */

import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import {
  cardBodyStyle,
  cardHeaderStyle,
  labelStyle,
  selectStyle,
  helperTextStyle,
  FS_XS,
} from "../styles";

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
      <div id={anchorId} style={{ ...cardHeaderStyle, scrollMarginTop: 80 }}>
        <span>{stepBadge} · 项目与批次</span>
      </div>
      <div style={cardBodyStyle}>
        <div>
          <label style={labelStyle}>项目（仅显示已启用 AI）</label>
          <select
            value={projectId}
            onChange={(e) => onProjectChange(e.target.value)}
            style={selectStyle}
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
            <div style={helperTextStyle}>暂无已启用 AI 的项目，先到项目设置开启。</div>
          )}
        </div>

        {projectId && (
          <div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 6,
              }}
            >
              <label style={{ ...labelStyle, marginBottom: 0 }}>批次（active 状态可预标）</label>
              {boundBackend ? (
                <Badge variant="success" style={{ fontSize: FS_XS }}>
                  backend: {boundBackend.name}
                </Badge>
              ) : (
                <Badge variant="danger" style={{ fontSize: FS_XS }}>
                  未绑定 ML Backend，请到项目设置配置
                </Badge>
              )}
            </div>
            {batches.length === 0 ? (
              <div style={{ ...helperTextStyle, padding: 8 }}>
                本项目暂无 active 批次（draft → active 转换后可见）
              </div>
            ) : (
              <select
                value={batchId}
                onChange={(e) => onBatchChange(e.target.value)}
                style={selectStyle}
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
