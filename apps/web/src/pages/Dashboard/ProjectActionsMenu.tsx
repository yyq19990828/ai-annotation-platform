// v0.10.54 · 项目操作 ⋮ 菜单 — 列表视图 / 网格视图共享, 统一可做的操作.
//
// 菜单项: 项目设置 / 复制项目配置 / 导入预测 / 导入标注 (均 canManage 可见).
// 导出走独立的 <ExportSection/> (v0.10.43 多目标 modal), 不放进本菜单.
// 自管导入向导状态与"复制"跳转, 调用方只需传 project / canManage / onSettings.

import { useState, type Ref } from "react";
import { useNavigate } from "react-router-dom";

import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { DropdownMenu, type DropdownItem } from "@/components/ui/DropdownMenu";
import {
  PredictionImportWizard,
  type ImportTarget,
} from "@/components/predictions/PredictionImportWizard";
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
      id: "import-annotations",
      label: "导入标注",
      icon: "upload",
      onSelect: () => setImportTarget("annotations"),
    },
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
      {importTarget && (
        <PredictionImportWizard
          open
          key={importTarget}
          projectId={project.id}
          initialTarget={importTarget}
          onClose={() => setImportTarget(null)}
        />
      )}
    </>
  );
}
