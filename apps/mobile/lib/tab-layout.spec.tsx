/** @vitest-environment jsdom */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import { FrappThemeProvider } from "@/lib/theme";

/**
 * #2485 — no tab screen gets the navigator's header.
 *
 * Every screen draws its own title (`ScreenShell`, or a bar of its own such as
 * the thread's `‹ #name`), and the Canvas board draws no navigator header, so
 * one on top is the same title said twice, which is what every App Store
 * screenshot showed. This renders the real layout, rather than reading its
 * source, and holds both halves: the header is off for the whole navigator,
 * and no registration turns one back on for itself.
 *
 * It lives in `lib/`, not beside the layout: a spec under `app/` is a route
 * module and ships in the bundle (`lib/routes.spec.ts`).
 */

vi.mock("@/lib/auth-session", () => ({
  useAuthSession: () => ({
    status: "authenticated",
    chapterId: "chapter-1",
    isChapterResolving: false,
  }),
}));

vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({ accent: "#F4CB63" }),
}));

import TabLayout from "@/app/(tabs)/_layout";

type Node = ReactTestRenderer["root"];

function render(): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <TabLayout />
      </FrappThemeProvider>,
    );
  });
  return tree;
}

/**
 * `vitest.setup.ts` renders `Tabs` and `Tabs.Screen` as host nodes named for
 * what they stand in for; the casts are the ones
 * `lib/onboarding/join-screen.spec.tsx` explains.
 */
function hosts(root: Node, name: string): Node[] {
  return root.findAll((node) => (node.type as unknown) === name);
}

/**
 * Options as React Navigation resolves them. A registration may pass them as
 * an object or as a function of the route, and a function-form header would
 * slip past a check that only reads object keys.
 */
function resolved(options: unknown, name = "screen"): Record<string, unknown> {
  if (typeof options === "function") {
    return (
      (options as (props: object) => Record<string, unknown> | undefined)({
        route: { key: name, name },
        navigation: {},
        theme: {},
      }) ?? {}
    );
  }
  return (options as Record<string, unknown> | undefined) ?? {};
}

describe("Android back", () => {
  /**
   * Every pushed screen is a hidden tab, and the tab router's default
   * (`firstRoute`) sent back from any of them to Chat home, so back from an
   * event opened on Events landed on Chat. History sends it to the screen the
   * member came from.
   */
  it("returns to the screen the member came from", () => {
    const [tabs] = hosts(render().root, "Tabs");
    expect(tabs.props.backBehavior).toBe("history");
  });
});

describe("tab layout (#2485)", () => {
  it("draws no navigator header over any screen", () => {
    const tree = render();

    const [tabs] = hosts(tree.root, "Tabs");
    expect(resolved(tabs.props.screenOptions).headerShown).toBe(false);
  });

  it("lets no registration bring a header back for itself", () => {
    const tree = render();

    const screens = hosts(tree.root, "Tabs.Screen");
    // The four tabs and every hidden route: an empty list would pass the
    // check below vacuously.
    expect(screens.length).toBeGreaterThan(4);
    for (const screen of screens) {
      const options = resolved(screen.props.options, screen.props.name);
      expect(options, screen.props.name).not.toHaveProperty("headerShown");
      expect(options, screen.props.name).not.toHaveProperty("header");
      expect(options, screen.props.name).not.toHaveProperty("headerTitle");
    }
  });
});

/**
 * The bar is drawn by `GlassTabBar` (the pill and the quick-actions +), not by
 * the navigator's own bar, so no tab style is set here: its placement and the
 * #3344 inset are held in `components/glass-tab-bar.spec.tsx`.
 */
describe("tab bar", () => {
  it("draws the glass pill and + in place of the navigator's bar", () => {
    const [tabs] = hosts(render().root, "Tabs");
    expect(typeof tabs.props.tabBar).toBe("function");
    expect(resolved(tabs.props.screenOptions)).not.toHaveProperty(
      "tabBarStyle",
    );
  });
});

/**
 * A conversation and the two check-in screens take the whole window, as the
 * board draws s05, s18 and s22: the thread's composer sits on the bottom
 * inset, and the scanner and host QR have no tabs under them. Every other
 * route keeps the bar.
 */
describe("full-window screens", () => {
  const FULL_WINDOW = ["chat-thread", "check-in", "host-check-in"];

  function optionsByName(): Map<string, Record<string, unknown>> {
    const tree = render();
    return new Map(
      hosts(tree.root, "Tabs.Screen").map((screen) => [
        screen.props.name as string,
        resolved(screen.props.options, screen.props.name),
      ]),
    );
  }

  it("hides the tab bar on the thread, the scanner and the host QR", () => {
    const options = optionsByName();

    for (const name of FULL_WINDOW) {
      expect(options.get(name)?.tabBarStyle, name).toEqual({
        display: "none",
      });
    }
  });

  it("keeps it on every other route", () => {
    const options = optionsByName();
    const [tabs] = hosts(render().root, "Tabs");

    // Hidden for the whole navigator would hide it everywhere.
    expect(
      resolved(tabs.props.screenOptions).tabBarStyle ?? {},
    ).not.toHaveProperty("display");
    expect(options.size).toBeGreaterThan(FULL_WINDOW.length + 4);
    for (const [name, screen] of options) {
      if (FULL_WINDOW.includes(name)) continue;
      expect(screen, name).not.toHaveProperty("tabBarStyle");
    }
  });

  /**
   * With no bar under it, each screen sits on the window's bottom edge, so it
   * must take the bottom safe-area inset itself or its composer, manual code
   * field or QR footer lands under the home indicator or Android's navigation
   * buttons. A render here draws no route, so this reads the route's source.
   */
  it("has each of them take the bottom safe-area inset itself", () => {
    const here = dirname(fileURLToPath(import.meta.url));

    for (const name of FULL_WINDOW) {
      const source = readFileSync(
        join(here, "..", "app", "(tabs)", `${name}.tsx`),
        "utf8",
      );
      const edges = [...source.matchAll(/edges=\{\[([^\]]*)\]\}/g)].map(
        (match) => match[1],
      );
      expect(edges.length, name).toBeGreaterThan(0);
      expect(
        edges.some((list) => list.includes('"bottom"')),
        name,
      ).toBe(true);
    }
  });
});
