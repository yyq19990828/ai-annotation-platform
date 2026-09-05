import { useEffect, useReducer, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Search, X } from "lucide-react";
import type { ProjectRenderingConfig } from "@/api/projects";
import { Button } from "@/components/shadcn/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/shadcn/ui/dialog";
import { Empty, EmptyHeader, EmptyTitle } from "@/components/shadcn/ui/empty";
import { FieldGroup, FieldSet, FieldLegend } from "@/components/shadcn/ui/field";
import { Input } from "@/components/shadcn/ui/input";
import { Separator } from "@/components/shadcn/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/shadcn/ui/tabs";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import {
  SettingsFieldControl,
  type SettingsControlField,
} from "../components/SettingsFieldControl";
import type { StageKind } from "../stages/types";
import {
  WORKBENCH_SETTING_CATEGORY_LABELS,
  WORKBENCH_SETTING_SECTIONS,
  buildFieldPatch,
  filterWorkbenchSettings,
  getFieldValue,
  getVisibleWorkbenchSettingFields,
  isLocalSettingField,
  lockableFieldName,
  type WorkbenchSettingCategory,
  type WorkbenchSettingSection,
  type WorkbenchSettingValue,
} from "../state/workbenchSettingsFields";
import { useWorkbenchConfig } from "../state/useWorkbenchConfig";

interface WorkbenchSettingsDialogProps {
  open: boolean;
  onClose: () => void;
  stageKind: StageKind;
  projectRenderingConfig?: ProjectRenderingConfig | null;
  hideOrphanAnnotations?: boolean;
  onToggleHideOrphans?: () => void;
  secondaryBarHidden?: boolean;
  onToggleSecondaryBar?: () => void;
}

interface SettingsEntry extends SettingsControlField {
  category: WorkbenchSettingCategory;
  section?: WorkbenchSettingSection;
  parentKey?: string;
  value: WorkbenchSettingValue;
  locked?: boolean;
  disabled?: boolean;
  onCommit: (value: WorkbenchSettingValue) => void;
}

const CATEGORY_DESCRIPTIONS: Record<WorkbenchSettingCategory, string> = {
  common: "布局、标注外观和操作偏好。",
  image: "图像显示、绘制与 AI 辅助。",
  video: "播放、画布与轨迹操作。",
  pointcloud: "点云显示、相机视角和邻帧叠加。",
  experiment: "当前任务可用的本机选项，部分更改需要刷新后生效。",
};

