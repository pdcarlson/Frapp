/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FrappThemeProvider } from "@/lib/theme";
import { ASK_FLAG_ENV_KEY } from "@/lib/ask/flag";

/**
 * #2259 — every Ask entry point hangs off `isAskAvailable()`.
 *
 * Owner decision 2026-09-22: a build without Ask draws no ✦ pill on Chat home
 * (s04) or Events (s06), and `frapp://ask` redirects to Chat home rather than
 * drawing an Ask shell. The pill used to press through and open a sheet that
 * said Ask was off, which App Review reads as a placeholder (Guideline 2.1).
 * `spec/ui/mobile/navigation.md` § Global entries records the reversal.
 *
 * These render the real screens, because the gate lives in each host's
 * `headerAction` and in `AskSheet` itself — a unit test of the flag alone would
 * pass with every host still drawing the pill. They live here, not beside the
 * screens: a spec under `app/` is a route module and ships in the bundle
 * (`lib/routes.spec.ts`, `docs/mobile/testing.md` § Gotchas).
 */

vi.mock("@repo/hooks", () => {
  const empty = {
    data: [],
    isPending: false,
    isError: false,
    isFetching: false,
    refetch: vi.fn(),
  };
  return {
    useChannels: () => empty,
    useChannelUnreadCounts: () => empty,
    useEvents: () => empty,
    useTasks: () => empty,
    useViewerUserId: () => "viewer-1",
    useMemberDisplayNames: () => ({ byId: {} }),
  };
});

vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({
    accent: "#F4CB63",
    accentFallbackApplied: false,
    accentPrimary: "#EFB63B",
    accentOnPrimary: "#131211",
    logoUrl: null,
    chapterName: null,
  }),
}));

import ChatHomeScreen from "@/app/(tabs)/index";
import EventsScreen from "@/app/(tabs)/events";
import AskScreen from "@/app/(tabs)/ask";

type Node = ReactTestRenderer["root"];

/** Stands in for gorhom's modal instance, so a spec can see `present()`. */
const present = vi.fn();

function render(screen: React.ReactElement): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(<FrappThemeProvider>{screen}</FrappThemeProvider>, {
      // `vitest.setup.ts` mocks `BottomSheetModal` as a host string, so the
      // sheet's forwarded ref lands on whatever this returns for it.
      createNodeMock: (element) =>
        (element.type as unknown) === "BottomSheetModal" ? { present } : null,
    });
  });
  return tree;
}

/**
 * The host-string casts are the ones `lib/onboarding/join-screen.spec.tsx`
 * explains: `tsc` sees react-native's real types, where `node.type` is never
 * the strings `vitest.setup.ts` substitutes.
 */
function askPills(root: Node): Node[] {
  return root.findAll(
    (node) =>
      (node.type as unknown) === "Pressable" &&
      node.props.accessibilityLabel === "Ask",
  );
}

function sheets(root: Node): Node[] {
  return root.findAll((node) => (node.type as unknown) === "BottomSheetModal");
}

function redirects(root: Node): Node[] {
  return root.findAll((node) => (node.type as unknown) === "Redirect");
}

/** Route-level option overrides (`vitest.setup.ts` renders them as hosts). */
function screenOptions(root: Node): Node[] {
  return root.findAll((node) => (node.type as unknown) === "Tabs.Screen");
}

beforeEach(() => {
  delete process.env[ASK_FLAG_ENV_KEY];
  present.mockClear();
});

afterEach(() => {
  delete process.env[ASK_FLAG_ENV_KEY];
});

describe.each([
  ["Chat home (s04)", () => <ChatHomeScreen />],
  ["Events (s06)", () => <EventsScreen />],
])("%s", (_name, screen) => {
  it("draws no ✦ pill and no sheet in a build without Ask", () => {
    const tree = render(screen());

    expect(askPills(tree.root)).toHaveLength(0);
    // The sheet refuses to exist on its own account too, so the synthetic
    // corpus behind it is unreachable whatever a host does.
    expect(sheets(tree.root)).toHaveLength(0);
  });

  it("stays closed for a near-miss spelling of the flag", () => {
    process.env[ASK_FLAG_ENV_KEY] = "TRUE";
    const tree = render(screen());

    expect(askPills(tree.root)).toHaveLength(0);
  });

  it("draws the pill with Ask on, and the pill presents the sheet", () => {
    process.env[ASK_FLAG_ENV_KEY] = "1";
    const tree = render(screen());

    const pills = askPills(tree.root);
    expect(pills).toHaveLength(1);
    expect(sheets(tree.root)).toHaveLength(1);

    act(() => {
      pills[0].props.onPress();
    });
    expect(present).toHaveBeenCalledTimes(1);
  });
});

describe("the ask route (frapp://ask)", () => {
  it("redirects to Chat home in a build without Ask", () => {
    const tree = render(<AskScreen />);

    const found = redirects(tree.root);
    expect(found).toHaveLength(1);
    expect(found[0].props.href).toBe("/");
    // No Ask shell behind the redirect, and nothing presented.
    expect(askPills(tree.root)).toHaveLength(0);
    expect(sheets(tree.root)).toHaveLength(0);
    expect(present).not.toHaveBeenCalled();
  });

  it("hides the tab navigator's Ask header for the frame before the redirect lands", () => {
    const tree = render(<AskScreen />);

    // The frozen `_layout.tsx` titles this route "Ask" with the header on,
    // and `Redirect` navigates from an effect, so without this the arrival
    // paints an empty screen under that header first.
    const options = screenOptions(tree.root);
    expect(options).toHaveLength(1);
    expect(options[0].props.options).toEqual({ headerShown: false });
  });

  it("leaves the header alone with Ask on", () => {
    process.env[ASK_FLAG_ENV_KEY] = "1";
    const tree = render(<AskScreen />);

    expect(screenOptions(tree.root)).toHaveLength(0);
  });

  it("presents the sheet on arrival with Ask on", () => {
    process.env[ASK_FLAG_ENV_KEY] = "true";
    const tree = render(<AskScreen />);

    expect(redirects(tree.root)).toHaveLength(0);
    expect(askPills(tree.root)).toHaveLength(1);
    expect(sheets(tree.root)).toHaveLength(1);
    expect(present).toHaveBeenCalledTimes(1);
  });
});
