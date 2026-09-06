// Explicitly enrolled flows only: unknown flows must not acquire a manual fallback.
const manual = [
  "bbox-draw",
  "rotated-bbox",
  "polyline-draw",
  "polygon-draw",
  "mask-draw",
  "ai-prediction-import",
  "review-reject",
  "batch-bulk-actions",
  "video-track",
  "video-timeline-zoom",
  "video-chapter",
  "video-track-carryover",
  "video-mask-track-edit",
  "video-draw",
  "pointcloud-controls",
  "pointcloud-view",
  "pointcloud-billboard-label",
  "pointcloud-camera-seed-3d-box",
  "pointcloud-crossframe-track",
  "large-image-progressive",
  "large-image-pyramid-recovery",
  "large-image-mask-limit",
  "hotkey-cheatsheet",
];

export const RECORDING_FLOWS = {
  ...Object.fromEntries(manual.map((id) => [id, []])),
  "sam-tool-smart-point": ["image_interactive"],
  "sam-tool-smart-box": ["image_interactive"],
  "sam-tool-exemplar": ["image_interactive"],
  "sam-interactive": ["image_interactive"],
  "ocr-inference": ["ocr"],
};

export const MARKETING_ONLY_FLOWS = [
  "pointcloud-billboard-label",
  "pointcloud-camera-seed-3d-box",
  "pointcloud-crossframe-track",
];

export function recordingPlan(flows, profile = "docs") {
  if (!["docs", "marketing"].includes(profile)) throw new Error(`Unknown profile: ${profile}`);
  if (!flows.length)
    throw new Error("Select at least one --flow; use --list to see supported flows.");
  for (const flow of flows) {
    if (!Object.hasOwn(RECORDING_FLOWS, flow))
      throw new Error(`Unregistered recording flow: ${flow}`);
    if (profile !== "marketing" && MARKETING_ONLY_FLOWS.includes(flow)) {
      throw new Error(
        `${flow} requires --profile marketing (hardware WebGL/60Hz); no portable fallback`,
      );
    }
  }
  const selected = [...new Set(flows)];
  const requirements = [...new Set(selected.flatMap((id) => RECORDING_FLOWS[id]))].sort();
  return {
    flows: selected,
    profile,
    backendRequirements: requirements.join(",") || "none",
    // Match the flow prefix, not a substring in the title or source filename.
    grep: `(?:^| )(${selected.join("|")}) —`,
  };
}

export function screenshotCatalogPath(scope = process.env.SCREENSHOT_BACKEND_REQUIREMENTS) {
  return (
    "/api/v1/__test/seed/catalog?profile=screenshots" +
    (scope === undefined ? "" : `&backend_requirements=${encodeURIComponent(scope)}`)
  );
}
