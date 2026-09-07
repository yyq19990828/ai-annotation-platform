/** Background listeners yield to Workbench settings and tool menus without consuming events. */
export function isWorkbenchInteractionBlocked(event: Event): boolean {
  if (typeof document === "undefined") return false;
  const selector =
    "[data-workbench-settings], [data-workbench-tool-menu], [data-workbench-ai-toolbar], [data-workbench-track-context], [data-workbench-tracker-review], [data-workbench-video-tool-confirm], [data-workbench-issue-navigation], [data-workbench-issue-create]";
  const triggerSelector = "[data-workbench-tool-menu-trigger]";
  // Closing may remove the marker before a later window listener sees this same event.
  return (
    event.composedPath().some((target) => {
      if (!(target instanceof Element)) return false;
      if (target.matches(selector)) return true;
      if (target.matches("[data-workbench-video-tool-command]")) {
        return (
          !(event instanceof KeyboardEvent) ||
          ["Enter", " ", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End"].includes(
            event.key,
          )
        );
      }
      // The trigger must protect opening input before the portal exists, while
      // normal canvas shortcuts resume once a closed menu restores focus to it.
      return (
        target.matches(triggerSelector) &&
        (!(event instanceof KeyboardEvent) || ["Enter", " ", "ArrowDown"].includes(event.key))
      );
    }) ||
    document.querySelector(
      '[data-workbench-settings][data-state="open"], [data-workbench-tool-menu][data-state="open"], [data-workbench-tool-menu-trigger][data-state="open"], [data-workbench-video-tool-confirm][data-state="open"], [data-workbench-issue-create][data-state="open"]',
    ) !== null
  );
}
