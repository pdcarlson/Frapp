/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FrappThemeProvider } from "@/lib/theme";

const device = vi.hoisted(() => ({ bottomInset: 0 }));
vi.mock("react-native-safe-area-context", () => ({
  SafeAreaProvider: "SafeAreaProvider",
  SafeAreaView: "SafeAreaView",
  useSafeAreaInsets: () => ({
    top: 0,
    right: 0,
    bottom: device.bottomInset,
    left: 0,
  }),
}));
vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({ accent: "#F4CB63" }),
}));
vi.mock("@/lib/haptics", () => ({ selectionHaptic: vi.fn() }));
// Activity's tab carries the needs-you count (#4610).
const activity = vi.hoisted(() => ({
  data: undefined as
    | { needs_you_count: number; unavailable: string[] }
    | undefined,
}));
const rereadOnTab = vi.hoisted(() => vi.fn());
vi.mock("@/lib/activity/use-activity-reread", () => ({
  useActivityRereadOnTab: rereadOnTab,
}));
vi.mock("@repo/hooks", () => ({
  useActivity: () => ({ data: activity.data }),
}));

// The You tab's avatar has its own spec (`you-tab-avatar.spec.tsx`); the bar
// only reads the picked status to name it.
const ownStatus = vi.hoisted(() => ({ value: { status: "online" } as { status: string } | null }));
vi.mock("@/lib/account/own-status", () => ({
  useOwnStatus: () => ownStatus.value,
}));

const quick = vi.hoisted(() => ({
  ask: vi.fn(),
  hasAsk: false,
  run: vi.fn(),
  save: vi.fn(),
  ready: true,
  notice: null as string | null,
}));
vi.mock("@/components/quick-actions/use-quick-actions", () => ({
  useQuickActions: () => ({
    shown: ["message", "study"],
    available: ["message", "study"],
    save: quick.save,
    ready: quick.ready,
  }),
}));
vi.mock("@/components/quick-actions/quick-actions-host", () => ({
  useQuickActionsHost: () => ({
    run: quick.run,
    ask: quick.ask,
    sheets: null,
    notice: quick.notice,
  }),
}));
// Whether this member has Ask is the server's answer (`useAiSurfaces`).
vi.mock("@/lib/ai/availability", () => ({
  useAiSurfaces: () => ({
    available: quick.hasAsk,
    ask: quick.hasAsk,
    meetingNotes: false,
    ready: true,
  }),
}));
// The panel has its own spec; here it only has to be there or not.
vi.mock("@/components/quick-actions/quick-actions-panel", () => ({
  QuickActionsPanel: "QuickActionsPanel",
}));
// So has the Ask Frapp bar (`ask/ask-bar.spec.tsx`).
vi.mock("@/components/ask/ask-bar", () => ({ AskBar: "AskBar" }));

import { BackHandler } from "react-native";
import { floatingScreenLayout, useAskBarLift } from "@/lib/floating-chrome";
import { GlassTabBar } from "./glass-tab-bar";

type Node = ReactTestRenderer["root"];
type Route = { key: string; name: string; params?: object };

const ROUTES: Route[] = [
  { key: "index-1", name: "index" },
  { key: "activity-1", name: "activity" },
  { key: "events-1", name: "events" },
  { key: "you-1", name: "you" },
];
const TITLES: Record<string, string> = {
  index: "Chat",
  activity: "Activity",
  events: "Calendar",
  you: "You",
};

const navigation = {
  emit: vi.fn(() => ({ defaultPrevented: false })),
  navigate: vi.fn(),
};

beforeEach(() => {
  navigation.emit.mockClear();
  navigation.navigate.mockClear();
  quick.run.mockReset();
  quick.ready = true;
  quick.notice = null;
  quick.hasAsk = false;
  quick.ask.mockClear();
  activity.data = undefined;
  device.bottomInset = 0;
  vi.mocked(BackHandler.addEventListener).mockClear();
});

/** Android's back, as the bar's latest listener answers it. */
function pressBack(): boolean {
  const calls = vi.mocked(BackHandler.addEventListener).mock.calls;
  const handler = calls[calls.length - 1][1] as () => boolean;
  let handled = false;
  act(() => {
    handled = handler();
  });
  return handled;
}

