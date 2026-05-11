import type { ReactNode } from "react";

export type StageKind = "image" | "video" | "3d";

export interface StageCapabilities {
  classPicker: boolean;
  aiPreannotate: boolean;
  diffMode: boolean;
  timeline: boolean;
  viewport: boolean;
  comments: boolean;
}

export interface StageAdapter {
  kind: StageKind;
  capabilities: StageCapabilities;
  render(): ReactNode;
}

export const STAGE_CAPABILITIES: Record<StageKind, StageCapabilities> = {
  image: {
    classPicker: true,
    aiPreannotate: true,
    diffMode: true,
    timeline: false,
    viewport: true,
    comments: true,
  },
  video: {
    classPicker: true,
    aiPreannotate: false,
    diffMode: true,
    timeline: true,
    viewport: false,
    comments: true,
  },
  "3d": {
    classPicker: false,
    aiPreannotate: false,
    diffMode: false,
    timeline: false,
    viewport: true,
    comments: false,
  },
};
