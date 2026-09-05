import { afterEach, describe, expect, it, vi } from "vitest";
import { isWorkbenchSettingsInteractionBlocked } from "./workbenchSettingsInteraction";

afterEach(() => document.body.replaceChildren());

describe("workbench settings interaction boundary", () => {
  it("blocks background events only while the settings marker is open", () => {
    const settings = document.createElement("div");
    settings.dataset.workbenchSettings = "";
    settings.dataset.state = "open";
    document.body.append(settings);
    const event = new KeyboardEvent("keydown", { key: "Delete" });

    expect(isWorkbenchSettingsInteractionBlocked(event)).toBe(true);
    settings.dataset.state = "closed";
    expect(isWorkbenchSettingsInteractionBlocked(event)).toBe(false);
    settings.remove();
    expect(isWorkbenchSettingsInteractionBlocked(event)).toBe(false);
  });

  it.each(["keydown", "wheel"])(
    "keeps a removed settings source in the %s path without consuming the event",
    (type) => {
      const settings = document.createElement("div");
      settings.dataset.workbenchSettings = "";
      settings.dataset.state = "open";
      const button = document.createElement("button");
      settings.append(button);
      document.body.append(settings);
      button.addEventListener(type, () => {
        settings.dataset.state = "closed";
        settings.remove();
      });
      const background = vi.fn((event: Event) => {
        expect(isWorkbenchSettingsInteractionBlocked(event)).toBe(true);
        expect(event.defaultPrevented).toBe(false);
        expect(event.cancelBubble).toBe(false);
      });
      window.addEventListener(type, background, { once: true });

      button.dispatchEvent(new Event(type, { bubbles: true, cancelable: true }));
      expect(background).toHaveBeenCalledTimes(1);
    },
  );
});