function element(focused: string) {
  const descriptors = Object.fromEntries(
    ROUTES.map((route) => [
      route.key,
      {
        options: {
          title: TITLES[route.name],
          tabBarIcon: () => null,
        },
      },
    ]),
  );
  const props = {
    state: {
      index: ROUTES.findIndex((r) => r.name === focused),
      routes: ROUTES,
    },
    descriptors,
    navigation,
  } as unknown as Parameters<typeof GlassTabBar>[0];
  return (
    <FrappThemeProvider>
      <GlassTabBar {...props} />
    </FrappThemeProvider>
  );
}

function render(focused = "index"): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(element(focused));
  });
  return tree;
}

const pressables = (root: Node) =>
  root.findAll((node) => (node.type as unknown) === "Pressable");
const byLabel = (root: Node, label: string) =>
  pressables(root).find((node) => node.props.accessibilityLabel === label);
const plus = (root: Node) =>
  pressables(root).find(
    (node) => node.props.accessibilityState?.expanded !== undefined,
  );
const panel = (root: Node) =>
  root.findAll((node) => (node.type as unknown) === "QuickActionsPanel")[0];
const flat = (style: unknown): Record<string, unknown> =>
  Object.assign({}, ...[style].flat(Infinity).filter(Boolean));
const pill = (root: Node) =>
  root.findAll(
    (node) =>
      (node.type as unknown) === "View" &&
      node.props.accessibilityRole === "tablist",
  )[0];

describe("the bar (#3344)", () => {
  it("floats the 62pt pill above the inset, tucked 8pt into it", () => {
    device.bottomInset = 34;
    const style = flat(pill(render().root).props.style);
    expect(style.height).toBe(62);
    expect(style.bottom).toBe(34 - 8);
    expect(style.borderRadius).toBe(31);
    expect(style.left).toBe(14);
    // Leaves room for the 62pt + and the 10pt gap beside it.
    expect(style.right).toBe(14 + 62 + 10);
  });

  it("rounds the glass itself, not only its frame", () => {
    // GlassSurface clips to the radius in its own style.
    const [glass] = pill(render().root).findAll(
      (node) =>
        typeof node.type === "string" && node.props.testID === "glass-surface",
    );
    expect(flat(glass.props.style).borderRadius).toBe(31);
  });

  it("keeps 12pt off the edge where there is no inset", () => {
    expect(flat(pill(render().root).props.style).bottom).toBe(12);
  });

  it("names a picked status on the You tab, and says nothing of Online (#3839)", () => {
    const youLabel = () =>
      pressables(render("events").root).find(
        (node) =>
          node.props.accessibilityRole === "tab" &&
          node.props.testID === "tab-you",
      )!.props.accessibilityLabel;
    expect(youLabel()).toBe("You");
    ownStatus.value = { status: "dnd" };
    try {
      expect(youLabel()).toBe("You, Do Not Disturb");
    } finally {
      ownStatus.value = { status: "online" };
    }
  });

  it("draws the four tabs in order, the focused one selected", () => {
    const tabs = pressables(render("events").root).filter(
      (node) => node.props.accessibilityRole === "tab",
    );
    expect(tabs.map((tab) => tab.props.accessibilityLabel)).toEqual([
      "Chat",
      "Activity",
      "Calendar",
      "You",
    ]);
    expect(tabs.map((tab) => tab.props.accessibilityState.selected)).toEqual([
      false,
      false,
      true,
      false,
    ]);
  });

  it("puts the needs-you count on Activity's tab, and only while something waits", () => {
    const badge = (tree: ReactTestRenderer) =>
      tree.root.findAll(
        (node) =>
          typeof node.type === "string" &&
          node.props.testID === "tab-activity-badge",
      );
    expect(badge(render())).toHaveLength(0);

    activity.data = { needs_you_count: 0, unavailable: [] };
    expect(badge(render())).toHaveLength(0);

    activity.data = { needs_you_count: 8, unavailable: [] };
    const tree = render();
    expect(badge(tree)).toHaveLength(1);
    expect(byLabel(tree.root, "Activity, 8 waiting on you")).toBeDefined();

    // A section the server couldn't read: at least, never a false total.
    activity.data = { needs_you_count: 2, unavailable: ["polls"] };
    expect(
      byLabel(render().root, "Activity, at least 2 waiting on you"),
    ).toBeDefined();
  });

  it("holds the badge's count fresh, leaving Activity's own re-read to it", () => {
    // The hook itself is pinned in `use-activity-reread.spec.tsx`.
    rereadOnTab.mockClear();
    render("events");
    expect(rereadOnTab).toHaveBeenLastCalledWith("events-1", false);
    render("activity");
    expect(rereadOnTab).toHaveBeenLastCalledWith("activity-1", true);
  });

  it("goes to a tab on press, unless the press was taken", () => {
    const tree = render();
    act(() => byLabel(tree.root, "Activity")!.props.onPress());
    expect(navigation.emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: "tabPress", target: "activity-1" }),
    );
    expect(navigation.navigate).toHaveBeenCalledWith("activity", undefined);

    navigation.navigate.mockClear();
    act(() => byLabel(tree.root, "Chat")!.props.onPress());
    expect(navigation.navigate).not.toHaveBeenCalled();
  });
});

