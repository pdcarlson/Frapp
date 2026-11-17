/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create } from "react-test-renderer";
import * as expoRouter from "expo-router";
import { afterEach, describe, expect, it } from "vitest";
import {
  barFoldAfterScroll,
  FLOATING_ASK_BAR,
  floatingScreenLayout,
  floatingTabBarBottom,
  floatingTabBarTop,
  setAskBarShown,
  setBarFolded,
  useAskBarLift,
  useBarFolded,
  useBarScroll,
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

/**
 * The bar folds while a member reads down a tab screen and opens again on
 * the way up (#4904, Paul's direction A, 2026-11-17).
 */
describe("the bar's fold on scroll", () => {
  const VIEW = 700;
  const CONTENT = 3000;
  const start = { y: 0, travel: 0, viewport: 0 };

  function scrollTo(ys: number[], from = start) {
    let state = from;
    const folds: (boolean | null)[] = [];
    for (const y of ys) {
      const next = barFoldAfterScroll(state, y, VIEW, CONTENT);
      state = next.state;
      folds.push(next.folded);
    }
    return { folds, state };
  }

  it("folds after more than 12pt of reading down, counted from 40pt down the list", () => {
    expect(scrollTo([20, 39]).folds).toEqual([false, false]);
    expect(scrollTo([40]).folds).toEqual([null]);
    // Exactly 12pt past the top's edge is not yet a fold; 13 is.
    expect(scrollTo([52]).folds).toEqual([null]);
    expect(scrollTo([53]).folds).toEqual([true]);
    expect(scrollTo([45, 50, 58]).folds).toEqual([null, null, true]);
  });

  it("takes a fresh 12pt to fold again once something else opened it", () => {
    const { state } = scrollTo([100, 200]);
    expect(state.travel).toBe(0);
    expect(barFoldAfterScroll(state, 201, VIEW, CONTENT).folded).toBeNull();
  });

  it("opens again on any move up, at the top, and where the list ends", () => {
    expect(scrollTo([100, 200, 199]).folds).toEqual([true, true, false]);
    expect(scrollTo([100, 200, -20]).folds).toEqual([true, true, false]);
    expect(scrollTo([100, 2000, CONTENT - VIEW]).folds).toEqual([
      true,
      true,
      false,
    ]);
  });

  it("counts the list as ended within 4pt of its end", () => {
    expect(scrollTo([100, CONTENT - VIEW - 3]).folds).toEqual([true, false]);
    expect(scrollTo([100, CONTENT - VIEW - 5]).folds).toEqual([true, true]);
  });

  it("never folds a list too short to scroll", () => {
    expect(barFoldAfterScroll(start, 60, VIEW, 650).folded).toBe(false);
  });

  describe("on a screen", () => {
    const router = expoRouter as unknown as {
      __refocus: () => void;
      __blur: () => void;
    };
    let props: ReturnType<typeof useBarScroll> = {};
    let folded: boolean | null = null;
    function OnTab() {
      props = useBarScroll();
      folded = useBarFolded();
      return null;
    }
    function mountOnTab() {
      act(() => {
        create(
          floatingScreenLayout({
            route: { name: "index" },
            navigation: { addListener: () => () => {} },
            children: <OnTab />,
          }),
        );
      });
    }
    const scroll = (y: number) =>
      act(() =>
        props.onScroll?.({
          nativeEvent: {
            contentOffset: { y },
            layoutMeasurement: { height: VIEW },
            contentSize: { height: CONTENT },
          },
        } as never),
      );
    afterEach(() => act(() => setBarFolded(false)));

    it("gives a pushed screen nothing to attach", () => {
      let pushed: unknown = null;
      function Pushed() {
        pushed = useBarScroll();
        return null;
      }
      act(() => {
        create(<Pushed />);
      });
      expect(pushed).toEqual({});
    });

    it("folds and opens as the member reads down and back up", () => {
      mountOnTab();
      expect(props.scrollEventThrottle).toBe(16);
      scroll(100);
      scroll(200);
      expect(folded).toBe(true);
      scroll(150);
      expect(folded).toBe(false);
    });

    it("opens when the screen gains or loses focus, as on a tab change", () => {
      mountOnTab();
      scroll(100);
      scroll(200);
      expect(folded).toBe(true);
      act(() => router.__blur());
      expect(folded).toBe(false);
      act(() => setBarFolded(true));
      act(() => router.__refocus());
      expect(folded).toBe(false);
    });

    it("opens when the list turns too short to scroll, with no scroll event", () => {
      mountOnTab();
      act(() =>
        props.onLayout?.({
          nativeEvent: { layout: { height: VIEW } },
        } as never),
      );
      scroll(100);
      scroll(200);
      expect(folded).toBe(true);
      act(() => props.onContentSizeChange?.(400, 500));
      expect(folded).toBe(false);
    });
  });
});
