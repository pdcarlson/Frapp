/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useRouter } from "expo-router";
import { signetDarkTokens } from "@repo/theme/signet";
import { GlassSurface } from "@/components/glass-surface";
import { FrappThemeProvider } from "@/lib/theme";
import { expectBackRow } from "@/test/back-row";
import { stackScreen } from "@/test/stack-screen";
// A purple stand-in, so a row painted house gold fails instead of passing.
vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({ accent: "#CB9FFF" }),
}));

import {
  BACK_TO_CHAT,
  BACK_TO_ACTIVITY,
  BACK_TO_EVENTS,
  BACK_TO_YOU,
  BackRow,
} from "./back-row";

/**
 * #3022. The row the board draws above the title on s07 and s10–s16. On a
 * pushed screen it pops the stack, as the edge swipe does, and names what it
 * pops to; with nothing under it, it goes to its fixed destination.
 */

function render(element: React.ReactElement): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(<FrappThemeProvider>{element}</FrappThemeProvider>);
  });
  return tree;
}

beforeEach(() => {
  vi.clearAllMocks();
});

const labelText = (tree: ReactTestRenderer) =>
  tree.root.findByType("Text" as unknown as React.ElementType);

/** The `‹` is drawn, not typed: its stroke is the arrow's colour. */
const arrowColor = (tree: ReactTestRenderer) =>
  tree.root.findByType("Path" as unknown as React.ElementType).props.stroke;

describe("BackRow (#3022)", () => {
  it.each([
    ["You", BACK_TO_YOU, "/you"],
    ["Calendar", BACK_TO_EVENTS, "/events"],
    ["Activity", BACK_TO_ACTIVITY, "/activity"],
    ["Chat", BACK_TO_CHAT, "/"],
  ])("‹ %s goes to its tab with nothing under the screen", (label, target, href) => {
    const tree = render(<BackRow {...target} />);

    expectBackRow(tree, label, href);
  });

  it.each([
    ["Calendar", { name: "(tabs)", state: { index: 2, routes: [{ name: "index" }, { name: "activity" }, { name: "events" }] } }],
    ["Chat", { name: "(tabs)", state: { index: 0, routes: [{ name: "index" }] } }],
    ["Chat", { name: "(tabs)" }],
    ["You", { name: "(tabs)", params: { screen: "you" } }],
    ["Notifications", { name: "notifications" }],
  ])("pops to the screen under it, named ‹ %s", (label, below) => {
    const { element, navigation } = stackScreen(
      [{ name: "(tabs)" }, below].slice(below.name === "(tabs)" ? 1 : 0),
      // The label it passes is only the fallback.
      <BackRow {...BACK_TO_EVENTS} />,
    );
    const tree = render(element);
    const row = tree.root.find(
      (node) =>
        (node.type as unknown) === "Pressable" &&
        node.props.accessibilityRole === "button",
    );

    expect(row.props.accessibilityLabel).toBe(`Back to ${label}`);
    expect(labelText(tree).props.children).toBe(label);
    act(() => row.props.onPress());
    expect(navigation.goBack).toHaveBeenCalledTimes(1);
    expect(vi.mocked(useRouter)().navigate).not.toHaveBeenCalled();
  });

  it("keeps a step-back row on its own step, whatever is under the screen", () => {
    const onPress = vi.fn();
    const { element, navigation } = stackScreen(
      [{ name: "(tabs)" }],
      <BackRow label="Back" onPress={onPress} house />,
    );
    const tree = render(element);
    expect(labelText(tree).props.children).toBe("Back");
    act(() => tree.root.findByProps({ accessibilityRole: "button" }).props.onPress());
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(navigation.goBack).not.toHaveBeenCalled();
  });

  it("draws its arrow in the chapter accent, not house gold", () => {
    const tree = render(<BackRow {...BACK_TO_YOU} />);

    // The purple stand-in the mock returns: inside a chapter every back arrow
    // follows the accent (spec/behavior/branding.md, owner rule 2026-11-04).
    expect(arrowColor(tree)).toBe("#CB9FFF");
    // The name reads in foreground, on the glass.
    expect(labelText(tree).props.style).toEqual(
      expect.objectContaining({
        color: signetDarkTokens.color.text.foreground,
      }),
    );
  });

  it("sits in a glass capsule, 36pt tall and fully round", () => {
    const tree = render(<BackRow {...BACK_TO_YOU} />);
    const capsule = tree.root.findByType(GlassSurface);
    const style = Object.assign({}, ...[capsule.props.style].flat(Infinity));

    expect(style.height).toBe(36);
    expect(style.borderRadius).toBe(18);
  });
});