describe("the +", () => {
  it("opens the panel, then closes it as an X", () => {
    const tree = render();
    expect(panel(tree.root)).toBeUndefined();

    act(() => plus(tree.root)!.props.onPress());
    expect(panel(tree.root).props.editing).toBe(false);
    expect(plus(tree.root)!.props.accessibilityLabel).toBe(
      "Close quick actions",
    );

    act(() => plus(tree.root)!.props.onPress());
    expect(panel(tree.root)).toBeUndefined();
  });

  it("goes straight to editing on a hold", () => {
    const tree = render();
    act(() => plus(tree.root)!.props.onLongPress());
    expect(panel(tree.root).props.editing).toBe(true);
  });

  it("holds the + while open to start editing", () => {
    const tree = render();
    act(() => plus(tree.root)!.props.onPress());
    act(() => plus(tree.root)!.props.onLongPress());
    expect(panel(tree.root).props.editing).toBe(true);
  });

  it("offers no editing until the member's role is in hand", () => {
    quick.ready = false;
    const tree = render();
    act(() => plus(tree.root)!.props.onLongPress());
    expect(panel(tree.root).props.editing).toBe(false);
    expect(panel(tree.root).props.canEdit).toBe(false);
  });

  it("leaves editing on Android's back, then closes", () => {
    const tree = render();
    act(() => plus(tree.root)!.props.onLongPress());
    expect(pressBack()).toBe(true);
    expect(panel(tree.root).props.editing).toBe(false);
    expect(pressBack()).toBe(true);
    expect(panel(tree.root)).toBeUndefined();
  });

  it("leaves editing on the screen reader's escape, then closes", () => {
    const tree = render();
    act(() => plus(tree.root)!.props.onLongPress());
    const container = () =>
      tree.root.findAll(
        (node) =>
          (node.type as unknown) === "Animated.View" &&
          typeof node.props.onAccessibilityEscape === "function",
      )[0];
    // Not modal: VoiceOver can still reach the X and the scrim.
    expect(container().props.accessibilityViewIsModal).toBeUndefined();
    act(() => container().props.onAccessibilityEscape());
    expect(panel(tree.root).props.editing).toBe(false);
    act(() => container().props.onAccessibilityEscape());
    expect(panel(tree.root)).toBeUndefined();
  });

  it("closes on the scrim", () => {
    const tree = render();
    act(() => plus(tree.root)!.props.onPress());
    const scrim = pressables(tree.root).find(
      (node) =>
        node.props.accessibilityLabel === "Close quick actions" &&
        node.props.accessibilityState === undefined,
    );
    act(() => scrim!.props.onPress());
    expect(panel(tree.root)).toBeUndefined();
  });

  it("closes the panel and runs the action picked", () => {
    const tree = render();
    act(() => plus(tree.root)!.props.onPress());
    act(() => panel(tree.root).props.onRun("study"));
    expect(quick.run).toHaveBeenCalledWith("study");
    expect(panel(tree.root)).toBeUndefined();
  });

  it("closes when the member moves to another screen", () => {
    const tree = render();
    act(() => plus(tree.root)!.props.onPress());
    act(() => tree.update(element("events")));
    expect(panel(tree.root)).toBeUndefined();
    // And stays closed on the way back.
    act(() => tree.update(element("index")));
    expect(panel(tree.root)).toBeUndefined();
  });
});

/**
 * Ask Frapp's front door (#4702, Paul 2026-11-13): "in a bar above the normal
 * liquid glass bottom, not only when you open the plus menu".
 */
