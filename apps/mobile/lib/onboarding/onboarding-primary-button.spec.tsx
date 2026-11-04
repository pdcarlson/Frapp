/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import type { SignetTokens } from "@repo/theme/signet";
import { FrappThemeProvider, useFrappTheme } from "@/lib/theme";
import { OnboardingPrimaryButton } from "@/components/onboarding/onboarding-primary-button";

/**
 * The step-forward button join, setup, s03 and the Terms prompt share
 * (#3352). It is house gold because no chapter's color applies before the
 * member is inside one (`spec/behavior/branding.md` § Brand Boundaries), and a
 * change here repaints all four screens at once, so the fill is pinned here.
 */

type Node = ReactTestRenderer["root"];

function flat(style: unknown): Record<string, unknown> {
  if (Array.isArray(style)) return Object.assign({}, ...style.map(flat));
  return (style ?? {}) as Record<string, unknown>;
}

function renderButton(props: { disabled?: boolean; busy?: boolean }) {
  let tokens!: SignetTokens;
  function Probe() {
    tokens = useFrappTheme().tokens;
    return (
      <OnboardingPrimaryButton
        label="Join chapter"
        onPress={vi.fn()}
        {...props}
      />
    );
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
    expect(flat(pressable.props.style).backgroundColor).toBe(
      tokens.color.gold.house,
    );
    const label = pressable.findByType("Text" as never) as Node;
    expect(flat(label.props.style).color).toBe(tokens.color.gold.onHouse);
  });

  it("stays house gold while it waits, and names itself to a screen reader", () => {
    const { pressable, tokens } = renderButton({ disabled: true, busy: true });
    expect(flat(pressable.props.style).backgroundColor).toBe(
      tokens.color.gold.house,
    );
    expect(pressable.props.accessibilityLabel).toBe("Join chapter");
    expect(pressable.props.accessibilityState).toEqual({
      disabled: true,
      busy: true,
    });
  });
});
