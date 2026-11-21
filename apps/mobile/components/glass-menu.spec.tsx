/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { AccessibilityInfo, BackHandler, StyleSheet, Text } from "react-native";
import { useReducedMotion } from "react-native-reanimated";
import {
  create,
  type ReactTestInstance,
  type ReactTestRenderer,
} from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FrappThemeProvider } from "@/lib/theme";
import type { ClientPolicy } from "@/lib/client-policy";
import { type FocusReturn, useBackToClose } from "@/lib/overlay";

const policy = vi.hoisted(() => ({
  current: { updateRequired: false, updateUrl: null } as ClientPolicy,
}));
vi.mock("@/lib/client-policy", () => ({
  useClientPolicy: () => policy.current,
}));
vi.mock("@/components/route-error", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/route-error")>()),
  reportRouteError: vi.fn(),
}));

import { reportRouteError } from "@/components/route-error";

import {
  ClientPolicyGate,
  UPDATE_REQUIRED_COPY,
} from "@/components/client-policy-gate";
import { GlassMenu } from "@/components/glass-menu";
import { ItemActionsMenu } from "@/components/item-actions-menu";
import { OverlayLayer } from "@/components/overlay-layer";

/**
 * The glass menu's shell (#5517): drawn in the app's overlay layer, never a
 * React Native `Modal`, so the update gate stays above it
 * (`spec/ui/mobile/patterns.md` § Overlays).
 */

const BACKDROP = "glass-menu-backdrop";

interface MenuProps {
  visible: boolean;
  pageY?: number;
  onClose: () => void;
  returnFocusTo?: FocusReturn | null;
  body?: React.ReactNode;
}

function Menu({
  visible,
  pageY = 200,
  onClose,
  returnFocusTo,
  body = <Text>Sweep the porch</Text>,
}: MenuProps) {
  return (
    <GlassMenu
      visible={visible}
      pageY={pageY}
      onClose={onClose}
      returnFocusTo={returnFocusTo}
      backdropTestID={BACKDROP}
    >
      {body}
    </GlassMenu>
  );
}

/** A screen somewhere down the app with the menu in it. */
function App(props: MenuProps) {
  return (
    <>
      <Text testID="screen">the screen</Text>
      <Menu {...props} />
    </>
  );
}

/** A sheet presented over the screen, holding back as every sheet does. */
function Sheet({ onClose }: { onClose: () => void }) {
  useBackToClose(true, onClose);
  return null;
}

/**
 * Android's back press as `BackHandler` delivers it: newest live listener
 * first, on down until one returns true.
 */
function pressBack(): boolean {
  const { calls, results } = addListener().mock;
  for (let i = calls.length - 1; i >= 0; i -= 1) {
    const subscription = results[i]!.value as {
      remove: { mock: { calls: unknown[] } };
    };
    if (subscription.remove.mock.calls.length > 0) continue;
    const handler = calls[i]![1] as unknown as () => boolean;
    let handled = false;
    act(() => {
      handled = handler();
    });
    if (handled) return true;
  }
  return false;
}

function Thrower(): React.ReactElement {
  throw new Error("menu body broke");
}

function render(element: React.ReactElement): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(<FrappThemeProvider>{element}</FrappThemeProvider>);
  });
  return tree;
}

const modals = (tree: ReactTestRenderer) =>
  tree.root.findAll((node) => (node.type as unknown) === "Modal");

const backdrop = (tree: ReactTestRenderer) =>
  tree.root.find((node) => node.props.testID === BACKDROP);

/** The host View the layer wraps the app in, found through the screen. */
function appWrapper(tree: ReactTestRenderer): ReactTestInstance {
  let node = tree.root.findByProps({ testID: "screen" }).parent!;
  while (typeof node.type !== "string") node = node.parent!;
  return node;
}

/** The host nodes React renders directly into `node`'s parent host view. */
function hostChildren(node: ReactTestInstance): ReactTestInstance[] {
  return node.children.flatMap((child) => {
    if (typeof child === "string") return [];
    return typeof child.type === "string" ? [child] : hostChildren(child);
  });
}

const addListener = () => vi.mocked(BackHandler.addEventListener);

