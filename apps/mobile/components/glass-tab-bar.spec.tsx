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

const quick = vi.hoisted(() => ({
  run: vi.fn(),
  save: vi.fn(),
  ready: true,
  notice: null as string | null,
}));
vi.mock("@/components/quick-actions/use-quick-actions", () => ({
  useQuickActions: () => ({
    shown: ["message", "checkIn"],
    available: ["message", "checkIn"],
    save: quick.save,
    ready: quick.ready,
  }),
}));
vi.mock("@/components/quick-actions/quick-actions-host", () => ({
  useQuickActionsHost: () => ({
    run: quick.run,
    sheets: null,
    notice: quick.notice,
  }),
}));
// The panel has its own spec; here it only has to be there or not.
vi.mock("@/components/quick-actions/quick-actions-panel", () => ({
  QuickActionsPanel: "QuickActionsPanel",
}));

import { BackHandler } from "react-native";
import { GlassTabBar } from "./glass-tab-bar";

type Node = ReactTestRenderer["root"];
type Route = { key: string; name: string; params?: object };

const ROUTES: Route[] = [
  { key: "index-1", name: "index" },
  { key: "events-1", name: "events" },
  { key: "tasks-1", name: "tasks" },
  { key: "more-1", name: "more" },
];
const TITLES: Record<string, string> = {
  index: "Chat",
  events: "Events",
  tasks: "Tasks",
  more: "More",
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

  it("draws the four tabs in order, the focused one selected", () => {
    const tabs = pressables(render("events").root).filter(
      (node) => node.props.accessibilityRole === "tab",
    );
    expect(tabs.map((tab) => tab.props.accessibilityLabel)).toEqual([
      "Chat",
      "Events",
      "Tasks",
      "More",
    ]);
    expect(tabs.map((tab) => tab.props.accessibilityState.selected)).toEqual([
      false,
      true,
      false,
      false,
    ]);
  });

  it("goes to a tab on press, unless the press was taken", () => {
    const tree = render();
    act(() => byLabel(tree.root, "Tasks")!.props.onPress());
    expect(navigation.emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: "tabPress", target: "tasks-1" }),
    );
    expect(navigation.navigate).toHaveBeenCalledWith("tasks", undefined);

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
    act(() => panel(tree.root).props.onRun("checkIn"));
    expect(quick.run).toHaveBeenCalledWith("checkIn");
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

describe("a confirmation", () => {
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
