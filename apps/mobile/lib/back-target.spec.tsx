/** @vitest-environment jsdom */
import React, { act } from "react";
import { create } from "react-test-renderer";
import { describe, expect, it } from "vitest";
import { stackScreen } from "@/test/stack-screen";
import {
  screenBelowName,
  useHoldSwipeBack,
  useScreenBelow,
  type ScreenBelow,
} from "./back-target";

/**
 * `spec/ui/mobile/navigation.md` § Going back: a drawn back control pops the
 * stack exactly as the iOS edge swipe and Android's back do, and names the
 * screen under it.
 */

describe("screenBelowName", () => {
  const top = { key: "top", name: "event-details" };

  it("is null at the bottom of the stack", () => {
    expect(screenBelowName([top], "top")).toBeNull();
    expect(screenBelowName([top], "missing")).toBeNull();
  });

  it("names a pushed screen under it by its route", () => {
    expect(
      screenBelowName([{ key: "n", name: "notifications" }, top], "top"),
    ).toBe("notifications");
  });

  it("names the tabs by the tab they show", () => {
    const tabs = (extra: object) => ({ key: "t", name: "(tabs)", ...extra });
    expect(
      screenBelowName(
        [
          tabs({
            state: {
              index: 3,
              routes: [
                { name: "index" },
                { name: "events" },
                { name: "tasks" },
                { name: "more" },
              ],
            },
          }),
          top,
        ],
        "top",
      ),
    ).toBe("more");
    expect(
      screenBelowName([tabs({ params: { screen: "events" } }), top], "top"),
    ).toBe("events");
    // Anchored under a cold link and never rendered: its first route.
    expect(screenBelowName([tabs({}), top], "top")).toBe("index");
  });
});

function Probe({
  onRender,
}: {
  onRender: (below: ScreenBelow | null) => void;
}) {
  onRender(useScreenBelow());
  return null;
}

describe("useScreenBelow", () => {
  it("is null with no navigator, as in a sheet's portal", () => {
    const seen: { below?: ScreenBelow | null } = {};
    act(() => {
      create(<Probe onRender={(below) => (seen.below = below)} />);
    });
    expect(seen.below).toBeNull();
  });

  it("is null on a tab, whose navigator switches rather than pops", () => {
    const seen: { below?: ScreenBelow | null } = {};
    const { element } = stackScreen(
      [{ name: "index" }],
      <Probe onRender={(below) => (seen.below = below)} />,
      "tab",
    );
    act(() => {
      create(element);
    });
    expect(seen.below).toBeNull();
  });

  it("titles the screen under it and pops to it", () => {
    const seen: { below?: ScreenBelow | null } = {};
    const { element, navigation } = stackScreen(
      [{ name: "(tabs)", params: { screen: "events" } }],
      <Probe onRender={(below) => (seen.below = below)} />,
    );
    act(() => {
      create(element);
    });
    expect(seen.below).toMatchObject({ name: "events", title: "Events" });
    seen.below!.goBack();
    expect(navigation.goBack).toHaveBeenCalledTimes(1);
  });

  it("calls an unknown screen Back", () => {
    const seen: { below?: ScreenBelow | null } = {};
    const { element } = stackScreen(
      [{ name: "somewhere-new" }],
      <Probe onRender={(below) => (seen.below = below)} />,
    );
    act(() => {
      create(element);
    });
    expect(seen.below?.title).toBe("Back");
  });
});

describe("useHoldSwipeBack", () => {
  function Holder({ hold }: { hold: boolean }) {
    useHoldSwipeBack(hold);
    return null;
  }

  it("turns the swipe off while held and back on when released", () => {
    // One screen across renders: the same navigation, as a re-render has.
    const { navigation } = stackScreen([{ name: "(tabs)" }], null);
    const at = (hold: boolean) =>
      stackScreen(
        [{ name: "(tabs)" }],
        <Holder hold={hold} />,
        "stack",
        navigation,
      ).element;

    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(at(false));
    });
    expect(navigation.setOptions).not.toHaveBeenCalled();

    act(() => tree.update(at(true)));
    expect(navigation.setOptions).toHaveBeenLastCalledWith({
      gestureEnabled: false,
    });

    act(() => tree.update(at(false)));
    expect(navigation.setOptions).toHaveBeenLastCalledWith({
      gestureEnabled: true,
    });
  });

  it("is a no-op with no navigator", () => {
    expect(() =>
      act(() => {
        create(<Holder hold />);
      }),
    ).not.toThrow();
  });
});
