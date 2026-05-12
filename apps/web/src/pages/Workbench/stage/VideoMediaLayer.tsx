import { forwardRef } from "react";

interface VideoMediaLayerProps {
  src: string;
  poster?: string;
  onClick: () => void;
}

export const VideoMediaLayer = forwardRef<HTMLVideoElement, VideoMediaLayerProps>(function VideoMediaLayer({
  src,
  poster,
  onClick,
}, ref) {
  return (
    <video
      ref={ref}
      data-testid="video-media-layer"
      src={src}
      poster={poster}
      playsInline
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        objectFit: "contain",
        zIndex: 1,
      }}
      onClick={onClick}
    />
  );
});
