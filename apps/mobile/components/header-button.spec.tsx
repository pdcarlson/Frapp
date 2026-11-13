/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";
import { View } from "react-native";
import { signetDarkTokens } from "@repo/theme/signet";
import { flatStyle } from "@/test/flat-style";
import { createSwipeClaim, SwipeClaimProvider } from "@/lib/swipe-claim";
import { FrappThemeProvider } from "@/lib/theme";
import {
  HEADER_BUTTON_HIT_SLOP,
  HEADER_BUTTON_SIZE,
  HeaderButton,
  type HeaderBadge,
} from "./header-button";

/**
 * #4610 step 3: a screen header's icon action draws inside a round, so it
 * reads as a button (`spec/ui/mobile/patterns.md` § Screen headers).
 */

const mounted: ReactTestRenderer[] = [];
afterEach(() => {
  for (const tree of mounted.splice(0)) act(() => tree.unmount());
});

function render(
  props: {
    onPress?: () => void;
    badge?: HeaderBadge;
    value?: string;
    disabled?: boolean;
  } = {},
  wrap: (node: React.ReactNode) => React.ReactNode = (node) => node,
) {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        {wrap(
          <HeaderButton
            label="New message"
            hint="Opens the Directory to pick someone."
            onPress={props.onPress ?? (() => undefined)}
            badge={props.badge}
            value={props.value}
            disabled={props.disabled}
          >
            <View testID="glyph" />
          </HeaderButton>,
        )}
      </FrappThemeProvider>,
    );
  });
  mounted.push(tree);
  return tree;
}

const button = (tree: ReactTestRenderer) =>
  tree.root.find((node) => (node.type as unknown) === "Pressable");

describe("HeaderButton", () => {
  it("is a named button on a 36pt round that reaches the 44pt touch floor", () => {
    const tree = render();
    const pressable = button(tree);
    expect(pressable.props.accessibilityRole).toBe("button");
    expect(pressable.props.accessibilityLabel).toBe("New message");
    expect(pressable.props.accessibilityHint).toBe(
      "Opens the Directory to pick someone.",
    );
    const resting = flatStyle(pressable.props.style({ pressed: false }));
    expect(resting.width).toBe(HEADER_BUTTON_SIZE);
    expect(resting.height).toBe(HEADER_BUTTON_SIZE);
    expect(resting.borderRadius).toBe(HEADER_BUTTON_SIZE / 2);
    // What marks it as a control: a fill and an edge, not a bare glyph. The
    // fill is a card's on the page, one step above it (`lib/surfaces.ts`).
    expect(resting.backgroundColor).toBe(
      signetDarkTokens.color.surface.surface1,
    );
    expect(resting.borderColor).toBe(signetDarkTokens.color.border.hairline);
    expect(
      HEADER_BUTTON_SIZE + 2 * (pressable.props.hitSlop as number),
    ).toBeGreaterThanOrEqual(signetDarkTokens.touch.minimum);
    expect(pressable.props.hitSlop).toBe(HEADER_BUTTON_HIT_SLOP);
  });

  it("lifts a step while pressed", () => {
    const pressed = flatStyle(button(render()).props.style({ pressed: true }));
    expect(pressed.backgroundColor).toBe(signetDarkTokens.color.surface.card);
  });

  it("draws no badge at zero, and caps a large count", () => {
    const badge = (tree: ReactTestRenderer) =>
      tree.root.findAll(
        (node) =>
          (node.type as unknown) === "View" && node.props.testID === "count",
      );
    expect(
      badge(render({ badge: { count: 0, tone: "inbox", testID: "count" } })),
    ).toHaveLength(0);
    const many = render({
      badge: { count: 120, tone: "mention", testID: "count" },
    });
    expect(badge(many)).toHaveLength(1);
    expect(
      badge(many)[0]!.findByType("Text" as unknown as React.ElementType).props
        .children,
    ).toBe("99+");
  });

  it("paints a mention count red and an inbox count house gold", () => {
    const fill = (tone: HeaderBadge["tone"]) =>
      flatStyle(
        render({ badge: { count: 2, tone, testID: "count" } }).root.find(
          (node) =>
            (node.type as unknown) === "View" && node.props.testID === "count",
        ).props.style,
      ).backgroundColor;
    expect(fill("mention")).toBe(signetDarkTokens.color.semantic.mention);
    expect(fill("inbox")).toBe(signetDarkTokens.color.gold.house);
  });

  it("says its value, and that it is disabled", () => {
    const pressable = button(render({ value: "3 unread", disabled: true }));
    expect(pressable.props.accessibilityValue).toEqual({ text: "3 unread" });
    expect(pressable.props.accessibilityState).toEqual({ disabled: true });
    expect(pressable.props.disabled).toBe(true);
  });

  it("drops a press that came from a screen-wide swipe's own touch", () => {
    const onPress = vi.fn();
    const claim = createSwipeClaim(() => 0);
    const tree = render({ onPress }, (node) => (
      <SwipeClaimProvider value={claim}>{node}</SwipeClaimProvider>
    ));
    claim.claim();
    act(() => button(tree).props.onPress());
    expect(onPress).not.toHaveBeenCalled();
    claim.begin();
    act(() => button(tree).props.onPress());
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
