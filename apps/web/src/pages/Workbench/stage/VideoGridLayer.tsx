interface VideoGridLayerProps {
  viewBoxHeight: number;
}

export function VideoGridLayer({ viewBoxHeight }: VideoGridLayerProps) {
  return (
    <svg
      data-testid="video-grid-layer"
      aria-hidden="true"
      viewBox={`0 0 1 ${viewBoxHeight}`}
      preserveAspectRatio="xMidYMid meet"
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        display: "none",
        zIndex: 3,
        pointerEvents: "none",
      }}
    />
  );
}
