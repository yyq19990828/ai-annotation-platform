interface VideoQcWarningsProps {
  warnings: string[];
}

export function VideoQcWarnings({ warnings }: VideoQcWarningsProps) {
  if (warnings.length === 0) return null;

  return (
    <div
      data-testid="video-qc-warnings"
      className="absolute top-3.5 left-3.5 grid gap-1 max-w-[min(520px,calc(100%-28px))] text-amber-600 dark:text-amber-400 text-xs pointer-events-none z-5"
    >
      {warnings.map((w) => (
        <div key={w} className="px-2 py-1 bg-black/70 rounded-md">
          {w}
        </div>
      ))}
    </div>
  );
}
