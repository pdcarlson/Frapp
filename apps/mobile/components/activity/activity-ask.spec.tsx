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

import { flatStyle } from "@/test/flat-style";
import { mixHex } from "@/components/tinted-control";
import { ActivityAsk, ActivityAskButton } from "./activity-row";

/**
 * #4206. Activity's ask draws from the phone's one tinted-control recipe
 * (`components/tinted-control.ts`), web's `buttonVariants({ variant:
 * "tinted" })`: the accent's quiet fill and border, a bold accent label,
 * control radius, at the ask's own 28pt badge height, and its pressed and
 * disabled states are components.md §3's, not opacity steps.
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
    expect(StyleSheet.flatten(host(tree, "Text")[0]!.props.style).color).toBe(
      BRAND.accentOnPrimary,
    );
  });
});

function renderButton(disabled: boolean) {
  const tree = render(
    <ActivityAskButton
      action={{ label: "Confirm", disabled, hint: undefined, run: () => {} }}
    />,
  );
  const button = tree.root.find(
    (node) => node.props.testID === "activity-row-action",
  );
  return {
    chip: (pressed: boolean) => flatStyle(button.props.style, pressed),
    label: () => flatStyle(host(tree, "Text")[0]!.props.style),
  };
}

describe("ActivityAskButton (#4206)", () => {
  it("draws the same tinted chip at rest, never dimmed", () => {
    const { chip, label } = renderButton(false);
    expect(chip(false)).toMatchObject({
      height: 28,
      backgroundColor: BRAND.accentSubtle,
      borderColor: BRAND.accentBorder,
      borderWidth: 1,
      borderRadius: tokens.radius.control,
    });
    expect(chip(false).opacity).toBeUndefined();
    expectTintedLabel(label());
  });

  it("steps its fill up one when pressed, as web's accent-subtle-hover", () => {
    const { chip } = renderButton(false);
    expect(chip(true).backgroundColor).toBe(
      mixHex(BRAND.accentBorder, 0.15, BRAND.accentSubtle),
    );
    expect(chip(true).backgroundColor).not.toBe(BRAND.accentSubtle);
    expect(chip(true).opacity).toBeUndefined();
  });

  it("is components.md's disabled recipe while disabled: card, hairline, disabled text", () => {
    const { chip, label } = renderButton(true);
    expect(chip(false)).toMatchObject({
      height: 28,
      backgroundColor: tokens.color.surface.card,
      borderColor: tokens.color.border.hairline,
    });
    expect(chip(false).opacity).toBeUndefined();
    expect(label().color).toBe(tokens.color.text.disabled);
  });
});

describe("mixHex", () => {
  it("mixes in sRGB, as CSS color-mix does", () => {
    expect(mixHex("#FFFFFF", 0.15, "#000000")).toBe("#262626");
    expect(mixHex("#6B5619", 0.15, "#2C2515")).toBe("#352C16");
  });

  it("leaves the base alone when either colour isn't #RRGGBB", () => {
    expect(mixHex("rgba(0,0,0,0.5)", 0.15, "#2C2515")).toBe("#2C2515");
  });
});
