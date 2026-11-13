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

// The first-run tour wraps the navigator and reads the signed-in member; it
// has its own spec (`components/onboarding/tour.spec.tsx`).
vi.mock("@/components/onboarding/tour", () => ({
  TourHost: ({ children }: { children: React.ReactNode }) => children,
  useTourAnchor: () => undefined,
  useTourReady: () => undefined,
}));
// So does What's new's host beside it (`components/whats-new/whats-new-host.spec.tsx`).
vi.mock("@/components/whats-new/whats-new-host", () => ({
  WhatsNewHost: "WhatsNewHost",
}));
vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({ accent: "#F4CB63" }),
}));

import TabLayout from "@/app/(app)/(tabs)/_layout";
import AppLayout, { unstable_settings } from "@/app/(app)/_layout";
import { TAB_ROUTES } from "@/components/glass-tab-bar";
import { YouTabAvatar } from "@/components/you-tab-avatar";
import { stackScreenLayout } from "@/components/route-error";

type Node = ReactTestRenderer["root"];

function render(Layout: () => React.ReactNode = TabLayout): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <Layout />
      </FrappThemeProvider>,
    );
  });
  return tree;
}

/**
 * `vitest.setup.ts` renders `Tabs`, `Stack` and their `.Screen`s as host
 * nodes named for what they stand in for; the casts are the ones
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
   * On a tab, the tab router's default (`firstRoute`) sends back straight to
   * Chat home. History sends it to the tab the member came from. Pushed
   * screens sit on the stack above and pop first (below).
   */
  it("returns to the tab the member came from", () => {
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
    // The four tabs: an empty list would pass the check below vacuously.
    expect(screens).toHaveLength(4);
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
  it("draws in the bar exactly the tabs the layout leaves visible", () => {
    // GlassTabBar draws `TAB_ROUTES`, so the two lists have to agree.
    const visible = hosts(render().root, "Tabs.Screen")
      .filter((screen) => resolved(screen.props.options).href !== null)
      .map((screen) => screen.props.name);
    expect(visible).toEqual([...TAB_ROUTES]);
  });

  // #3839: the You tab's glyph is the member's own avatar, ringed in the
  // accent while active, not a nav-set glyph.
  it("draws the member's avatar as the You tab's glyph", () => {
    const you = hosts(render().root, "Tabs.Screen").find(
      (screen) => screen.props.name === "you",
    )!;
    const options = resolved(you.props.options);
    expect(options.title).toBe("You");
    const icon = (
      options.tabBarIcon as (props: object) => React.ReactElement<{
        focused: boolean;
      }>
    )({ focused: true, color: "#000", size: 24 });
    expect(icon.type).toBe(YouTabAvatar);
    expect(icon.props.focused).toBe(true);
  });

  it("draws the glass pill and + in place of the navigator's bar", () => {
    const [tabs] = hosts(render().root, "Tabs");
    expect(typeof tabs.props.tabBar).toBe("function");
    expect(resolved(tabs.props.screenOptions)).not.toHaveProperty(
      "tabBarStyle",
    );
  });
});

describe("What's new", () => {
  // Opens by itself after an update; dropping the host turns that off.
  it("mounts its host beside the navigator", () => {
    expect(hosts(render().root, "WhatsNewHost")).toHaveLength(1);
  });
});

/**
 * Every screen outside the four tabs is pushed on a native stack over them
 * (`app/(app)/_layout.tsx`), so the iOS edge swipe and Android's back pop it
 * (`spec/ui/mobile/navigation.md` § Going back). They used to be hidden tabs,
 * and a tab switch has no back gesture: nothing but the Chat home tab could be
 * reached from a thread without the drawn `‹`.
 */
describe("app stack", () => {
  function stack() {
    const tree = render(AppLayout);
    const [navigator] = hosts(tree.root, "Stack");
    return { navigator: navigator!, screens: hosts(tree.root, "Stack.Screen") };
  }

  it("pushes every screen but the tabs over them, with no header", () => {
    const { navigator, screens } = stack();
    expect(resolved(navigator.props.screenOptions).headerShown).toBe(false);
    expect(screens[0]!.props.name).toBe("(tabs)");
    // routes.spec.ts holds that every pushed route file is registered.
    expect(screens.length).toBeGreaterThan(10);
  });

  it("leaves the back gesture on for every screen", () => {
    const { navigator, screens } = stack();
    expect(resolved(navigator.props.screenOptions)).not.toHaveProperty(
      "gestureEnabled",
    );
    for (const screen of screens) {
      const options = resolved(screen.props.options, screen.props.name);
      expect(options, screen.props.name).not.toHaveProperty("gestureEnabled");
      expect(options, screen.props.name).not.toHaveProperty("headerShown");
      expect(options, screen.props.name).not.toHaveProperty("header");
    }
  });

  // Messages lives to the right of Chat, so it pushes in from the right on
  // Android too, where the stack's default is a short fade-and-shift (#4447).
  it("pushes Messages in from the right on both platforms", () => {
    const { screens } = stack();
    const messages = screens.find((screen) => screen.props.name === "messages");
    expect(resolved(messages!.props.options, "messages").animation).toBe(
      "ios_from_right",
    );
  });

  it("puts the tabs under a screen opened by link", () => {
    // A cold `frapp://event-details` or a notification tap still has Chat
    // home under it, so its swipe and its back capsule land somewhere.
    expect(unstable_settings.anchor).toBe("(tabs)");
  });

  it("puts each pushed screen in its own error boundary", () => {
    expect(stack().navigator.props.screenLayout).toBe(stackScreenLayout);
  });

  /**
   * A pushed screen covers the tab bar and sits on the window's bottom edge,
   * so it must take the bottom safe-area inset itself (ScreenShell does) or
   * its composer, manual code field or QR footer lands under the home
   * indicator or Android's navigation buttons. A render here draws no route,
   * so this reads each route's source.
   */
  it("has each pushed screen take the bottom safe-area inset", () => {
    const appGroup = join(
      dirname(fileURLToPath(import.meta.url)),
      "..",
      "app",
      "(app)",
    );
    const pushed = stack()
      .screens.map((screen) => screen.props.name as string)
      // `ask` only redirects to Chat home.
      .filter((name) => name !== "(tabs)" && name !== "ask");

    for (const name of pushed) {
      const source = readFileSync(join(appGroup, `${name}.tsx`), "utf8");
      const edges = [...source.matchAll(/edges=\{\[([^\]]*)\]\}/g)].map(
        (match) => match[1],
      );
      const takesInset =
        /<ScreenShell\b/.test(source) ||
        edges.some((list) => list!.includes('"bottom"'));
      expect(takesInset, name).toBe(true);
    }
  });
});
