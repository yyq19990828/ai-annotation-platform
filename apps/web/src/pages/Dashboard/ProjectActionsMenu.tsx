// v0.10.54 · 项目操作 ⋮ 菜单 — 列表视图 / 网格视图共享, 统一可做的操作.
//
// B-47 · 「打开」「设置」已提升为行内直接按钮; 导出从独立包装器收进本菜单
// (菜单含 导出 / 复制 / 导入 / 清理 …)。卡片为 [设置] [⋮] [打开]; 列表 ⋮ 收到末位 [设置] [打开] [⋮]。
// 导出对任何能看到该行的人可见; 复制 / 导入 / 清理 / 导入标注 仅 canManage 可见。
// 自管导出 / 导入向导状态与"复制"跳转, 调用方只需传 project / canManage。

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
import { ExportModal } from "./ExportSection";
import type { ProjectResponse } from "@/api/projects";

export function ProjectActionsMenu({
  project,
  canManage,
}: {
  project: ProjectResponse;
  canManage: boolean;
}) {
  const navigate = useNavigate();
  const [importTarget, setImportTarget] = useState<ImportTarget | null>(null);
  const [purgeOpen, setPurgeOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);

  const items: DropdownItem[] = [
    {
      id: "export",
      label: "导出标注数据",
      icon: "download",
      onSelect: () => setExportOpen(true),
    },
    ...(canManage
      ? ([
          { id: "div-0", divider: true, label: "" },
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
        ] as DropdownItem[])
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
      <ExportModal
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        projectId={project.id}
        projectTypeKey={project.type_key}
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
