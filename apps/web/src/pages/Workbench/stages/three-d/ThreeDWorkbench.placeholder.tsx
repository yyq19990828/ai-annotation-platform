import { Icon } from "@/components/ui/Icon";

export function ThreeDWorkbenchPlaceholder() {
  return (
    <div
      data-testid="three-d-workbench-placeholder"
      style={{
        flex: 1,
        minHeight: 0,
        display: "grid",
        placeItems: "center",
        background: "var(--color-bg-sunken)",
        color: "var(--color-fg-muted)",
      }}
    >
      <div style={{ display: "grid", justifyItems: "center", gap: 8 }}>
        <Icon name="box" size={32} />
        <div style={{ fontSize: 13 }}>3D 标注工作台暂未启用</div>
      </div>
    </div>
  );
}
