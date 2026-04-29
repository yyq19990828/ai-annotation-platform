import type { Annotation, AnnotationResponse, PredictionResponse } from "@/types";

export function annotationToBox(a: AnnotationResponse): Annotation {
  return {
    id: a.id,
    x: a.geometry.x,
    y: a.geometry.y,
    w: a.geometry.w,
    h: a.geometry.h,
    cls: a.class_name,
    conf: a.confidence ?? 1,
    source: a.source as Annotation["source"],
    parent_prediction_id: a.parent_prediction_id,
    lead_time: a.lead_time,
  };
}

export type AiBox = Annotation & { predictionId: string };

export function predictionsToBoxes(predictions: PredictionResponse[]): AiBox[] {
  return predictions.flatMap((p) =>
    p.result.map((shape, i) => ({
      id: `pred-${p.id}-${i}`,
      predictionId: p.id,
      x: shape.geometry.x,
      y: shape.geometry.y,
      w: shape.geometry.w,
      h: shape.geometry.h,
      cls: shape.class_name,
      conf: shape.confidence,
      source: "prediction_based" as const,
    })),
  );
}
