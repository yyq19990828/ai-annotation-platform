// v0.10.14 · E2 · 模板库列表页. 三个 tab (我的 / 组织 / 公共), 搜索 + type
// filter, 卡片列表. 操作: 应用 (跳 Wizard with template_id) / 克隆 / 编辑 / 删除.
// 新建入口: + 新建模板 (空白) / 从已有项目导出.

import { lazy, Suspense, useMemo, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { SearchInput } from "@/components/ui/SearchInput";
import { TabRow } from "@/components/ui/TabRow";
import { useToastStore } from "@/components/ui/Toast";
import { useAuthStore } from "@/stores/authStore";
import {
  useDeleteProjectTemplate,
  useDuplicateProjectTemplate,
  useProjectTemplates,
} from "@/hooks/useProjectTemplates";
import type { ProjectTemplateOut, TemplateScope } from "@/api/projectTemplates";

import { CreateFromProjectDialog } from "./CreateFromProjectDialog";
import { TemplateCard } from "./TemplateCard";
import { TemplateEditModal } from "./TemplateEditModal";
import styles from "./ProjectTemplatesPage.module.css";

const CreateProjectWizard = lazy(() =>
  import("@/components/projects/CreateProjectWizard").then((m) => ({
    default: m.CreateProjectWizard,
  })),
);

const TABS = ["我的模板", "组织模板", "公共模板", "全部"] as const;
type TabLabel = (typeof TABS)[number];

const SCOPE_BY_TAB: Record<TabLabel, TemplateScope | undefined> = {
  我的模板: "private",
  组织模板: "organization",
  公共模板: "public",
  全部: undefined,
};

export function ProjectTemplatesPage() {
  const pushToast = useToastStore((s) => s.push);
  const me = useAuthStore((s) => s.user);
  const [activeTab, setActiveTab] = useState<TabLabel>("我的模板");
  const [search, setSearch] = useState("");
  const [editTarget, setEditTarget] = useState<ProjectTemplateOut | undefined>();
  const [editOpen, setEditOpen] = useState(false);
  const [fromProjectOpen, setFromProjectOpen] = useState(false);
  const [applyTemplateId, setApplyTemplateId] = useState<string | null>(null);

  const scopeFilter = SCOPE_BY_TAB[activeTab];
  const list = useProjectTemplates(
    scopeFilter
      ? { scope: scopeFilter, search: search || undefined }
      : { search: search || undefined },
  );
  const remove = useDeleteProjectTemplate();
  const duplicate = useDuplicateProjectTemplate();

  const templates = useMemo(() => list.data ?? [], [list.data]);

  const handleApply = (t: ProjectTemplateOut) => {
    setApplyTemplateId(t.id);
  };

  const handleDuplicate = (t: ProjectTemplateOut) => {
    duplicate.mutate(t.id, {
      onSuccess: () => pushToast({ msg: "已克隆模板", kind: "success" }),
      onError: (err) =>
        pushToast({
          msg: err instanceof Error ? err.message : "克隆失败",
          kind: "warning",
        }),
    });
  };

  const handleEdit = (t: ProjectTemplateOut) => {
    setEditTarget(t);
    setEditOpen(true);
  };

  const handleDelete = (t: ProjectTemplateOut) => {
    if (
      !confirm(
        `确定删除模板「${t.name}」?\n已使用 ${t.usage_count} 次, 删除不会影响历史已创建的项目.`,
      )
    ) {
      return;
    }
    remove.mutate(t.id, {
      onSuccess: () => pushToast({ msg: "已删除", kind: "success" }),
      onError: (err) =>
        pushToast({
          msg: err instanceof Error ? err.message : "删除失败",
          kind: "warning",
        }),
    });
  };

  const openNew = () => {
    setEditTarget(undefined);
    setEditOpen(true);
  };

  const isSuperAdmin = me?.role === "super_admin";

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h2 className={styles.title}>项目模板库</h2>
          <p className={styles.titleHint}>
            v0.10.14 · 模板是独立资产, 应用模板时把字段复制进新项目; 后续修改模板不影响已有项目.
            与"从已有项目复制"功能并存.
          </p>
        </div>
        <div className={styles.toolbar}>
          <Button onClick={openNew} data-testid="template-new-btn">
            <Icon name="plus" size={12} /> 新建模板
          </Button>
          <Button variant="ghost" onClick={() => setFromProjectOpen(true)}>
            <Icon name="copy" size={12} /> 从已有项目导出
          </Button>
        </div>
      </div>

      <div className={styles.toolbar}>
        <TabRow tabs={[...TABS]} active={activeTab} onChange={(t) => setActiveTab(t as TabLabel)} />
        <div className={styles.grow} />
        <SearchInput value={search} onChange={setSearch} placeholder="搜索模板名称…" width={220} />
      </div>

      {list.isLoading ? (
        <div className={styles.empty}>加载中…</div>
      ) : templates.length === 0 ? (
        <div className={styles.empty}>
          暂无模板
          {activeTab === "我的模板" ? "，点击「新建模板」开始" : ""}
        </div>
      ) : (
        <div className={styles.grid}>
          {templates.map((t) => (
            <TemplateCard
              key={t.id}
              template={t}
              canEdit={isSuperAdmin || t.created_by === me?.id}
              onApply={() => handleApply(t)}
              onDuplicate={() => handleDuplicate(t)}
              onEdit={() => handleEdit(t)}
              onDelete={() => handleDelete(t)}
            />
          ))}
        </div>
      )}

      <TemplateEditModal open={editOpen} onClose={() => setEditOpen(false)} initial={editTarget} />

      <CreateFromProjectDialog open={fromProjectOpen} onClose={() => setFromProjectOpen(false)} />

      <Suspense fallback={null}>
        {applyTemplateId ? (
          <CreateProjectWizard
            open
            onClose={() => setApplyTemplateId(null)}
            templateId={applyTemplateId}
          />
        ) : null}
      </Suspense>
    </div>
  );
}
