import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AskStarterSeen } from "@repo/validation";
import { useAskStarter, type AskStarterStore } from "./ask-starter";

/**
 * When Ask opens on the first-open starter (#4904; `spec/behavior/ai.md`
 * § What Ask opens with): one rule for web and the phone.
 */

function memory(initial: AskStarterSeen | null | undefined = null) {
  let kept = initial;
  const store: AskStarterStore = {
    read: vi.fn(async () => kept),
    write: vi.fn(async (_userId: string, seen: AskStarterSeen) => {
      kept = seen;
      return true;
    }),
  };
  return { store, kept: () => kept };
}

type Props = Parameters<typeof useAskStarter>[0];

function mount(props: Partial<Props> & Pick<Props, "store">) {
  return renderHook((p: Props) => useAskStarter(p), {
    initialProps: {
      userId: "me",
      open: true,
      empty: true,
      canAct: false,
      ...props,
    },
  });
}

describe("useAskStarter", () => {
  it("decides before drawing, shows the starter on the first open, and records it only once it is drawn", async () => {
    const { store, kept } = memory();
    const view = mount({ store });
    expect(view.result.current.mode).toBe("deciding");
    await waitFor(() => expect(view.result.current.mode).toBe("starter"));
    expect(store.write).not.toHaveBeenCalled();
    act(() => view.result.current.starterShown());
    expect(kept()).toBe("ask");
  });

  it("is the greeting on the next open", async () => {
    const { store } = memory("ask");
    const view = mount({ store });
    await waitFor(() => expect(view.result.current.mode).toBe("greeting"));
  });

  it("stays the starter through the rest of the open, and doesn't come back after New conversation", async () => {
    const { store } = memory();
    const view = mount({ store });
    await waitFor(() => expect(view.result.current.mode).toBe("starter"));
    act(() => view.result.current.starterShown());
    const props = { userId: "me", open: true, canAct: false, store };
    view.rerender({ ...props, empty: false });
    view.rerender({ ...props, empty: true });
    expect(view.result.current.mode).toBe("greeting");
  });

  it("stays due when an open never drew it: a question sent as Ask opened, or Ask closed before the read", async () => {
    const { store, kept } = memory();
    const props = { userId: "me", canAct: false, store };
    const view = mount({ ...props, empty: false });
    await act(async () => {});
    expect(view.result.current.mode).toBe("greeting");
    view.rerender({ ...props, open: false, empty: false });
    expect(kept()).toBeNull();
    // The next open, with an empty thread, shows it.
    view.rerender({ ...props, open: true, empty: true });
    await waitFor(() => expect(view.result.current.mode).toBe("starter"));
  });

  it("is due again once Frapp can act for a member who saw it without that line, and records that", async () => {
    const { store, kept } = memory("ask");
    const view = mount({ store, canAct: true });
    await waitFor(() => expect(view.result.current.mode).toBe("starter"));
    act(() => view.result.current.starterShown());
    expect(kept()).toBe("act");

    const seenWithAct = memory("act");
    const again = mount({ store: seenWithAct.store, canAct: true });
    await waitFor(() => expect(again.result.current.mode).toBe("greeting"));
  });

  it("never shows it from a record that can't be read", async () => {
    const store: AskStarterStore = {
      read: vi.fn(async () => undefined),
      write: vi.fn(async () => true),
    };
    const view = mount({ store });
    await waitFor(() => expect(view.result.current.mode).toBe("greeting"));
  });

  it("remembers it for this mount when the device can't keep the record", async () => {
    const store: AskStarterStore = {
      read: vi.fn(async () => null),
      write: vi.fn(async () => false),
    };
    const props = { userId: "me", empty: true, canAct: false, store };
    const view = mount(props);
    await waitFor(() => expect(view.result.current.mode).toBe("starter"));
    act(() => view.result.current.starterShown());
    view.rerender({ ...props, open: false });
    view.rerender({ ...props, open: true });
    await waitFor(() => expect(view.result.current.mode).toBe("greeting"));
  });
});
