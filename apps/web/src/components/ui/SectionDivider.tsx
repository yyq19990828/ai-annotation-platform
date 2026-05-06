interface SectionDividerProps {
  label: string;
  hint?: string;
}

export function SectionDivider({ label, hint }: SectionDividerProps) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        margin: "20px 0 8px",
      }}
    >
      <span
        style={{
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: "0.06em",
          color: "var(--color-fg-muted)",
          textTransform: "uppercase",
        }}
      >
        {label}
      </span>
      {hint && (
        <span style={{ fontSize: 11, color: "var(--color-fg-subtle)" }}>{hint}</span>
      )}
      <span
        style={{
          flex: 1,
          height: 1,
          background: "var(--color-border)",
        }}
      />
    </div>
  );
}