describe("the Ask Frapp bar", () => {
  const askBar = (root: Node) =>
    root.findAll((node) => (node.type as unknown) === "AskBar")[0];
  /** The wrapper the tab bar places it with. */
  const placed = (root: Node) => flat(askBar(root).parent!.props.style);
  /** What a tab screen is told to lift its floating things by. */
  function liftOnATab(): number {
    let seen = -1;
    function Probe() {
      seen = useAskBarLift();
      return null;
    }
    act(() => {
      create(
        floatingScreenLayout({
          route: { name: "index" },
          navigation: { addListener: () => () => {} },
          children: <Probe />,
        } as unknown as Parameters<typeof floatingScreenLayout>[0]),
      );
    });
    return seen;
  }

  it("is not there for a member without Ask, and the screens are not told to make room", () => {
    const tree = render();
    expect(askBar(tree.root)).toBeUndefined();
    expect(liftOnATab()).toBe(0);
  });

  it("sits 8pt above the tab bar, as wide as the bar and its + together, on every tab", () => {
    quick.hasAsk = true;
    for (const tab of ["index", "activity", "events", "you"]) {
      const tree = render(tab);
      // No inset: the tab bar's top is 12 + 62 off the edge.
      expect(placed(tree.root)).toMatchObject({
        position: "absolute",
        left: 14,
        right: 14,
        bottom: 12 + 62 + 8,
      });
      act(() => tree.unmount());
    }
  });

  it("rides up with the tab bar over a home indicator", () => {
    quick.hasAsk = true;
    device.bottomInset = 34;
    expect(placed(render().root).bottom).toBe(26 + 62 + 8);
  });

  it("opens the conversation", () => {
    quick.hasAsk = true;
    const tree = render();
    act(() => askBar(tree.root).props.onPress());
    expect(quick.ask).toHaveBeenCalledTimes(1);
  });

  it("tells the tab screens to make room while it is there, and stops when it goes", () => {
    quick.hasAsk = true;
    const tree = render();
    expect(liftOnATab()).toBe(48 + 8);
    // The president turns Ask off: the bar goes and the room is given back.
    quick.hasAsk = false;
    act(() => tree.update(element("index")));
    expect(askBar(tree.root)).toBeUndefined();
    expect(liftOnATab()).toBe(0);
  });

  it("gives the room back when the tab bar itself goes", () => {
    quick.hasAsk = true;
    const tree = render();
    act(() => tree.unmount());
    expect(liftOnATab()).toBe(0);
  });

  it("is covered by the open + panel, which no longer holds an Ask row of its own", () => {
    quick.hasAsk = true;
    const tree = render();
    act(() => plus(tree.root)!.props.onPress());
    expect(askBar(tree.root)).toBeUndefined();
    expect(panel(tree.root).props.onAsk).toBeUndefined();
    act(() => plus(tree.root)!.props.onPress());
    expect(askBar(tree.root)).toBeDefined();
  });
});

describe("a confirmation", () => {
  /** How far off the bottom edge the confirmation's row is placed. */
  const noticeBottom = (root: Node): number => {
    let node: Node | null = root
      .findAll((candidate) => (candidate.type as unknown) === "Text")
      .find((text) => text.props.children === "Assigned to Sam Rivera.")!;
    while (node && flat(node.props.style).bottom === undefined) {
      node = node.parent;
    }
    return flat(node!.props.style).bottom as number;
  };

  it("sits above the Ask Frapp bar for a member who has one, never over it", () => {
    quick.notice = "Assigned to Sam Rivera.";
    const without = noticeBottom(render().root);
    quick.hasAsk = true;
    const withBar = noticeBottom(render().root);
    // The Ask bar's own top edge, plus the gap a notice keeps.
    expect(withBar).toBe(12 + 62 + 8 + 48 + 10);
    expect(withBar).toBeGreaterThan(without);
  });

  it("shows above the bar, and not over an open panel", () => {
    quick.notice = "Assigned to Sam Rivera.";
    const tree = render();
    const texts = () =>
      tree.root
        .findAll((node) => (node.type as unknown) === "Text")
        .map((node) => node.props.children);
    expect(texts()).toContain("Assigned to Sam Rivera.");
    act(() => plus(tree.root)!.props.onPress());
    expect(texts()).not.toContain("Assigned to Sam Rivera.");
  });
});
