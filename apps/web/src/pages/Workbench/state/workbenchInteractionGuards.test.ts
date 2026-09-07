import { afterEach, describe, expect, it, vi } from "vitest";
import { isWorkbenchInteractionBlocked } from "./workbenchInteractionGuards";

afterEach(() => document.body.replaceChildren());

it("AI toolbar controls keep their input while canvas shortcuts remain available", () => {
  const toolbar = document.createElement("div");
  toolbar.dataset.workbenchAiToolbar = "";
  const button = document.createElement("button");
  toolbar.append(button);
  document.body.append(toolbar);
  expect(isWorkbenchInteractionBlocked(new KeyboardEvent("keydown", { key: "Tab" }))).toBe(false);
  const check = vi.fn((event: Event) => {
    expect(isWorkbenchInteractionBlocked(event)).toBe(true);
    expect(event.defaultPrevented).toBe(false);
  });
  button.addEventListener("keydown", check);
  button.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
  expect(check).toHaveBeenCalledOnce();
});

it.each([
  ["Enter", true],
  [" ", true],
  ["ArrowDown", true],
  ["b", false],
  ["p", false],
  ["Delete", false],
  ["Escape", false],
])("closed menu trigger handles %s without swallowing other canvas shortcuts", (key, blocked) => {
  const trigger = document.createElement("button");
  trigger.dataset.workbenchToolMenuTrigger = "";
  trigger.dataset.state = "closed";
  document.body.append(trigger);
  const check = vi.fn((event: Event) => expect(isWorkbenchInteractionBlocked(event)).toBe(blocked));
  trigger.addEventListener("keydown", check);
  trigger.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  expect(check).toHaveBeenCalledOnce();
});

describe.each(["workbenchSettings", "workbenchToolMenu"])(
  "workbench %s interaction boundary",
  (marker) => {
    it("blocks background events only while the marker is open", () => {
      const settings = document.createElement("div");
      settings.dataset[marker] = "";
      settings.dataset.state = "open";
      document.body.append(settings);
      const event = new KeyboardEvent("keydown", { key: "Delete" });

      expect(isWorkbenchInteractionBlocked(event)).toBe(true);
      settings.dataset.state = "closed";
      expect(isWorkbenchInteractionBlocked(event)).toBe(false);
      settings.remove();
      expect(isWorkbenchInteractionBlocked(event)).toBe(false);
    });

    it.each(["keydown", "wheel"])(
      "keeps a removed settings source in the %s path without consuming the event",
      (type) => {
        const settings = document.createElement("div");
        settings.dataset[marker] = "";
        settings.dataset.state = "open";
        const button = document.createElement("button");
        settings.append(button);
        document.body.append(settings);
        button.addEventListener(type, () => {
          settings.dataset.state = "closed";
          settings.remove();
        });
        const background = vi.fn((event: Event) => {
          expect(isWorkbenchInteractionBlocked(event)).toBe(true);
          expect(event.defaultPrevented).toBe(false);
          expect(event.cancelBubble).toBe(false);
        });
        window.addEventListener(type, background, { once: true });

        button.dispatchEvent(new Event(type, { bubbles: true, cancelable: true }));
        expect(background).toHaveBeenCalledTimes(1);
      },
    );
  },
);
