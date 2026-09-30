/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import { FrappThemeProvider } from "@/lib/theme";

/**
 * #2485 — no tab screen gets the navigator's header.
 *
 * Every screen draws its own title (`ScreenShell`, the thread's `‹ #name` bar,
 * the Canvas board's layout), so a navigator header on top of it is the same
 * title said twice, which is what every App Store screenshot showed. This
 * renders the real layout, rather than reading its source, and holds both
 * halves: the header is off for the whole navigator, and no registration turns
 * one back on for itself.
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

describe("tab layout (#2485)", () => {
  it("draws no navigator header over any screen", () => {
    const tree = render();

    const [tabs] = hosts(tree.root, "Tabs");
    expect(tabs.props.screenOptions.headerShown).toBe(false);
  });

  it("lets no registration bring a header back for itself", () => {
    const tree = render();

    const screens = hosts(tree.root, "Tabs.Screen");
    // The four tabs and every hidden route: an empty list would pass the
    // check below vacuously.
    expect(screens.length).toBeGreaterThan(4);
    for (const screen of screens) {
      const options = screen.props.options ?? {};
      expect(options, screen.props.name).not.toHaveProperty("headerShown");
      expect(options, screen.props.name).not.toHaveProperty("header");
      expect(options, screen.props.name).not.toHaveProperty("headerTitle");
    }
  });
});