beforeEach(() => {
  addListener().mockClear();
  policy.current = { updateRequired: false, updateUrl: null };
});

describe("GlassMenu in the overlay layer", () => {
  it("draws in the app's own tree, after the app, never in a Modal", () => {
    const tree = render(
      <OverlayLayer>
        <App visible onClose={vi.fn()} />
      </OverlayLayer>,
    );

    expect(modals(tree)).toHaveLength(0);
    // The layer's last child, so on top in paint and hit-testing.
    const layer = tree.root.findByType(OverlayLayer);
    const [wrapper, menu, ...rest] = hostChildren(layer);
    expect(rest).toHaveLength(0);
    expect(wrapper).toBe(appWrapper(tree));
    expect(
      menu!.findAll((node) => node.props.testID === BACKDROP),
    ).toHaveLength(1);
    expect(menu!.props.accessibilityViewIsModal).toBe(true);
    // Not drawn where the screen put it.
    expect(
      appWrapper(tree).findAll((node) => node.props.testID === BACKDROP),
    ).toHaveLength(0);
    act(() => tree.unmount());
  });

  it("takes the app out of the accessibility tree only while it is up", () => {
    const onClose = vi.fn();
    const tree = render(
      <OverlayLayer>
        <App visible={false} onClose={onClose} />
      </OverlayLayer>,
    );
    // One native view throughout, so the toggle never re-parents the app.
    expect(appWrapper(tree).props.collapsable).toBe(false);
    expect(appWrapper(tree).props.accessibilityElementsHidden).toBe(false);
    expect(appWrapper(tree).props.importantForAccessibility).toBe("auto");

    act(() =>
      tree.update(
        <FrappThemeProvider>
          <OverlayLayer>
            <App visible onClose={onClose} />
          </OverlayLayer>
        </FrappThemeProvider>,
      ),
    );
    expect(appWrapper(tree).props.accessibilityElementsHidden).toBe(true);
    expect(appWrapper(tree).props.importantForAccessibility).toBe(
      "no-hide-descendants",
    );

    act(() =>
      tree.update(
        <FrappThemeProvider>
          <OverlayLayer>
            <App visible={false} onClose={onClose} />
          </OverlayLayer>
        </FrappThemeProvider>,
      ),
    );
    expect(tree.root.findAll((node) => node.props.testID === BACKDROP)).toEqual(
      [],
    );
    expect(appWrapper(tree).props.accessibilityElementsHidden).toBe(false);
    act(() => tree.unmount());
  });

  it("stays under the update gate, which covers it and takes its touches", () => {
    policy.current = { updateRequired: true, updateUrl: "https://a.test/app" };
    const tree = render(
      <ClientPolicyGate>
        <App visible onClose={vi.fn()} />
      </ClientPolicyGate>,
    );

    // A Modal is its own native window and would draw over the gate.
    expect(modals(tree)).toHaveLength(0);
    const gate = tree.root.findByType(ClientPolicyGate);
    const [root] = hostChildren(gate);
    const [covered, prompt, ...rest] = hostChildren(root!);
    expect(rest).toHaveLength(0);
    // The menu is inside what the gate covers, and the prompt comes after it.
    expect(
      covered!.findAll((node) => node.props.testID === BACKDROP),
    ).toHaveLength(1);
    expect(covered!.props.pointerEvents).toBe("none");
    expect(covered!.props.importantForAccessibility).toBe(
      "no-hide-descendants",
    );
    expect(
      prompt!.findAll(
        (node) =>
          (node.type as unknown) === "Text" &&
          node.props.children === UPDATE_REQUIRED_COPY.title,
      ),
    ).toHaveLength(1);
    act(() => tree.unmount());
  });

  it("is drawn by the layer the gate mounts, not in place in the screen", () => {
    const tree = render(
      <ClientPolicyGate>
        <App visible onClose={vi.fn()} />
      </ClientPolicyGate>,
    );
    const [layer] = tree.root
      .findByType(ClientPolicyGate)
      .findAllByType(OverlayLayer);
    expect(layer).toBeDefined();
    const children = hostChildren(layer!);
    expect(children).toHaveLength(2);
    expect(children[0]).toBe(appWrapper(tree));
    expect(
      children[1]!.findAll((node) => node.props.testID === BACKDROP),
    ).toHaveLength(1);
    expect(
      appWrapper(tree).findAll((node) => node.props.testID === BACKDROP),
    ).toHaveLength(0);
    act(() => tree.unmount());
  });

  it("closes on a tap outside", () => {
    const onClose = vi.fn();
    const tree = render(
      <OverlayLayer>
        <App visible onClose={onClose} />
      </OverlayLayer>,
    );
    act(() => backdrop(tree).props.onPress());
    expect(onClose).toHaveBeenCalledTimes(1);
    act(() => tree.unmount());
  });

  it("closes on Android's back while open, and holds nothing while closed", () => {
    const onClose = vi.fn();
    const closed = render(
      <OverlayLayer>
        <App visible={false} onClose={onClose} />
      </OverlayLayer>,
    );
    expect(addListener()).not.toHaveBeenCalled();
    act(() => closed.unmount());

    const tree = render(
      <OverlayLayer>
        <App visible onClose={onClose} />
      </OverlayLayer>,
    );
    const [event, handler] = addListener().mock.calls.at(-1) as unknown as [
      string,
      () => boolean,
    ];
    expect(event).toBe("hardwareBackPress");
    // Handled, so the navigator underneath doesn't pop.
    expect(handler()).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(1);
    act(() => tree.unmount());
  });

  it("closes on VoiceOver's escape gesture", () => {
    const onClose = vi.fn();
    const tree = render(
      <OverlayLayer>
        <App visible onClose={onClose} />
      </OverlayLayer>,
    );
    const modal = tree.root.find(
      (node) => node.props.accessibilityViewIsModal === true,
    );
    act(() => modal.props.onAccessibilityEscape());
    expect(onClose).toHaveBeenCalledTimes(1);
    act(() => tree.unmount());
  });

  it.each([
    ["below the press when it fits", 200, 200 + 12],
    // 874 window, no insets: the floor is 874 - 16 - 300; above is 700 - 12 - 300.
    ["above it when it doesn't", 700, 700 - 12 - 300],
  ])("opens %s, hidden until measured", (_label, pageY, top) => {
    const tree = render(
      <OverlayLayer>
        <App visible pageY={pageY} onClose={vi.fn()} />
      </OverlayLayer>,
    );
    const anchor = () =>
      tree.root.find(
        (node) =>
          typeof node.props.onLayout === "function" &&
          StyleSheet.flatten(node.props.style)?.position === "absolute",
      );
    expect(StyleSheet.flatten(anchor().props.style).opacity).toBe(0);
    act(() =>
      anchor().props.onLayout({ nativeEvent: { layout: { height: 300 } } }),
    );
    const style = StyleSheet.flatten(anchor().props.style);
    expect(style.opacity).toBe(1);
    expect(style.top).toBe(top);
    act(() => tree.unmount());
  });

  it("draws in place with no layer above it, as a spec renders a screen alone", () => {
    const tree = render(<App visible onClose={vi.fn()} />);
    expect(modals(tree)).toHaveLength(0);
    expect(
      tree.root.findAll((node) => node.props.testID === BACKDROP),
    ).toHaveLength(1);
    act(() => tree.unmount());
  });

  it("takes Android's back ahead of a sheet presented under it, and gives it back on close", () => {
    const menuClose = vi.fn();
    const sheetClose = vi.fn();
    const app = (visible: boolean) => (
      <FrappThemeProvider>
        <OverlayLayer>
          <App visible={visible} onClose={menuClose} />
          {/* A startup sheet's turn coming up after the menu opened. */}
          <Sheet onClose={sheetClose} />
        </OverlayLayer>
      </FrappThemeProvider>
    );
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(app(true));
    });

    expect(pressBack()).toBe(true);
    expect(menuClose).toHaveBeenCalledTimes(1);
    expect(sheetClose).not.toHaveBeenCalled();

    act(() => tree.update(app(false)));
    expect(pressBack()).toBe(true);
    expect(sheetClose).toHaveBeenCalledTimes(1);
    act(() => tree.unmount());
  });

  describe("a screen reader's focus on close", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.mocked(AccessibilityInfo.sendAccessibilityEvent).mockClear();
      vi.mocked(AccessibilityInfo.setAccessibilityFocus).mockClear();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    const app = (visible: boolean, returnFocusTo: FocusReturn | null) => (
      <FrappThemeProvider>
        <OverlayLayer>
          <App
            visible={visible}
            onClose={vi.fn()}
            // As the screen holds it: gone with the target on close.
            returnFocusTo={visible ? returnFocusTo : null}
          />
        </OverlayLayer>
      </FrappThemeProvider>
    );

    it.each([
      ["view", { row: "General" } as unknown as FocusReturn],
      ["tag", 42],
    ])(
      "goes back to the row that opened it (its %s), once it has gone",
      (_kind, row) => {
        let tree!: ReactTestRenderer;
        act(() => {
          tree = create(app(true, row));
        });
        act(() => vi.runAllTimers());
        vi.mocked(AccessibilityInfo.sendAccessibilityEvent).mockClear();

        act(() => tree.update(app(false, row)));
        expect(AccessibilityInfo.sendAccessibilityEvent).not.toHaveBeenCalled();
        act(() => vi.runAllTimers());

        if (typeof row === "number") {
          expect(AccessibilityInfo.setAccessibilityFocus).toHaveBeenCalledWith(
            42,
          );
        } else {
          expect(AccessibilityInfo.sendAccessibilityEvent).toHaveBeenCalledWith(
            row,
            "focus",
          );
        }
        act(() => tree.unmount());
      },
    );
  });

  it("drops a body that throws and closes, leaving the app up", () => {
    vi.mocked(reportRouteError).mockClear();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const onClose = vi.fn();
    const tree = render(
      <OverlayLayer>
        <App visible onClose={onClose} body={<Thrower />} />
      </OverlayLayer>,
    );
    error.mockRestore();

    expect(tree.root.findByProps({ testID: "screen" })).toBeDefined();
    expect(tree.root.findAll((node) => node.props.testID === BACKDROP)).toEqual(
      [],
    );
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(reportRouteError).toHaveBeenCalledWith(expect.any(Error), {
      boundary: "overlay",
    });
    act(() => tree.unmount());
  });

  it("keeps up with the screen while it is open", () => {
    const menu = (title: string) => (
      <FrappThemeProvider>
        <OverlayLayer>
          <ItemActionsMenu
            target={{
              title,
              pageY: 200,
              key: 1,
              actions: [
                { key: "edit", label: "Edit", glyph: () => null, run: vi.fn() },
              ],
            }}
            onClose={vi.fn()}
          />
        </OverlayLayer>
      </FrappThemeProvider>
    );
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(menu("Sweep the porch"));
    });
    const caption = (text: string) =>
      tree.root.findAll(
        (node) =>
          (node.type as unknown) === "Text" && node.props.children === text,
      );
    expect(caption("Sweep the porch")).toHaveLength(1);

    act(() => tree.update(menu("Sweep the porch and the steps")));
    expect(caption("Sweep the porch")).toHaveLength(0);
    expect(caption("Sweep the porch and the steps")).toHaveLength(1);
    act(() => tree.unmount());
  });

  it.each([
    [false, "a lift out of the row"],
    [true, "a plain fade"],
  ])("with Reduce Motion %s, opens with %s", (reduce) => {
    vi.mocked(useReducedMotion).mockReturnValue(reduce);
    try {
      const tree = render(
        <OverlayLayer>
          <App visible onClose={vi.fn()} />
        </OverlayLayer>,
      );
      const anchor = tree.root.find(
        (node) =>
          typeof node.props.onLayout === "function" &&
          StyleSheet.flatten(node.props.style)?.position === "absolute",
      );
      const entering = anchor.props.entering as
        | { animation?: string; durationMs?: number }
        | ((...args: unknown[]) => unknown);
      if (reduce) {
        expect(entering).toMatchObject({
          animation: "FadeIn",
          durationMs: 120,
        });
      } else {
        expect(typeof entering).toBe("function");
        expect((entering as { name: string }).name).toBe("popIn");
      }
      act(() => tree.unmount());
    } finally {
      vi.mocked(useReducedMotion).mockReturnValue(false);
    }
  });
});
