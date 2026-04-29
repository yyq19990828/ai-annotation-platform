import { useState, useEffect, useRef } from "react";
import { Icon } from "@/components/ui/Icon";

interface ThumbnailProps {
  src: string | null | undefined;
  blurhash?: string | null;
  alt?: string;
  width?: number;
  height?: number;
  style?: React.CSSProperties;
}

export function Thumbnail({ src, blurhash, alt = "", width = 48, height = 48, style }: ThumbnailProps) {
  const [loaded, setLoaded] = useState(false);
  const [errored, setErrored] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!blurhash || !canvasRef.current) return;
    import("blurhash").then(({ decode }) => {
      const pixels = decode(blurhash, width, height);
      const canvas = canvasRef.current!;
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d")!;
      const imageData = ctx.createImageData(width, height);
      imageData.data.set(pixels);
      ctx.putImageData(imageData, 0, 0);
    }).catch(() => {/* ignore */});
  }, [blurhash, width, height]);

  const boxStyle: React.CSSProperties = {
    width, height,
    borderRadius: "var(--radius-sm)",
    overflow: "hidden",
    flexShrink: 0,
    background: "var(--color-bg-sunken)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
    ...style,
  };

  if (!src && !blurhash) {
    return (
      <div style={boxStyle}>
        <Icon name="image" size={14} style={{ color: "var(--color-fg-subtle)" }} />
      </div>
    );
  }

  return (
    <div style={boxStyle}>
      {/* blurhash canvas placeholder */}
      {blurhash && !loaded && (
        <canvas
          ref={canvasRef}
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
        />
      )}
      {/* actual image */}
      {src && !errored && (
        <img
          src={src}
          alt={alt}
          loading="lazy"
          decoding="async"
          onLoad={() => setLoaded(true)}
          onError={() => setErrored(true)}
          style={{
            position: "absolute", inset: 0,
            width: "100%", height: "100%",
            objectFit: "cover",
            opacity: loaded ? 1 : 0,
            transition: "opacity 0.2s",
          }}
        />
      )}
      {(!src || errored) && !blurhash && (
        <Icon name="image" size={14} style={{ color: "var(--color-fg-subtle)" }} />
      )}
    </div>
  );
}