/**
 * Sign-in, join, setup and the chapter picker draw the same row, in house
 * gold (there is no chapter in `(auth)`), stepping back inside their own
 * route rather than opening a tab.
 */
describe("BackRow in (auth)", () => {
  const pressable = (tree: ReactTestRenderer) =>
    tree.root.findByType("Pressable" as unknown as React.ElementType);

  it("draws in house gold when asked, whatever the chapter's accent", () => {
    const tree = render(<BackRow house label="Back" onPress={vi.fn()} />);

    // `gold.askText`, the board's `‹ Back` gold on s02, not the purple mock.
    expect(labelText(tree).props.children).toBe("Back");
    expect(arrowColor(tree)).toBe("#F4CB63");
  });

  it("runs its own step back instead of navigating, under the label it's given", () => {
    const onPress = vi.fn();
    const tree = render(
      <BackRow
        house
        label="Back"
        accessibilityLabel="Back to the choices"
        onPress={onPress}
      />,
    );
    const row = pressable(tree);

    expect(row.props.accessibilityLabel).toBe("Back to the choices");
    act(() => {
      row.props.onPress();
    });
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(vi.mocked(useRouter)().navigate).not.toHaveBeenCalled();
  });

  it("dims and holds while disabled, as while a sign-in is in flight", () => {
    const tree = render(
      <BackRow house label="Back" onPress={vi.fn()} disabled />,
    );
    const row = pressable(tree);

    expect(row.props.disabled).toBe(true);
    expect(row.props.accessibilityState).toEqual({ disabled: true });
    const capsule = tree.root.findByType(GlassSurface);
    expect(
      Object.assign({}, ...[capsule.props.style].flat(Infinity)),
    ).toEqual(expect.objectContaining({ opacity: 0.5 }));
  });

  it("shows a press on the glass, as a lift of one step, never a fade", () => {
    const tree = render(<BackRow {...BACK_TO_YOU} />);
    const capsuleStyle = () =>
      Object.assign(
        {},
        ...[tree.root.findByType(GlassSurface).props.style].flat(Infinity),
      );

    // `spec/ui/mobile/README.md` § Pressing a list row.
    act(() => {
      pressable(tree).props.onPressIn();
    });
    // The glass is the `surface1` step, so one step up is `card`, as the
    // floating create button lifts (`lib/surfaces.ts`).
    expect(capsuleStyle().backgroundColor).toBe(
      signetDarkTokens.color.surface.card,
    );
    expect(capsuleStyle()).not.toHaveProperty("opacity");

    act(() => {
      pressable(tree).props.onPressOut();
    });
    expect(capsuleStyle()).not.toHaveProperty("backgroundColor");
  });

  it("takes taps across a 44pt target, the capsule centred in it", () => {
    const tree = render(<BackRow {...BACK_TO_YOU} />);
    const target = Object.assign(
      {},
      ...[pressable(tree).props.style].flat(Infinity),
    );

    // The target is the row, not a hit slop: the glass clips to its capsule,
    // and a slop outside a clipping parent takes no touches.
    expect(target.minHeight).toBe(44);
    expect(target.justifyContent).toBe("center");
    expect(pressable(tree).props.hitSlop).toBeUndefined();
    // The capsule sits inside the target, not around it.
    expect(
      pressable(tree).findAllByType(GlassSurface),
    ).toHaveLength(1);
  });
});
