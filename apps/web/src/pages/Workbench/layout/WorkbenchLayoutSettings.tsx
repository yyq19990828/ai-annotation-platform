import type { CSSProperties } from "react";
import type { DropdownItem } from "@/components/ui/DropdownMenu";
import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/utils";
import {
  createWorkspacePreset,
  WORKSPACE_PRESETS,
  type ActiveWorkspacePreset,
} from "./workbenchLayoutPresets";
import { PANEL_TITLES, type WorkspaceNode } from "./workbenchLayoutSnapshot";

function PreviewNode({ node, horizontal }: { node: WorkspaceNode; horizontal: boolean }) {
  if (node.type === "leaf") {
    if (node.data.id === "parking" || node.visible === false) return null;
    const panel = node.data.activeView ?? node.data.views[0];
    return (
      <span
        // eslint-disable-next-line no-restricted-syntax -- Preview weights come from the preset tree.
        style={{ "--preview-flex": `${node.size || 1} 1 0%` } as CSSProperties}
        className={`flex flex-[var(--preview-flex)] min-h-0 min-w-0 items-center justify-center rounded-sm border p-1 text-2xs ${panel === "canvas" ? "border-brand/30 bg-brand/10 text-brand" : "border-border bg-muted text-muted-foreground"}`}
      >
        {PANEL_TITLES[panel]}
      </span>
    );
  }
  return (
    <span
      // eslint-disable-next-line no-restricted-syntax -- Preview weights come from the preset tree.
      style={{ "--preview-flex": `${node.size || 1} 1 0%` } as CSSProperties}
      className={`flex flex-[var(--preview-flex)] min-h-0 min-w-0 gap-1 ${horizontal ? "flex-row" : "flex-col"}`}
    >
      {node.data.map((child, index) => (
        <PreviewNode key={index} node={child} horizontal={!horizontal} />
      ))}
    </span>
  );
}

export function WorkbenchLayoutSettings({
  items,
  activePreset,
}: {
  items: DropdownItem[];
  activePreset: ActiveWorkspacePreset;
}) {
  const presets = WORKSPACE_PRESETS.filter((preset) => items.some((item) => item.id === preset.id));
  const panels = items.filter((item) => item.id in PANEL_TITLES);
  const tools = items.filter(
    (item) =>
      item.id.startsWith("3d-") || item.id === "camera-presentation" || item.id === "reset-cameras",
  );
  const reset = items.find((item) => item.id === "reset");
  const card = (selected: boolean) =>
    cn(
      "relative flex min-w-0 flex-col gap-3 rounded-lg border p-3 text-left",
      selected ? "border-brand bg-brand/5 ring-1 ring-brand" : "border-border bg-card",
    );
  const selection = (selected: boolean) => (
    <span
      aria-hidden="true"
      className={cn(
        "flex size-4 shrink-0 items-center justify-center rounded-full border",
        selected ? "border-brand bg-brand text-primary-foreground" : "border-border",
      )}
    >
      {selected && <Icon name="check" size={11} />}
    </span>
  );
  return (
    <section aria-label="工作台布局" className="space-y-5 border-b border-border py-4">
      <div>
        <h3 className="text-md font-medium">布局预设</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          高亮项为当前布局。拖动面板可自由调整，切换预设后可撤销。
        </p>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {presets.map((preset) => {
          const item = items.find((item) => item.id === preset.id)!;
          const snapshot = createWorkspacePreset(preset.id);
          const selected = activePreset === preset.id;
          return (
            <button
              key={preset.id}
              type="button"
              aria-pressed={selected}
              disabled={item.disabled}
              onClick={item.onSelect}
              className={cn(
                card(selected),
                "hover:border-brand active:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
              )}
            >
              <span aria-hidden="true" className="flex h-24 w-full gap-1">
                {preset.id === "focus" ? (
                  <span className="flex flex-1 items-center justify-center rounded-sm border border-brand/30 bg-brand/10 text-xs text-brand">
                    画布
                  </span>
                ) : (
                  <PreviewNode
                    node={snapshot.layout.grid.root}
                    horizontal={snapshot.layout.grid.orientation === "HORIZONTAL"}
                  />
                )}
              </span>
              <span className="flex w-full items-center justify-between gap-2 text-sm font-medium">
                {preset.title}
                {selection(selected)}
              </span>
            </button>
          );
        })}
        <div
          aria-label="自定义布局"
          aria-current={activePreset === "custom" ? "true" : undefined}
          className={card(activePreset === "custom")}
        >
          <span
            aria-hidden="true"
            className="flex h-24 items-center justify-center rounded-md border border-dashed border-border bg-muted/30 text-muted-foreground"
          >
            <Icon name="grid" size={28} />
          </span>
          <span className="flex items-center justify-between gap-2 text-sm font-medium">
            自定义布局{selection(activePreset === "custom")}
          </span>
          <p className="text-xs text-muted-foreground">面板排列或显隐不匹配预设时自动选中</p>
        </div>
      </div>
      <details className="group border-t border-border pt-3">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-md py-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
          <span>面板与高级布局</span>
          <span className="flex items-center gap-2 text-xs font-normal text-muted-foreground">
            {panels.filter((item) => item.active).length} / {panels.length} 已显示
            <Icon name="chevDown" size={14} className="group-open:rotate-180" />
          </span>
        </summary>
        <div className="space-y-4 pt-2">
          <div className="grid grid-cols-1 gap-x-5 sm:grid-cols-2">
            {panels.map((item) => (
              <button
                key={item.id}
                type="button"
                aria-label={typeof item.label === "string" ? item.label : undefined}
                aria-pressed={!!item.active}
                disabled={item.disabled}
                onClick={item.onSelect}
                className="flex min-w-0 items-center gap-2.5 rounded-md px-2 py-2.5 text-left text-sm hover:bg-accent active:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
              >
                <Icon
                  name={item.active ? "eye" : "eyeOff"}
                  size={15}
                  className={item.active ? "text-brand" : "text-muted-foreground"}
                />
                <span className="flex-1">{item.label}</span>
                <span className="text-xs text-muted-foreground">
                  {item.active ? "已显示" : "已隐藏"}
                </span>
              </button>
            ))}
          </div>
          {tools.length > 0 && (
            <div className="space-y-2 border-t border-border pt-3">
              <p className="text-xs text-muted-foreground">点云视图</p>
              <div className="flex flex-wrap gap-2">
                {tools.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    disabled={item.disabled}
                    onClick={item.onSelect}
                    className="rounded-md bg-muted px-3 py-2 text-xs hover:bg-accent active:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
          )}
          {reset && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
              <p className="text-xs text-muted-foreground">恢复默认面板排列</p>
              <button
                type="button"
                disabled={reset.disabled}
                onClick={reset.onSelect}
                className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground active:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
              >
                <Icon name="rotate-ccw" size={13} />
                {reset.label}
              </button>
            </div>
          )}
        </div>
      </details>
    </section>
  );
}
