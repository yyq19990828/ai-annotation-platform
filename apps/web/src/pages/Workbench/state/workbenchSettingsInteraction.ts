/** Background listeners yield to the settings window without consuming its events. */
export function isWorkbenchSettingsInteractionBlocked(event: Event): boolean {
  if (typeof document === "undefined") return false;
  // Closing may remove the marker before a later window listener sees this same event.
  return (
    event
      .composedPath()
      .some(
        (target) => target instanceof Element && target.hasAttribute("data-workbench-settings"),
      ) || document.querySelector('[data-workbench-settings][data-state="open"]') !== null
  );
}
