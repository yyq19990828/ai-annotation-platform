import { StrictMode, useEffect } from "react";
import { act, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  DiscussionDraftProvider,
  useDiscussionDraft,
  useDiscussionDraftStore,
} from "./DiscussionDraftProvider";
import type { DiscussionDraftStore } from "./useDiscussionDraftStore";
import type { DiscussionTarget } from "./discussionTypes";

const target: DiscussionTarget = { projectId: "p", taskId: "t", kind: "task" };

function StoreProbe({ onStore }: { onStore: (store: DiscussionDraftStore | null) => void }) {
  const store = useDiscussionDraftStore();
  useEffect(() => {
    onStore(store);
  }, [onStore, store]);
  return null;
}

function DraftProbe({ onDraft }: { onDraft: (body: string | undefined) => void }) {
  const draft = useDiscussionDraft(target);
  useEffect(() => {
    onDraft(draft?.body);
  }, [draft, onDraft]);
  return null;
}

describe("DiscussionDraftProvider", () => {
  it("returns null outside a provider and keeps a draft while route children unmount", () => {
    let outside: DiscussionDraftStore | null | undefined;
    const outsideRender = render(<StoreProbe onStore={(store) => (outside = store)} />);
    expect(outside).toBeNull();
    outsideRender.unmount();

    let current: DiscussionDraftStore | null = null;
    let showRoute = true;
    const onStore = vi.fn((store: DiscussionDraftStore | null) => {
      current = store;
    });
    const view = render(
      <DiscussionDraftProvider userId="u1" sessionId="s1">
        {showRoute ? <StoreProbe onStore={onStore} /> : null}
      </DiscussionDraftProvider>,
    );
    expect(current).not.toBeNull();
    act(() => current!.patchDraft(target, { body: "keep across route" }));
    showRoute = false;
    view.rerender(
      <DiscussionDraftProvider userId="u1" sessionId="s1">
        {showRoute ? <StoreProbe onStore={onStore} /> : null}
      </DiscussionDraftProvider>,
    );
    expect(current!.getDraft(target)?.body).toBe("keep across route");
    view.unmount();
  });

  it("retire account drafts and prevents late results from the old owner", async () => {
    let current: DiscussionDraftStore | null = null;
    const onDispose = vi.fn();
    const view = render(
      <DiscussionDraftProvider userId="u1" sessionId="s1" onDispose={onDispose}>
        <StoreProbe onStore={(store) => (current = store)} />
      </DiscussionDraftProvider>,
    );
    const first = current!;
    first.patchDraft(target, { body: "u1" });
    const origin = first.makeOrigin({
      projectId: "p",
      taskId: "t",
      kind: "annotation",
      annotationId: "a",
    })!;

    view.rerender(
      <DiscussionDraftProvider userId="u2" sessionId="s2" onDispose={onDispose}>
        <StoreProbe onStore={(store) => (current = store)} />
      </DiscussionDraftProvider>,
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(first.getSnapshot().disposed).toBe(true);
    expect(current).not.toBe(first);
    expect(current!.getDraft(target)).toBeUndefined();
    expect(first.acceptDrawing(origin, { shapes: [] })).toBe(false);
    expect(onDispose).toHaveBeenCalledWith({ sessionId: "s1", userId: "u1" });
    view.unmount();
  });

  it("creates a new session after logout/login with the same user", async () => {
    let current: DiscussionDraftStore | null = null;
    const view = render(
      <DiscussionDraftProvider userId="same-user">
        <StoreProbe onStore={(store) => (current = store)} />
      </DiscussionDraftProvider>,
    );
    const first = current!;
    first.patchDraft(target, { body: "must not cross login" });
    view.rerender(
      <DiscussionDraftProvider userId={null}>
        <StoreProbe onStore={(store) => (current = store)} />
      </DiscussionDraftProvider>,
    );
    view.rerender(
      <DiscussionDraftProvider userId="same-user">
        <StoreProbe onStore={(store) => (current = store)} />
      </DiscussionDraftProvider>,
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(current).not.toBe(first);
    expect(current!.getDraft(target)).toBeUndefined();
    view.unmount();
  });

  it("warns before unload only while a text draft is dirty", () => {
    let current: DiscussionDraftStore | null = null;
    const prevent = vi.spyOn(Event.prototype, "preventDefault");
    const view = render(
      <DiscussionDraftProvider userId="u1" sessionId="s1">
        <StoreProbe onStore={(store) => (current = store)} />
      </DiscussionDraftProvider>,
    );
    act(() => current!.patchDraft(target, { body: "dirty" }));
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    expect(prevent).toHaveBeenCalled();
    act(() => current!.patchDraft(target, { body: "" }));
    prevent.mockClear();
    window.dispatchEvent(new Event("beforeunload", { cancelable: true }));
    expect(prevent).not.toHaveBeenCalled();
    prevent.mockRestore();
    view.unmount();
  });

  it("hydrates the target hook and updates it through the external store", () => {
    let current: DiscussionDraftStore | null = null;
    const bodies: Array<string | undefined> = [];
    const onDraft = (body: string | undefined) => bodies.push(body);
    const view = render(
      <DiscussionDraftProvider userId="u1" sessionId="s1">
        <StoreProbe onStore={(store) => (current = store)} />
        <DraftProbe onDraft={onDraft} />
      </DiscussionDraftProvider>,
    );
    act(() => current!.patchDraft(target, { body: "updated" }));
    expect(bodies).toContain("updated");
    view.unmount();
  });

  it("survives StrictMode's effect replay without disposing the active store", async () => {
    let current: DiscussionDraftStore | null = null;
    const view = render(
      <StrictMode>
        <DiscussionDraftProvider userId="u1" sessionId="s1">
          <StoreProbe onStore={(store) => (current = store)} />
        </DiscussionDraftProvider>
      </StrictMode>,
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(current!.getSnapshot().disposed).toBe(false);
    expect(current!.isOwned({ sessionId: "s1", userId: "u1" })).toBe(true);
    view.unmount();
  });
});
