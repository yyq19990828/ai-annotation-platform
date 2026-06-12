export type { Role, MatrixAxis, ScreenshotScene } from "./_types";

import { AUTH_SCENES } from "./auth";
import { BBOX_SCENES } from "./workbench-bbox";
import { POLYGON_SCENES } from "./workbench-polygon";
import { SAM_SCENES } from "./workbench-sam";
import { PROJECT_SCENES } from "./projects";
import { REVIEW_SCENES } from "./review";
import { EXPORT_SCENES } from "./export";
import { AI_PRE_SCENES } from "./ai-pre";
import { PLATFORM_SCENES } from "./platform";
import { WORKFLOW_SCENES } from "./workflows";
import { WORKBENCH_AI_SCENES } from "./workbench-ai";
import { DATASET_SCENES } from "./datasets";
import { SETTINGS_SCENES } from "./settings";
import { SUPERADMIN_SCENES } from "./superadmin";

export const SCENES = [
  ...AUTH_SCENES,
  ...BBOX_SCENES,
  ...POLYGON_SCENES,
  ...SAM_SCENES,
  ...PROJECT_SCENES,
  ...REVIEW_SCENES,
  ...EXPORT_SCENES,
  ...AI_PRE_SCENES,
  ...PLATFORM_SCENES,
  ...WORKFLOW_SCENES,
  ...WORKBENCH_AI_SCENES,
  ...DATASET_SCENES,
  ...SETTINGS_SCENES,
  ...SUPERADMIN_SCENES,
];
