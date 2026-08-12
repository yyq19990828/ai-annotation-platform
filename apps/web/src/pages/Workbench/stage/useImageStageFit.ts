import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Viewport } from "../state/useViewportTransform";
import { fitToCanvas } from "./shared/viewport/fit";

interface UseImageStageFitOptions {
  imageIdentity: string;
  imageWidth: number;
  imageHeight: number;
  dimsReady: boolean;
  viewportSize: { w: number; h: number };
  setViewport: React.Dispatch<React.SetStateAction<Viewport>>;
  fitTick: number;
  autoFitOnResize: boolean;
}

export function useImageStageFit({
  imageIdentity,
  imageWidth,
  imageHeight,
  dimsReady,
  viewportSize,
  setViewport,
  fitTick,
  autoFitOnResize,
}: UseImageStageFitOptions): { fitted: boolean; fitNow: () => void } {
  const [fittedIdentity, setFittedIdentity] = useState<string | null>(null);
  const fitted = imageIdentity !== "" && fittedIdentity === imageIdentity;
  const fittedViewportRef = useRef({ w: 0, h: 0 });

  const fitNow = useCallback(() => {
    const next = fitToCanvas(viewportSize.w, viewportSize.h, imageWidth, imageHeight);
    if (next) setViewport(next);
  }, [imageHeight, imageWidth, setViewport, viewportSize.h, viewportSize.w]);

  useLayoutEffect(() => {
    if (!imageIdentity || !viewportSize.w || !viewportSize.h || !dimsReady) return;
    if (fittedIdentity !== imageIdentity) {
      fitNow();
      fittedViewportRef.current = { w: viewportSize.w, h: viewportSize.h };
      setFittedIdentity(imageIdentity);
      return;
    }
    if (
      autoFitOnResize &&
      (fittedViewportRef.current.w !== viewportSize.w ||
        fittedViewportRef.current.h !== viewportSize.h)
    ) {
      fitNow();
      fittedViewportRef.current = { w: viewportSize.w, h: viewportSize.h };
    }
  }, [
    autoFitOnResize,
    dimsReady,
    fitNow,
    fittedIdentity,
    imageIdentity,
    viewportSize.h,
    viewportSize.w,
  ]);

  const lastFitTickRef = useRef(fitTick);
  useEffect(() => {
    if (fitTick === lastFitTickRef.current) return;
    lastFitTickRef.current = fitTick;
    fitNow();
    fittedViewportRef.current = { w: viewportSize.w, h: viewportSize.h };
  }, [fitNow, fitTick, viewportSize.h, viewportSize.w]);

  return { fitted, fitNow };
}
