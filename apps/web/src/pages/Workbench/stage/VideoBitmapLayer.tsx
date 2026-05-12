export function VideoBitmapLayer() {
  return (
    <canvas
      data-testid="video-bitmap-layer"
      aria-hidden="true"
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        display: "none",
        zIndex: 2,
        pointerEvents: "none",
      }}
    />
  );
}
