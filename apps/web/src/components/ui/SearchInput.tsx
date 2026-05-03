import { Icon } from "./Icon";

interface SearchInputProps {
  placeholder?: string;
  value?: string;
  onChange?: (value: string) => void;
  width?: number;
  kbd?: string;
  /** v0.7.2 · TopBar 用作 ⌘K palette 触发；点击外壳即调用 onClick。 */
  onClick?: () => void;
  /** v0.7.2 · 与 onClick 配合：只读，避免 input 拿到焦点抢键盘事件。 */
  readOnly?: boolean;
}

export function SearchInput({
  placeholder = "搜索...",
  value,
  onChange,
  width = 240,
  kbd,
  onClick,
  readOnly,
}: SearchInputProps) {
  return (
    <div
      onClick={onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "5px 10px",
        background: "var(--color-bg-elev)",
        border: "1px solid var(--color-border)",
        borderRadius: "var(--radius-md)",
        width,
        cursor: onClick ? "pointer" : undefined,
      }}
    >
      <Icon name="search" size={13} style={{ color: "var(--color-fg-subtle)" }} />
      <input
        placeholder={placeholder}
        value={value}
        onChange={e => onChange?.(e.target.value)}
        readOnly={readOnly}
        style={{
          flex: 1,
          border: 0,
          outline: 0,
          background: "transparent",
          fontSize: 13,
          color: "inherit",
          minWidth: 0,
          fontFamily: "inherit",
          cursor: onClick ? "pointer" : undefined,
        }}
      />
      {kbd && (
        <span
          style={{
            display: "inline-block",
            padding: "1px 5px",
            background: "var(--color-bg-sunken)",
            border: "1px solid var(--color-border)",
            borderBottomWidth: 2,
            borderRadius: 3,
            fontFamily: "var(--font-mono)",
            fontSize: 10.5,
            color: "var(--color-fg-muted)",
            lineHeight: 1,
          }}
        >
          {kbd}
        </span>
      )}
    </div>
  );
}
