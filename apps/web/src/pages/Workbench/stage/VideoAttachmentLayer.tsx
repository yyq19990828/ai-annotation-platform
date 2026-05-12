export function VideoAttachmentLayer() {
  return (
    <div
      data-testid="video-attachment-layer"
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 7,
        pointerEvents: "none",
      }}
    />
  );
}
