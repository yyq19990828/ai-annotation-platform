// v0.10.54 · 项目操作 ⋮ 菜单 — 列表视图 / 网格视图共享, 统一可做的操作.
//
// 菜单项: 项目设置 / 复制项目配置 / 导入预测 / 清理预测 / 导入标注 (均 canManage 可见).
// 导出走独立的 <ExportSection/> (v0.10.43 多目标 modal), 不放进本菜单.
// 自管导入向导状态与"复制"跳转, 调用方只需传 project / canManage / onSettings.

import { useState, type Ref } from "react";
import type { Dispatch, SetStateAction } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { DropdownMenu, type DropdownItem } from "@/components/ui/DropdownMenu";
import {
  PredictionImportWizard,
  ANNOTATIONS_IMPORT_ENABLED,
  type ImportTarget,
} from "@/components/predictions/PredictionImportWizard";
import { PredictionPurgeModal } from "@/components/predictions/PredictionPurgeModal";
import type { ProjectResponse } from "@/api/projects";

export function ProjectActionsMenu({
  project,
  canManage,
  onSettings,
}: {
  project: ProjectResponse;
  canManage: boolean;
  onSettings: (p: ProjectResponse, section?: string) => void;
}) {
  const navigate = useNavigate();
  const [importTarget, setImportTarget] = useState<ImportTarget | null>(null);
  const [purgeOpen, setPurgeOpen] = useState(false);

  if (!canManage) return null;

  const items: DropdownItem[] = [
    {
      id: "settings",
      label: "项目设置",
      icon: "settings",
      onSelect: () => onSettings(project),
    },
    {
      id: "duplicate",
      label: "复制项目配置",
      icon: "copy",
      // v0.10.11 · 跳 Dashboard 并打开 Wizard 复制流 (携带 ?from=<id> 预填).
      onSelect: () => navigate(`/dashboard?new=1&from=${project.id}`),
    },
    { id: "div-1", divider: true, label: "" },
    {
      id: "import-predictions",
      label: "导入预测",
      icon: "upload",
      onSelect: () => setImportTarget("predictions"),
    },
    {
      id: "purge-predictions",
      label: "清理预测",
      icon: "trash",
      onSelect: () => setPurgeOpen(true),
    },
    // v0.10.54 · 标注导入入口暂隐 (后端已就绪, ANNOTATIONS_IMPORT_ENABLED 控制)。
    ...(ANNOTATIONS_IMPORT_ENABLED
      ? [
          {
            id: "import-annotations",
            label: "导入标注",
            icon: "upload" as const,
            onSelect: () => setImportTarget("annotations"),
          },
        ]
      : []),
  ];

  return (
    <>
      <DropdownMenu
        minWidth={180}
        items={items}
        trigger={({ open, toggle, ref }) => (
          <Button
            ref={ref as Ref<HTMLButtonElement>}
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              toggle();
            }}
            aria-haspopup="menu"
            aria-expanded={open}
            title="更多操作"
          >
            <Icon name="more" size={11} />
          </Button>
        )}
      />
      {(importTarget || purgeOpen) && (
        <ProjectActionModals
          projectId={project.id}
          importTarget={importTarget}
          setImportTarget={setImportTarget}
          purgeOpen={purgeOpen}
          setPurgeOpen={setPurgeOpen}
        />
      )}
    </>
  );
}

function ProjectActionModals({
  projectId,
  importTarget,
  setImportTarget,
  purgeOpen,
  setPurgeOpen,
}: {
  projectId: string;
  importTarget: ImportTarget | null;
  setImportTarget: Dispatch<SetStateAction<ImportTarget | null>>;
  purgeOpen: boolean;
  setPurgeOpen: Dispatch<SetStateAction<boolean>>;
}) {
  const qc = useQueryClient();
  const invalidateProjectData = () => {
    qc.invalidateQueries({ queryKey: ["projects"] });
    qc.invalidateQueries({ queryKey: ["project", projectId] });
    qc.invalidateQueries({ queryKey: ["project-stats"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
  };

  return (
    <>
      {importTarget && (
        <PredictionImportWizard
          open
          key={importTarget}
          projectId={projectId}
          initialTarget={importTarget}
          onClose={() => setImportTarget(null)}
          onComplete={invalidateProjectData}
        />
      )}
      {purgeOpen && (
        <PredictionPurgeModal
          open
          projectId={projectId}
          onClose={() => setPurgeOpen(false)}
          onComplete={invalidateProjectData}
        />
      )}
    </>
  );
}
