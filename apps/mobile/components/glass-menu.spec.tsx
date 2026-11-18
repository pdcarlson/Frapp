/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { BackHandler, StyleSheet, Text } from "react-native";
import {
  create,
  type ReactTestInstance,
  type ReactTestRenderer,
} from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FrappThemeProvider } from "@/lib/theme";
import type { ClientPolicy } from "@/lib/client-policy";

const policy = vi.hoisted(() => ({
  current: { updateRequired: false, updateUrl: null } as ClientPolicy,
}));
vi.mock("@/lib/client-policy", () => ({
  useClientPolicy: () => policy.current,
}));

import {
  ClientPolicyGate,
  UPDATE_REQUIRED_COPY,
} from "@/components/client-policy-gate";
import { GlassMenu } from "@/components/glass-menu";
import { OverlayLayer } from "@/components/overlay-layer";

/**
 * The glass menu's shell (#5517): drawn in the app's overlay layer, never a
 * React Native `Modal`, so the update gate stays above it
 * (`spec/ui/mobile/patterns.md` § Overlays).
 */

const BACKDROP = "glass-menu-backdrop";

function Menu({
  visible,
  pageY = 200,
  onClose,
}: {
  visible: boolean;
  pageY?: number;
  onClose: () => void;
}) {
  return (
    <GlassMenu
      visible={visible}
      pageY={pageY}
      onClose={onClose}
      backdropTestID={BACKDROP}
    >
      <Text>Sweep the porch</Text>
    </GlassMenu>
  );
}

/** A screen somewhere down the app with the menu in it. */
function App(props: { visible: boolean; pageY?: number; onClose: () => void }) {
  return (
    <>
      <Text testID="screen">the screen</Text>
      <Menu {...props} />
    </>
  );
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
});
