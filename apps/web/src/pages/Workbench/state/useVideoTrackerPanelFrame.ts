import { useFloatingPanelFrame } from "./useFloatingPanelFrame";

const TRACKER_PANEL_POSITION_KEY = "wb:video-tracker-panel-position";
const TRACKER_PANEL_SIZE_KEY = "wb:video-tracker-panel-size";

export function useVideoTrackerPanelFrame() {
  const {
    position: trackerPanelPosition,
    setPosition: setTrackerPanelPosition,
    size: trackerPanelSize,
    setSize: setTrackerPanelSize,
  } = useFloatingPanelFrame({
    position: TRACKER_PANEL_POSITION_KEY,
    size: TRACKER_PANEL_SIZE_KEY,
  });

  return {
    trackerPanelPosition,
    setTrackerPanelPosition,
    trackerPanelSize,
    setTrackerPanelSize,
  };
}
