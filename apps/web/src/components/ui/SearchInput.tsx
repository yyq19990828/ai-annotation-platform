import { Icon } from "./Icon";

interface SearchInputProps {
  placeholder?: string;
  value?: string;
  onChange?: (value: string) => void;
  width?: number;
  kbd?: string;
}

export function SearchInput({ placeholder = "搜索...", value, onChange, width = 240, kbd }: SearchInputProps) {
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "5px 10px",
        background: "var(--color-bg-elev)",
        border: "1px solid var(--color-border)",
        borderRadius: "var(--radius-md)",
        width,
      }}
    >
      <Icon name="search" size={13} style={{ color: "var(--color-fg-subtle)" }} />
      <input
        placeholder={placeholder}
        value={value}
        onChange={e => onChange?.(e.target.value)}
        style={{
          flex: 1,
          border: 0,
          outline: 0,
          background: "transparent",
          fontSize: 13,
          color: "inherit",
          minWidth: 0,
          fontFamily: "inherit",
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
