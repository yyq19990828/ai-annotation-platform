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
        left: 14,
        bottom: 14,
        display: "grid",
        gap: 4,
        color: "var(--color-warning)",
        fontSize: 12,
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