export function WorkbenchSettingsDialog({
  open,
  onClose,
  stageKind,
  projectRenderingConfig,
  hideOrphanAnnotations,
  onToggleHideOrphans,
  secondaryBarHidden,
  onToggleSecondaryBar,
}: WorkbenchSettingsDialogProps) {
  // 保持 hook 挂载，关闭窗口不取消待发送的防抖保存。
  const { config, loaded, loadError, retryLoad, lockedFields, setFields } =
    useWorkbenchConfig(projectRenderingConfig);
  const [, refreshLocalFields] = useReducer((n: number) => n + 1, 0);
  const [category, setCategory] = useState<WorkbenchSettingCategory>("common");
  const [query, setQuery] = useState("");
  const contentRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const composingRef = useRef(false);
  const overlayPointerRef = useRef(false);
  const desktop = useMediaQuery("(min-width: 768px)");
  const visibleFields = getVisibleWorkbenchSettingFields(stageKind);
  const categories = [...new Set(visibleFields.map((field) => field.category))];
  const activeCategory = categories.includes(category) ? category : "common";

  useEffect(() => {
    if (!open) {
      setQuery("");
      composingRef.current = false;
    }
  }, [open]);

  const commitFocusedSetting = () => {
    const focused = document.activeElement;
    if (
      focused instanceof HTMLElement &&
      contentRef.current?.contains(focused) &&
      focused.closest('[data-testid^="setting-field-"]')
    )
      focused.blur();
  };
  const close = () => {
    commitFocusedSetting();
    onClose();
  };
  const changeCategory = (next: string) => {
    commitFocusedSetting();
    setCategory(next as WorkbenchSettingCategory);
    setQuery("");
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  };

  const entries: SettingsEntry[] = visibleFields.map((field) => {
    const lockName = lockableFieldName(field);
    const parent = visibleFields.find((candidate) => candidate.key === field.parentKey);
    return {
      ...field,
      value: getFieldValue(config, field),
      locked: lockName !== null && lockedFields.includes(lockName),
      disabled: parent ? !getFieldValue(config, parent) : false,
      onCommit: (value) => {
        if (isLocalSettingField(field)) {
          field.write(value);
          refreshLocalFields();
        } else setFields(buildFieldPatch(field, value));
      },
    };
  });
  if (onToggleHideOrphans)
    entries.push({
      key: "session.hideOrphans",
      category: "common",
      section: "behavior",
      label: "隐藏孤儿标注",
      description: "隐藏类别已从项目中删除的历史标注。仅本次工作台会话生效。",
      control: { type: "toggle" },
      value: hideOrphanAnnotations ?? false,
      onCommit: onToggleHideOrphans,
    });
  if (stageKind === "image" && onToggleSecondaryBar)
    entries.push({
      key: "ui.secondary_bar_hidden",
      category: "image",
      section: "ai",
      label: "二次推理面板",
      description: "选中标注时显示二次推理工具条，随账号同步。",
      control: { type: "toggle" },
      value: !(secondaryBarHidden ?? false),
      onCommit: onToggleSecondaryBar,
    });
  const searching = query.trim().length > 0;
  const results = searching
    ? filterWorkbenchSettings(entries, query)
    : entries.filter((field) => field.category === activeCategory);
  const resultCategories = searching ? categories : [activeCategory];

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
    >
      <DialogContent
        ref={contentRef}
        showCloseButton={false}
        aria-describedby={undefined}
        data-testid="workbench-settings-dialog"
        data-workbench-settings=""
        className="flex h-dvh max-h-dvh w-screen max-w-none flex-col gap-0 overflow-hidden rounded-none border-border bg-card p-0 text-foreground z-app-drawer sm:max-w-none md:h-[min(820px,85dvh)] md:max-h-[calc(100dvh-64px)] md:w-[min(1120px,calc(100vw-64px))] md:rounded-xl motion-reduce:animate-none"
        overlayProps={{
          className: "z-app-drawer-backdrop bg-black/25 motion-reduce:animate-none",
          "data-testid": "workbench-settings-overlay",
          "data-workbench-settings": "",
          onPointerDown: (event) => {
            overlayPointerRef.current = event.target === event.currentTarget;
          },
          onClick: (event) => {
            if (event.target === event.currentTarget && overlayPointerRef.current) {
              event.preventDefault();
              event.stopPropagation();
              overlayPointerRef.current = false;
              close();
            }
          },
        }}
        onPointerDownCapture={() => {
          overlayPointerRef.current = false;
        }}
        onPointerDownOutside={(event) => event.preventDefault()}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          returnFocusRef.current =
            document.activeElement instanceof HTMLElement ? document.activeElement : null;
          contentRef.current?.focus();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          const previous = returnFocusRef.current;
          const trigger =
            previous?.isConnected && previous !== document.body
              ? previous
              : document.querySelector<HTMLElement>('button[aria-label="工作台设置"]');
          trigger?.focus();
        }}
        onCompositionStart={() => {
          composingRef.current = true;
        }}
        onCompositionEnd={() => {
          composingRef.current = false;
        }}
        onEscapeKeyDown={(event) => {
          if (event.isComposing || composingRef.current) {
            event.preventDefault();
            return;
          }
          const focused = document.activeElement;
          if (
            focused instanceof HTMLSelectElement &&
            typeof CSS !== "undefined" &&
            CSS.supports("selector(:open)") &&
            focused.matches(":open")
          ) {
            // Radix 在捕获阶段处理 Esc；先关闭原生菜单，焦点留在该控件。
            event.preventDefault();
            focused.blur();
            focused.focus();
          }
        }}
      >
        <DialogTitle className="sr-only">工作台设置</DialogTitle>
        <Tabs
          value={activeCategory}
          onValueChange={changeCategory}
          orientation={desktop ? "vertical" : "horizontal"}
          className="min-h-0 flex-1 gap-0"
        >
          <aside className="flex shrink-0 flex-col gap-4 border-b border-border bg-muted/40 p-4 pt-[max(16px,env(safe-area-inset-top))] md:w-[220px] md:border-b-0 md:border-r md:pt-4">
            <Button variant="ghost" className="w-fit justify-start" onClick={close}>
              <ArrowLeft data-icon="inline-start" />
              返回工作台
            </Button>
            <div className="flex flex-col gap-2">
              <span className="text-sm font-semibold">工作台设置</span>
              <div className="relative">
                <Search
                  aria-hidden="true"
                  className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                />
                <Input
                  aria-label="搜索设置"
                  placeholder="搜索设置…"
                  value={query}
                  className="h-10 pl-9 pr-8"
                  onChange={(event) => {
                    setQuery(event.target.value);
                    if (scrollRef.current) scrollRef.current.scrollTop = 0;
                  }}
                />
                {query && (
                  <button
                    type="button"
                    aria-label="清空搜索"
                    onClick={() => setQuery("")}
                    className="absolute right-0 top-0 flex h-10 w-8 items-center justify-center rounded-md text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <X className="size-3.5" />
                  </button>
                )}
              </div>
            </div>
            <TabsList
              aria-label="设置分类"
              className="h-auto w-full justify-start gap-1 overflow-x-auto bg-transparent p-0 md:items-stretch"
            >
              {categories.map((item) => (
                <TabsTrigger
                  key={item}
                  value={item}
                  onClick={() => {
                    if (searching && item === activeCategory) changeCategory(item);
                  }}
                  className="h-10 flex-none px-3 transition-none data-[state=active]:bg-card data-[state=active]:shadow-none"
                >
                  {WORKBENCH_SETTING_CATEGORY_LABELS[item]}
                </TabsTrigger>
              ))}
            </TabsList>
            <footer className="mt-auto hidden flex-col gap-2 pt-6 md:flex">
              <Link
                to="/settings"
                onClick={close}
                className="text-xs text-muted-foreground hover:text-foreground hover:underline"
              >
                个人设置页 ↗
              </Link>
              <span className="text-xs text-muted-foreground">更改自动保存</span>
            </footer>
          </aside>
          <TabsContent value={activeCategory} className="m-0 flex min-h-0 min-w-0 flex-1 flex-col">
            <header className="flex shrink-0 items-start justify-between gap-4 border-b border-border px-4 py-5 md:px-8 md:py-6">
              <div className="flex min-w-0 flex-col gap-1">
                <h2 className="text-xl font-semibold">
                  {searching ? "搜索结果" : WORKBENCH_SETTING_CATEGORY_LABELS[activeCategory]}
                </h2>
                <p className="text-sm text-muted-foreground">
                  {searching ? "搜索当前任务可用的设置。" : CATEGORY_DESCRIPTIONS[activeCategory]}
                </p>
              </div>
              <Button variant="ghost" size="icon" aria-label="关闭设置" onClick={close}>
                <X />
              </Button>
            </header>
            <div
              ref={scrollRef}
              className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-2 md:px-8 md:py-4"
            >
              {!loaded ? (
                <p role="status" className="py-8 text-sm text-muted-foreground">
                  正在加载设置…
                </p>
              ) : loadError ? (
                <Empty>
                  <EmptyHeader>
                    <EmptyTitle>无法加载设置</EmptyTitle>
                  </EmptyHeader>
                  <Button variant="outline" onClick={retryLoad}>
                    重试
                  </Button>
                </Empty>
              ) : !results.length ? (
                <Empty>
                  <EmptyHeader>
                    <EmptyTitle>没有找到相关设置</EmptyTitle>
                  </EmptyHeader>
                  <Button variant="outline" onClick={() => setQuery("")}>
                    清空搜索
                  </Button>
                </Empty>
              ) : (
                resultCategories.map((resultCategory) => {
                  const sections = (
                    Object.keys(WORKBENCH_SETTING_SECTIONS) as WorkbenchSettingSection[]
                  )
                    .map((section) => ({
                      section,
                      fields: results.filter(
                        (field) => field.category === resultCategory && field.section === section,
                      ),
                    }))
                    .filter(({ fields }) => fields.length);
                  return sections.map(({ section, fields }, index) => (
                    <FieldSet key={`${resultCategory}.${section}`} className="gap-0 py-3">
                      <FieldLegend variant="label" className="mb-0 text-md">
                        {searching ? `${WORKBENCH_SETTING_CATEGORY_LABELS[resultCategory]} / ` : ""}
                        {WORKBENCH_SETTING_SECTIONS[section]}
                      </FieldLegend>
                      <FieldGroup className="gap-0">
                        {fields.map((entry) => (
                          <SettingsFieldControl
                            key={entry.key}
                            layout="settings"
                            field={entry}
                            value={entry.value}
                            locked={entry.locked}
                            disabled={entry.disabled}
                            nested={!!entry.parentKey}
                            onCommit={entry.onCommit}
                          />
                        ))}
                      </FieldGroup>
                      {index < sections.length - 1 && <Separator className="mt-3" />}
                    </FieldSet>
                  ));
                })
              )}
            </div>
            <footer className="flex shrink-0 justify-between border-t border-border px-4 py-3 pb-[max(12px,env(safe-area-inset-bottom))] text-xs text-muted-foreground md:hidden">
              <span>更改自动保存</span>
              <Link to="/settings" onClick={close}>
                个人设置页 ↗
              </Link>
            </footer>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
