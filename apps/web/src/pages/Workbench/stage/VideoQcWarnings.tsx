interface VideoQcWarningsProps {
  warnings: string[];
}

export function VideoQcWarnings({ warnings }: VideoQcWarningsProps) {
  if (warnings.length === 0) return null;

  return (
    <div
      data-testid="video-qc-warnings"
      style={{
        position: "absolute",
        top: 14,
        left: 14,
        display: "grid",
        gap: 4,
        maxWidth: "min(520px, calc(100% - 28px))",
        color: "var(--color-warning)",
        fontSize: 12,
        pointerEvents: "none",
        zIndex: 5,
      }}
    >
      {warnings.map((w) => (
        <div key={w} style={{ padding: "4px 8px", background: "rgba(0,0,0,0.68)", borderRadius: 6 }}>
          {w}
        </div>
      ))}
    </div>
  );
}
