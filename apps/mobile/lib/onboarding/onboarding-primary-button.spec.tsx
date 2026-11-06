/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import type { SignetTokens } from "@repo/theme/signet";
import { FrappThemeProvider, useFrappTheme } from "@/lib/theme";
import { OnboardingPrimaryButton } from "@/components/onboarding/onboarding-primary-button";
import { OnboardingSecondaryButton } from "@/components/onboarding/onboarding-secondary-button";
import { flatStyle } from "@/test/flat-style";

/**
 * The step-forward button join, setup, s03 and the Terms prompt share
 * (#3352). It is house gold because no chapter's color applies before the
 * member is inside one (`spec/behavior/branding.md` § Brand Boundaries), and a
 * change here repaints all four screens at once, so the fill is pinned here.
 *
 * Both buttons show a press: a ripple on Android, and on iOS (the suite's
 * platform) a held style, which is what these read.
 */

type Node = ReactTestRenderer["root"];

function renderButton(
  props: { disabled?: boolean; busy?: boolean },
  Button: typeof OnboardingPrimaryButton = OnboardingPrimaryButton,
) {
  let tokens!: SignetTokens;
  function Probe() {
    tokens = useFrappTheme().tokens;
    return <Button label="Join chapter" onPress={vi.fn()} {...props} />;
  }
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <Probe />
      </FrappThemeProvider>,
    );
  });
  const pressable = tree.root.findByType("Pressable" as never) as Node;
  return { pressable, tokens };
}

describe("OnboardingPrimaryButton", () => {
  it("is house gold, with the label on gold's own ink", () => {
    const { pressable, tokens } = renderButton({});
    expect(flatStyle(pressable.props.style).backgroundColor).toBe(
      tokens.color.gold.house,
    );
    const label = pressable.findByType("Text" as never) as Node;
    expect(flatStyle(label.props.style).color).toBe(tokens.color.gold.onHouse);
  });

  it("stays house gold while it waits, and names itself to a screen reader", () => {
    const { pressable, tokens } = renderButton({ disabled: true, busy: true });
    expect(flatStyle(pressable.props.style).backgroundColor).toBe(
      tokens.color.gold.house,
    );
    expect(pressable.props.accessibilityLabel).toBe("Join chapter");
    expect(pressable.props.accessibilityState).toEqual({
      disabled: true,
      busy: true,
    });
  });

  it("shows a press: a dimmed fill while held, and an Android ripple", () => {
    const { pressable } = renderButton({});
    expect(flatStyle(pressable.props.style, false).opacity).toBeUndefined();
    expect(flatStyle(pressable.props.style, true).opacity).toBe(0.85);
    expect(pressable.props.android_ripple).toEqual({
      color: expect.any(String),
    });
  });

  it("shows no press while disabled", () => {
    const { pressable } = renderButton({ disabled: true });
    // The disabled dim, not the pressed one.
    expect(flatStyle(pressable.props.style, true).opacity).toBe(0.55);
    expect(pressable.props.android_ripple).toBeUndefined();
  });
});

describe("OnboardingSecondaryButton", () => {
  it("is components.md's Secondary: a card fill under the input border, never gold", () => {
    const { pressable, tokens } = renderButton({}, OnboardingSecondaryButton);
    const style = flatStyle(pressable.props.style);
    expect(style.backgroundColor).toBe(tokens.color.surface.card);
    expect(style.borderColor).toBe(tokens.color.border.input);
    const label = pressable.findByType("Text" as never) as Node;
    expect(flatStyle(label.props.style).color).toBe(
      tokens.color.text.foreground,
    );
  });

  it("lifts its fill one rung while held", () => {
    const { pressable, tokens } = renderButton({}, OnboardingSecondaryButton);
    expect(flatStyle(pressable.props.style, true).backgroundColor).toBe(
      tokens.color.surface.popover,
    );
  });

  it("swaps its label for a spinner while busy, and keeps the label for a screen reader", () => {
    const { pressable } = renderButton(
      { disabled: true, busy: true },
      OnboardingSecondaryButton,
    );
    expect(pressable.findAllByType("Text" as never)).toHaveLength(0);
    expect(pressable.props.accessibilityLabel).toBe("Join chapter");
  });
});
