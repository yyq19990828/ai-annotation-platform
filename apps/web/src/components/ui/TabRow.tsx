interface TabRowProps {
  tabs: string[];
  active: string;
  onChange: (tab: string) => void;
}

export function TabRow({ tabs, active, onChange }: TabRowProps) {
  return (
    <div
      style={{
        display: "inline-flex",
        background: "var(--color-bg-sunken)",
        borderRadius: "var(--radius-md)",
        padding: 2,
      }}
    >
      {tabs.map(t => (
        <button
          key={t}
          onClick={() => onChange(t)}
          style={{
            border: 0,
            background: active === t ? "var(--color-bg-elev)" : "transparent",
            padding: "4px 12px",
            borderRadius: 4,
            fontSize: 12,
            color: active === t ? "var(--color-fg)" : "var(--color-fg-muted)",
            fontWeight: 500,
            cursor: "pointer",
            fontFamily: "inherit",
            boxShadow: active === t ? "var(--shadow-sm)" : "none",
          }}
        >
          {t}
        </button>
      ))}
    </div>
  );
}
