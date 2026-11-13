/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { StyleSheet } from "react-native";
import { describe, expect, it, vi } from "vitest";
import { signetDarkTokens } from "@repo/theme/signet";
import { FrappThemeProvider, fontFamilyFor } from "@/lib/theme";

// Stand-ins no token carries, so a style that skips the chapter's palette
// fails instead of passing on house gold.
const BRAND = {
  accent: "#CB9FFF",
  accentSubtle: "#1E1530",
  accentBorder: "#5A3D8A",
  accentPrimary: "#9B5CFF",
  accentOnPrimary: "#FFFFFF",
};
vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => BRAND,
}));

import { ActivityAsk, ActivityAskButton } from "./activity-row";

/**
 * #4206. Activity's ask draws from the phone's one tinted-control recipe
 * (`components/tinted-control.ts`), web's `buttonVariants({ variant:
 * "tinted" })`: the accent's quiet fill and border, a bold accent label,
 * control radius, at the ask's own 28pt badge height.
 */

function render(element: React.ReactElement): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(<FrappThemeProvider>{element}</FrappThemeProvider>);
  });
  return tree;
}

const host = (tree: ReactTestRenderer, type: string) =>
  tree.root.findAll(
    (node) => (node.type as unknown as string) === type && !!node.props.style,
  );

const tokens = signetDarkTokens;

function expectTintedLabel(style: Record<string, unknown>) {
  expect(style).toMatchObject({
    color: BRAND.accent,
    fontSize: tokens.typography.role.caption.size,
    fontFamily: fontFamilyFor(tokens.typography.weight.bold),
  });
}

describe("ActivityAsk (#4206)", () => {
  it("is the tinted recipe at 28pt", () => {
    const tree = render(<ActivityAsk label="Confirm" />);
    const chip = StyleSheet.flatten(host(tree, "View")[0]!.props.style);
    expect(chip).toMatchObject({
      height: 28,
      backgroundColor: BRAND.accentSubtle,
      borderColor: BRAND.accentBorder,
      borderWidth: 1,
      borderRadius: tokens.radius.control,
    });
    expectTintedLabel(StyleSheet.flatten(host(tree, "Text")[0]!.props.style));
  });

  it("fills with the accent on the week card's Next row", () => {
    const tree = render(<ActivityAsk label="Confirm" filled />);
    const chip = StyleSheet.flatten(host(tree, "View")[0]!.props.style);
    expect(chip).toMatchObject({
      height: 28,
      backgroundColor: BRAND.accentPrimary,
      borderColor: BRAND.accentPrimary,
    });
    expect(
      StyleSheet.flatten(host(tree, "Text")[0]!.props.style).color,
    ).toBe(BRAND.accentOnPrimary);
  });
});

describe("ActivityAskButton (#4206)", () => {
  it("draws the same tinted chip, dimmed while disabled", () => {
    const tree = render(
      <ActivityAskButton
        action={{
          label: "Confirm",
          disabled: true,
          hint: undefined,
          run: () => {},
        }}
      />,
    );
    const button = tree.root.find(
      (node) => node.props.testID === "activity-row-action",
    );
    const style = button.props.style as
      | ((state: { pressed: boolean }) => unknown)
      | unknown;
    const chip = StyleSheet.flatten(
      (typeof style === "function"
        ? style({ pressed: false })
        : style) as Parameters<typeof StyleSheet.flatten>[0],
    );
    expect(chip).toMatchObject({
      height: 28,
      backgroundColor: BRAND.accentSubtle,
      borderColor: BRAND.accentBorder,
      borderWidth: 1,
      borderRadius: tokens.radius.control,
      opacity: 0.5,
    });
    expectTintedLabel(StyleSheet.flatten(host(tree, "Text")[0]!.props.style));
  });
});
