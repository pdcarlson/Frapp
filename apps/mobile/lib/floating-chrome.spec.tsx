/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create } from "react-test-renderer";
import { afterEach, describe, expect, it } from "vitest";
import {
  FLOATING_ASK_BAR,
  floatingScreenLayout,
  floatingTabBarBottom,
  floatingTabBarTop,
  setAskBarShown,
  useAskBarLift,
  useTabBarClearance,
} from "./floating-chrome";

describe("floatingTabBarBottom", () => {
  it("tucks 8pt into a home indicator or gesture bar", () => {
    expect(floatingTabBarBottom(34)).toBe(26);
    expect(floatingTabBarBottom(24)).toBe(16);
  });

  it("keeps 12pt off the edge with no inset", () => {
    expect(floatingTabBarBottom(0)).toBe(12);
  });

  it("sits wholly above Android's three-button bar", () => {
    expect(floatingTabBarBottom(48)).toBeGreaterThan(48);
  });

  it("measures the bar's top as its bottom plus the drawn 62pt", () => {
    expect(floatingTabBarTop(34)).toBe(26 + 62);
  });
});

/**
 * What a screen pads its scroll end by, read through the layout every tab
 * screen gets. The safe-area mock's bottom inset is 0, so the bar's top is
 * 12 + 62 off the edge, and the gap adds 14.
 */
describe("useTabBarClearance", () => {
  function clearanceOnATab(): number {
    let seen = -1;
    function Probe() {
      seen = useTabBarClearance();
      return null;
    }
    act(() => {
      create(
        floatingScreenLayout({
          route: { name: "tasks" },
          navigation: { addListener: () => () => {} },
          children: <Probe />,
        }),
      );
    });
    return seen;
  }

  it("clears the bar's top plus the gap on a tab, which the bar floats over", () => {
    expect(clearanceOnATab()).toBe(12 + 62 + 14);
  });

  it("is 0 outside the tab layout, as on a screen pushed over it", () => {
    let seen = -1;
    function Probe() {
      seen = useTabBarClearance();
      return null;
    }
    act(() => {
      create(<Probe />);
    });
    expect(seen).toBe(0);
  });
});

/**
 * The Ask Frapp bar sits above the tab bar for a member who has Ask (#4702).
 * The tab bar says when it is there; a tab screen's last row, the create
 * button and the undo bar all move up by it, and a pushed screen never does.
 */
describe("the Ask Frapp bar's room", () => {
  type Seen = { lift: number; clearance: number };
  function Probe({ seen }: { seen: Seen }) {
    seen.lift = useAskBarLift();
    seen.clearance = useTabBarClearance();
    return null;
  }
  function onATab(seen: Seen) {
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(
        floatingScreenLayout({
          route: { name: "index" },
          navigation: { addListener: () => () => {} },
          children: <Probe seen={seen} />,
        }),
      );
    });
    return tree;
  }
  afterEach(() => act(() => setAskBarShown(false)));

  it("is the bar's 48pt and its 8pt gap", () => {
    expect(FLOATING_ASK_BAR).toEqual({ height: 48, gap: 8 });
  });

  it("lifts a tab screen's clearance by the bar once the tab bar shows it, without a remount", () => {
    const seen: Seen = { lift: -1, clearance: -1 };
    onATab(seen);
    expect(seen).toEqual({ lift: 0, clearance: 12 + 62 + 14 });
    act(() => setAskBarShown(true));
    expect(seen).toEqual({ lift: 56, clearance: 12 + 62 + 56 + 14 });
    act(() => setAskBarShown(false));
    expect(seen).toEqual({ lift: 0, clearance: 12 + 62 + 14 });
  });

  it("never lifts a screen pushed over the tabs, which the bar is not drawn on", () => {
    act(() => setAskBarShown(true));
    const seen: Seen = { lift: -1, clearance: -1 };
    act(() => {
      create(<Probe seen={seen} />);
    });
    expect(seen).toEqual({ lift: 0, clearance: 0 });
  });
});
