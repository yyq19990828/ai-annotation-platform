/**
 * v0.9.12 · /ai-pre 信息架构重构 (BUG B-17).
 *
 * 主视图: 项目卡片网格 (仅接了 ml_backend 的项目) → 点卡片进 ProjectDetailPanel.
 * ProjectDetailPanel 内: 多选 batch + 串/并行预标 + 已就绪 HistoryTable (含多选清理).
 *
 * 之前 v0.9.7 拆出的 6 个子组件 (PreannotateStepper / ProjectBatchPicker /
 * PromptComposer / OutputModeSelector / RunPanel / HistoryTable) 中:
 *   - HistoryTable 在 ProjectDetailPanel 内继续渲染
 *   - 其余 4 个 (Stepper / ProjectBatchPicker / PromptComposer / RunPanel) 暂保留文件,
 *     等 v0.9.13+ 「精细单批次模式」回归时复用 (走 modal 入口); 主页不再引用.
 *   - OutputModeSelector 仍被旧 stepper 使用; ProjectDetailPanel 用 inline 简化版.
 *
 * 旧版本 478 行单文件 + 内嵌 FailedPredictionsTab (B-2) 一并清理 → /ai-pre/jobs?status=failed.
 */

import { useMemo, useState } from "react";

import { ProjectCardGrid } from "./components/ProjectCardGrid";
import { ProjectDetailPanel } from "./components/ProjectDetailPanel";
import { useAIPreProjectSummary } from "@/hooks/useBulkPreannotateActions";
import {
  PAGE_PADDING_X,
  PAGE_PADDING_Y,
  SECTION_GAP,
  FS_SM,
  FS_XL,
} from "./styles";

export default function AIPreAnnotatePage() {
  const summaryQ = useAIPreProjectSummary();
  const items = summaryQ.data?.items ?? [];

  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);

  const selectedSummary = useMemo(
    () => items.find((it) => it.project_id === selectedProjectId),
    [items, selectedProjectId],
  );

  return (
    <div
      style={{
        padding: `${PAGE_PADDING_Y}px ${PAGE_PADDING_X}px`,
        display: "flex",
        flexDirection: "column",
        gap: SECTION_GAP,
      }}
    >
      <header>
        <h1 style={{ fontSize: FS_XL, fontWeight: 600, margin: 0 }}>AI 文本批量预标</h1>
        <p style={{ fontSize: FS_SM, color: "var(--color-fg-muted)", marginTop: 4 }}>
          先选项目（仅展示已绑定 ML backend 的项目），再多选批次跑预标。跑完后批次自动转 pre_annotated 等待人工接管。
        </p>
      </header>

      {selectedProjectId ? (
        <ProjectDetailPanel
          projectId={selectedProjectId}
          summary={selectedSummary}
          onBack={() => setSelectedProjectId(null)}
        />
      ) : (
        <ProjectCardGrid
          items={items}
          isLoading={summaryQ.isLoading}
          onSelect={setSelectedProjectId}
        />
      )}
    </div>
  );
}
