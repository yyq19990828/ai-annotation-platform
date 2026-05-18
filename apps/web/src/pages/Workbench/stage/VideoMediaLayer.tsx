import { forwardRef } from "react";
import styles from "./VideoMediaLayer.module.css";

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
      className={styles.video}
      onClick={onClick}
    />
  );
});
