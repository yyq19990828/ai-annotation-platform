import styles from "./VideoGridLayer.module.css";

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
      className={styles.layer}
    />
  );
}
